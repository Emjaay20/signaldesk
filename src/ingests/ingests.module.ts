import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { IngestsController } from './ingests.controller';
import { IngestsService } from './ingests.service';

@Module({
  imports: [AuthModule],
  controllers: [IngestsController],
  providers: [IngestsService],
  exports: [IngestsService],
})
export class IngestsModule {}
