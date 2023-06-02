import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Service } from '@aws/s3';
import { ContentRepository } from '@orm/repositories';
import { SOL_NFT_CONNECTION } from '@libs/common/constants';
import { SolNftMetadataDto } from '@solana/sol-nft/dto';
import { SolNftConnection } from '@solana/sol-nft/types';
import { CreateNftDto } from '@orm/dto';
import { Nft, Content } from '@orm/entities';
import { NftRepository } from '@orm/repositories';
import { ENftState } from '@orm/enum';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import {
  Metaplex,
  keypairIdentity,
  bundlrStorage,
  toMetaplexFile,
} from '@metaplex-foundation/js';
import * as bs58 from 'bs58';

@Injectable()
export class SolNftService {
  private readonly logger = new Logger(SolNftService.name);
  metaplex: Metaplex = null;
  wallet: Keypair = null;
  connection: Connection = null;
  nftConfig: SolNftConnection = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly s3Service: S3Service,
    private readonly contentRepository: ContentRepository,
    private readonly nftRepository: NftRepository,
  ) {
    this.init();
  }

  init() {
    //init wallet and metaplex connection
    //config values needed
    this.nftConfig = this.configService.get(SOL_NFT_CONNECTION);
    const sessionHash = 'NILORAPI' + Math.ceil(Math.random() * 1e9);
    this.connection = new Connection(this.nftConfig.rpcConnection, {
      commitment: 'finalized',
      httpHeaders: { 'x-session-hash': sessionHash },
    });
    const secretBytes = bs58.decode(this.nftConfig.privateKey);
    this.wallet = Keypair.fromSecretKey(new Uint8Array(secretBytes));
    this.metaplex = Metaplex.make(this.connection)
      .use(keypairIdentity(this.wallet))
      .use(
        bundlrStorage({
          address: this.nftConfig.bundlrUrl,
          providerUrl: this.nftConfig.rpcConnection,
          timeout: 60000,
        }),
      );
  }

  async setNftWaitingApproval(createNftDto: CreateNftDto): Promise<Nft> {
    const nft = Nft.create({
      ...createNftDto,
      state: ENftState.WAITING_APPROVAL,
    });
    return await nft.save();
  }

  getExplorerUrl(address: string): string {
    if (process.env.NODE_ENV === 'dev') {
      return `https://explorer.solana.com/address/${address}?cluster=devnet`;
    } else {
      return `https://explorer.solana.com/address/${address}`;
    }
  }

  async uploadImage(storageImageKey: string): Promise<string> {
    try {
      const imgBytes = await this.s3Service.getImageBytes(storageImageKey);
      const imgMetaplex = toMetaplexFile(imgBytes, storageImageKey);
      const imgUri = await this.metaplex.storage().upload(imgMetaplex);
      this.logger.log('Image uploaded to: ' + imgUri);
      return imgUri;
    } catch (error) {
      throw new Error(error.message);
    }
  }

  async uploadMetadata(solNftMetadata: SolNftMetadataDto): Promise<string> {
    try {
      const { uri } = await this.metaplex.nfts().uploadMetadata({
        name: solNftMetadata.nftName,
        symbol: solNftMetadata.symbol,
        description: solNftMetadata.description,
        image: solNftMetadata.imageUri,
        attributes: solNftMetadata.attributes as any,
        properties: {
          files: [
            {
              uri: solNftMetadata.imageUri,
              type: solNftMetadata.imageType,
            },
          ],
        },
      });
      this.logger.log('Metadata uploaded to: ' + uri);
      return uri;
    } catch (error) {
      throw new Error(error.message);
    }
  }

  async metaplexNftCreate(
    createNftdto: CreateNftDto,
    nft: Nft,
  ): Promise<PublicKey> {
    try {
      const collectionAddress: PublicKey = new PublicKey(
        createNftdto.collectionAddress,
      );
      const mintObject = await this.metaplex.nfts().create(
        {
          name: createNftdto.name,
          uri: createNftdto.metadataUrl,
          sellerFeeBasisPoints: 100,
          symbol: createNftdto.symbol,
          collection: collectionAddress,
          creators: [{ address: this.wallet.publicKey, share: 100 }],
        },
        { commitment: 'finalized' },
      );
      const mintedNft = mintObject.nft;
      //verify mint
      return mintedNft.address;
    } catch (error) {
      this.logger.error(`failed to mint nft: ${error.message}`);
      nft.state = ENftState.MINT_FAILED;
      await this.nftRepository.saveNft(nft);
      throw new Error(error.message);
    }
  }

  async metaplexBuilderCreate(
    createNftdto: CreateNftDto,
    nft: Nft,
  ): Promise<{ address: PublicKey; error: any }> {
    try {
      const collectionAddress: PublicKey = new PublicKey(
        createNftdto.collectionAddress,
      );
      const transactionBuilder = await this.metaplex
        .nfts()
        .builders()
        .create({
          name: createNftdto.name,
          uri: createNftdto.metadataUrl,
          sellerFeeBasisPoints: 100,
          symbol: createNftdto.symbol,
          collection: collectionAddress,
          creators: [{ address: this.wallet.publicKey, share: 100 }],
        });
      const { mintAddress } = await transactionBuilder.getContext();
      await this.metaplex.rpc().sendAndConfirmTransaction(transactionBuilder);
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const mintObject = await this.metaplex.nfts().findByMint({ mintAddress });
      const address = mintObject.address;
      return { address, error: null };
    } catch (error) {
      this.logger.error(`failed to mint nft: ${error.message}`);
      const updatedNft: Nft = await this.nftRepository.findOne(nft.id);
      updatedNft.state = ENftState.MINT_FAILED;
      await this.nftRepository.saveNft(updatedNft);
      return { address: null, error: error };
    }
  }

  async verifyMint(
    mintAddress: PublicKey,
    collectionAddress: PublicKey,
    nft: Nft,
  ): Promise<{ verifyTx: string; error: any }> {
    let verifyTx: string;
    try {
      const verifyObject = await this.metaplex.nfts().verifyCollection(
        {
          mintAddress: mintAddress,
          collectionMintAddress: collectionAddress,
        },
        { commitment: 'finalized' },
      );
      verifyTx = verifyObject.response.signature;
      return { verifyTx, error: null };
    } catch (error) {
      this.logger.error(`failed to verify nft: ${error.message}`);
      const updatedNft: Nft = await this.nftRepository.findOne(nft.id);
      updatedNft.state = ENftState.MINT_FAILED;
      await this.nftRepository.saveNft(updatedNft);
      return { verifyTx: null, error };
      //throw new Error(error.message);
    }
  }

  async mintNft(createNftdto: CreateNftDto): Promise<Nft> {
    createNftdto.collectionAddress = this.nftConfig.collectionAddress;
    createNftdto.state = ENftState.MINT_REQUESTED;
    //create NFT entity
    const nft: Nft = await this.nftRepository.create(createNftdto);
    this.logger.log('NFT created: ' + nft.id);
    //update content with nft
    const content: Content = await this.contentRepository.findOneStandalone(
      nft.content.id,
    );
    content.nft = nft;
    const updatedContent = await this.contentRepository.saveContent(content);
    this.logger.log('Content updated with NFT: ' + updatedContent.id);

    //upload to solana
    const collectionPublicKey = new PublicKey(createNftdto.collectionAddress);
    const maxRetries = 5;

    let isMinting = true;
    let mintedAddress: PublicKey;
    let mintAttemps = 0;
    while (isMinting) {
      const { address, error } = await this.metaplexBuilderCreate(
        createNftdto,
        nft,
      );
      if (error) {
        mintAttemps += 1;
        if (mintAttemps > maxRetries) {
          throw new Error(error.message);
        }
      } else {
        mintedAddress = address;
        isMinting = false;
      }
    }
    //verify mint
    let isVerifiying = true;
    let verifiedTransaction: string;
    let verifyAttemps = 0;
    while (isVerifiying) {
      const { verifyTx, error } = await this.verifyMint(
        mintedAddress,
        collectionPublicKey,
        nft,
      );
      if (error) {
        verifyAttemps += 1;
        if (verifyAttemps > maxRetries) {
          throw new Error(error.message);
        }
      } else {
        verifiedTransaction = verifyTx;
        isVerifiying = false;
      }
    }
    this.logger.log('NFT minted at: ' + mintedAddress.toString());
    //update enity with solana data
    const updateNft: Nft = await this.nftRepository.findOne(nft.id);
    updateNft.address = mintedAddress.toString();
    updateNft.state = ENftState.MINTED;
    updateNft.verifyTx = verifiedTransaction;
    return await this.nftRepository.saveNft(updateNft);
  }
}
