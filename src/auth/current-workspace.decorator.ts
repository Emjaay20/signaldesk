import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthedRequest } from './api-key.guard';

export const CurrentWorkspace = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    return ctx.switchToHttp().getRequest<AuthedRequest>().workspace;
  },
);
