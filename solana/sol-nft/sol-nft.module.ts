import { Module } from '@nestjs/common';
import { SolNftService } from './sol-nft.service';
import { ConfigModule } from '@nestjs/config';
import { S3Module } from '@aws/s3';
import { OrmModule } from '@orm';

@Module({
  imports: [ConfigModule, S3Module, OrmModule],
  providers: [SolNftService],
  exports: [SolNftService],
})
export class SolNftModule {}
