import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { safeEqual } from './safe-equal';

@Injectable()
export class AdminTokenGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>('ADMIN_TOKEN');
    if (!expected) {
      throw new UnauthorizedException();
    }

    const header = context.switchToHttp().getRequest<Request>().header(
      'x-admin-token',
    );
    if (!header || !safeEqual(header, expected)) {
      throw new UnauthorizedException();
    }

    return true;
  }
}
