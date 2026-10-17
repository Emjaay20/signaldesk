import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Workspace } from '@prisma/client';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import {
  apiKeyPrefix,
  generateApiKey,
  hashApiKey,
} from '../auth/api-key.crypto';
import { ApiKeyGuard, AuthedRequest } from '../auth/api-key.guard';
import { CurrentWorkspace } from '../auth/current-workspace.decorator';
import { PrismaService } from '../prisma/prisma.service';

export class CreateApiKeyDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name?: string;
}

@Controller('v1')
@UseGuards(ApiKeyGuard)
export class MeController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('me')
  me(@CurrentWorkspace() workspace: Workspace) {
    return {
      workspace: {
        id: workspace.id,
        name: workspace.name,
      },
    };
  }

  @Get('api-keys')
  async listKeys(
    @CurrentWorkspace() workspace: Workspace,
    @Req() req: AuthedRequest,
  ) {
    const keys = await this.prisma.apiKey.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        createdAt: true,
        lastUsedAt: true,
        revokedAt: true,
      },
    });
    return keys.map((k) => ({
      ...k,
      current: k.id === req.apiKeyId,
    }));
  }

  @Post('api-keys')
  async createKey(
    @CurrentWorkspace() workspace: Workspace,
    @Body() dto: CreateApiKeyDto,
  ) {
    const raw = generateApiKey();
    const created = await this.prisma.apiKey.create({
      data: {
        workspaceId: workspace.id,
        name: dto.name?.trim() || 'rotated-key',
        keyPrefix: apiKeyPrefix(raw),
        keyHash: hashApiKey(raw),
      },
    });
    return {
      id: created.id,
      name: created.name,
      keyPrefix: created.keyPrefix,
      createdAt: created.createdAt,
      apiKey: raw,
    };
  }

  @Delete('api-keys/:id')
  async revokeKey(
    @CurrentWorkspace() workspace: Workspace,
    @Param('id') id: string,
  ) {
    const target = await this.prisma.apiKey.findFirst({
      where: { id, workspaceId: workspace.id },
    });
    if (!target) {
      throw new NotFoundException('API key not found');
    }
    if (target.revokedAt) {
      throw new BadRequestException('API key is already revoked');
    }

    const updated = await this.prisma.apiKey.update({
      where: { id: target.id },
      data: { revokedAt: new Date() },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        revokedAt: true,
      },
    });
    return updated;
  }
}
