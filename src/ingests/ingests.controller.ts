import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Workspace } from '@prisma/client';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { memoryStorage } from 'multer';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { CurrentWorkspace } from '../auth/current-workspace.decorator';
import { IngestsService } from './ingests.service';

export class ResolveCaseDto {
  @IsOptional()
  @IsString()
  @MaxLength(400)
  resolution?: string;
}

@Controller('v1')
@UseGuards(ApiKeyGuard)
export class IngestsController {
  constructor(private readonly ingests: IngestsService) {}

  @Post('ingests')
  @HttpCode(202)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  create(
    @CurrentWorkspace() workspace: Workspace,
    @UploadedFile() file: Express.Multer.File,
    @Headers('x-ingest-id') ingestId: string | undefined,
  ) {
    return this.ingests.create(workspace, ingestId, file);
  }

  @Get('ingests')
  listIngests(
    @CurrentWorkspace() workspace: Workspace,
    @Query('limit') limit?: string,
  ) {
    return this.ingests.listIngests(
      workspace,
      limit ? Number(limit) : undefined,
    );
  }

  @Get('ingests/:id')
  async get(
    @CurrentWorkspace() workspace: Workspace,
    @Param('id') id: string,
  ) {
    const ingest = await this.ingests.get(workspace, id);
    if (!ingest) {
      throw new NotFoundException();
    }
    return ingest;
  }

  @Post('ingests/:id/process')
  @HttpCode(200)
  processIngest(
    @CurrentWorkspace() workspace: Workspace,
    @Param('id') id: string,
  ) {
    return this.ingests.triggerProcess(workspace, id);
  }

  @Get('products')
  listProducts(
    @CurrentWorkspace() workspace: Workspace,
    @Query('healthy') healthy?: string,
    @Query('q') q?: string,
  ) {
    return this.ingests.listProducts(workspace, { healthy, q });
  }

  @Get('catalog/summary')
  getCatalogSummary(@CurrentWorkspace() workspace: Workspace) {
    return this.ingests.getCatalogSummary(workspace);
  }

  @Get('cases')
  listCases(
    @CurrentWorkspace() workspace: Workspace,
    @Query('status') status?: string,
    @Query('q') q?: string,
  ) {
    return this.ingests.listCases(workspace, { status, q });
  }

  @Post('cases/:id/resolve')
  @HttpCode(200)
  resolveCase(
    @CurrentWorkspace() workspace: Workspace,
    @Param('id') id: string,
    @Body() dto: ResolveCaseDto,
  ) {
    return this.ingests.resolveCase(workspace, id, dto?.resolution);
  }
}
