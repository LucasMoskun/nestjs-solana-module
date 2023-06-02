import { registerAs } from '@nestjs/config';
import { SolNftConnection } from '@solana/sol-nft/types';
import { SOL_NFT_CONNECTION } from '@libs/common/constants';
import * as Joi from 'joi';
import { JoiConfig, JoiUtil } from '@utils/validation';

export default registerAs(SOL_NFT_CONNECTION, (): SolNftConnection => {
  const config: JoiConfig<SolNftConnection> = {
    privateKey: {
      value: process.env.SOL_NFT_PRIVATE_KEY,
      joi: Joi.string().required(),
    },
    rpcConnection: {
      value: process.env.SOL_NFT_RPC,
      joi: Joi.string().required(),
    },
    bundlrUrl: {
      value: process.env.SOL_NFT_BUNDLR_URL,
      joi: Joi.string().required(),
    },
    collectionAddress: {
      value: process.env.SOL_NFT_COLLECTION_ADDRESS,
      joi: Joi.string().required(),
    },
  };
  return JoiUtil.validate(config);
});
