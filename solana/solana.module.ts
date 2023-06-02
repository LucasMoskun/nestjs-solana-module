import { Module } from '@nestjs/common';
import { SolanaService } from './solana.service';
import { SolNftModule } from './sol-nft/sol-nft.module';

@Module({
  providers: [SolanaService],
  imports: [SolNftModule],
})
export class SolanaModule {}
