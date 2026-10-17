import { Module } from '@nestjs/common';
import { AdminTokenGuard } from './admin-token.guard';
import { ApiKeyGuard } from './api-key.guard';
import { MeController } from '../me/me.controller';

@Module({
  controllers: [MeController],
  providers: [AdminTokenGuard, ApiKeyGuard],
  exports: [AdminTokenGuard, ApiKeyGuard],
})
export class AuthModule {}
