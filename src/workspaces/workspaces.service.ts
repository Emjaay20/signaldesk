import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  apiKeyPrefix,
  generateApiKey,
  hashApiKey,
} from '../auth/api-key.crypto';

@Injectable()
export class WorkspacesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(name: string) {
    const raw = generateApiKey();
    const workspace = await this.prisma.workspace.create({
      data: {
        name,
        apiKeys: {
          create: {
            keyPrefix: apiKeyPrefix(raw),
            keyHash: hashApiKey(raw),
          },
        },
      },
    });

    return {
      workspace: {
        id: workspace.id,
        name: workspace.name,
        createdAt: workspace.createdAt,
      },
      apiKey: raw,
    };
  }
}
