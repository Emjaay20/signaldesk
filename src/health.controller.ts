import { Controller, Get } from '@nestjs/common';

@Controller()
export class HealthController {
  @Get('health')
  health(): string {
    return 'OK';
  }

  @Get('healthz')
  healthz(): string {
    return 'OK';
  }

  @Get('readyz')
  ready(): string {
    return 'READY';
  }
}
