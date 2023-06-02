import { NftAttributeDto } from '@utils/nft/dto';

export class SolNftMetadataDto {
  imageUri: string;
  imageType: string;
  nftName: string;
  symbol: string;
  description: string;
  attributes: NftAttributeDto[];
}
