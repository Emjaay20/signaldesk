import {
  HttpException,
  HttpStatus,
  Injectable,
  NestMiddleware,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { MetricsService } from './metrics.service';
import { requestContextStorage, StructuredLogger } from './request-context';
import { SlidingWindowRateLimiter } from './sliding-window-rate-limiter';

const WINDOW_MS = 60_000;
const DEFAULT_MAX_RPM = Number(process.env.RATE_LIMIT_RPM) || 600;

@Injectable()
export class PlatformMiddleware implements NestMiddleware {
  private readonly logger = new StructuredLogger('HttpGateway');
  private readonly limiter = new SlidingWindowRateLimiter(
    WINDOW_MS,
    DEFAULT_MAX_RPM,
  );

  constructor(private readonly metrics: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const startHr = process.hrtime.bigint();
    const correlationId =
      req.header('x-correlation-id')?.trim() ||
      req.header('x-request-id')?.trim() ||
      `corr_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const requestId =
      req.header('x-request-id')?.trim() ||
      `req_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

    res.setHeader('x-correlation-id', correlationId);
    res.setHeader('x-request-id', requestId);
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('x-frame-options', 'SAMEORIGIN');
    res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');

    // Per-tenant / per-IP sliding window rate limiting.
    // Only bucket by API key prefix if the header matches our canonical key format;
    // otherwise bucket by IP so unauthenticated callers cannot bypass limits by rotating bogus headers.
    const rawKeyHeader = req.header('x-api-key')?.trim();
    const isPlausibleApiKey =
      rawKeyHeader !== undefined && /^sd_live_[A-Za-z0-9_-]{16,}$/.test(rawKeyHeader);
    const clientKey = isPlausibleApiKey
      ? `key:${rawKeyHeader.slice(0, 16)}`
      : `ip:${req.ip || 'anonymous'}`;
    const decision = this.limiter.hit(clientKey);

    res.setHeader('x-ratelimit-limit', String(decision.limit));
    res.setHeader('x-ratelimit-remaining', String(decision.remaining));
    res.setHeader(
      'x-ratelimit-reset',
      String(Math.ceil(decision.resetAtMs / 1000)),
    );

    if (!decision.allowed) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Rate limit exceeded. Please retry after reset window.',
          correlationId,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startHr) / 1e6;
      const routePath = req.originalUrl?.split('?')[0] || req.path || '/';
      this.metrics.recordHttpRequest(routePath, res.statusCode, durationMs);
      this.logger.info('http_request_completed', {
        method: req.method,
        path: routePath,
        statusCode: res.statusCode,
        durationMs: Number(durationMs.toFixed(2)),
      });
    });

    requestContextStorage.run(
      {
        correlationId,
        requestId,
        method: req.method,
        path: req.path,
        startTimeMs: Date.now(),
      },
      () => next(),
    );
  }
}
