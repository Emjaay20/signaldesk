import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Workspace } from '@prisma/client';
import { Request } from 'express';
import { getCurrentContext } from '../observability/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { hashApiKey } from './api-key.crypto';

export type AuthedRequest = Request & {
  workspace: Workspace;
  apiKeyId?: string;
};

const LAST_USED_DEBOUNCE_MS = 60_000;

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const raw = req.header('x-api-key');
    if (!raw) {
      throw new UnauthorizedException();
    }

    const apiKey = await this.prisma.apiKey.findUnique({
      where: { keyHash: hashApiKey(raw) },
      include: { workspace: true },
    });

    if (!apiKey || apiKey.revokedAt) {
      throw new UnauthorizedException();
    }

    req.workspace = apiKey.workspace;
    req.apiKeyId = apiKey.id;

    const ctx = getCurrentContext();
    if (ctx) {
      ctx.workspaceId = apiKey.workspace.id;
    }

    // Debounce lastUsedAt writes to at most once per 60s to prevent DB write amplification on reads
    const now = Date.now();
    if (
      !apiKey.lastUsedAt ||
      now - apiKey.lastUsedAt.getTime() >= LAST_USED_DEBOUNCE_MS
    ) {
      await this.prisma.apiKey.update({
        where: { id: apiKey.id },
        data: { lastUsedAt: new Date(now) },
      });
    }

    return true;
  }
}
