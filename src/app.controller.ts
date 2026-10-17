import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { existsSync } from 'fs';
import { join } from 'path';

@Controller()
export class AppController {
  @Get()
  getSpa(@Res() res: Response): void {
    this.sendSpaEntry(res);
  }

  @Get('v1')
  getApiMeta() {
    return {
      service: 'Signaldesk Control Plane API',
      version: '1.0.0',
      architecture:
        'Modular Monolith + React/Vite SPA + Async Streaming Worker + Transactional Outbox',
      endpoints: {
        dashboard: '/',
        docsAndTradeoffs: '/docs',
        architectureDiagram: '/architecture',
        liveness: '/health',
        readiness: '/readyz',
        prometheusMetrics: '/metrics',
        sloTelemetry: '/v1/telemetry',
        sandboxProvision: 'POST /v1/sandbox/provision',
      },
    };
  }

  @Get('docs')
  getDocsSpa(@Res() res: Response): void {
    this.sendSpaEntry(res);
  }

  @Get('architecture')
  getArchitectureSpa(@Res() res: Response): void {
    this.sendSpaEntry(res);
  }

  private sendSpaEntry(res: Response): void {
    const candidates = [
      join(process.cwd(), 'public', 'index.html'),
      join(__dirname, '..', 'public', 'index.html'),
    ];
    const found = candidates.find((p) => existsSync(p));
    if (found) {
      res.sendFile(found);
      return;
    }
    res.redirect('/');
  }
}