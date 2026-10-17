import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Workspace } from '@prisma/client';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { CurrentWorkspace } from '../auth/current-workspace.decorator';
import { CreateWebhookDto } from './dto/create-webhook.dto';
import { WebhooksService } from './webhooks.service';

@Controller('v1')
@UseGuards(ApiKeyGuard)
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Post('webhooks')
  registerWebhook(
    @CurrentWorkspace() workspace: Workspace,
    @Body() dto: CreateWebhookDto,
  ) {
    return this.webhooks.upsert(workspace, dto.url);
  }

  @Get('webhooks')
  getWebhook(@CurrentWorkspace() workspace: Workspace) {
    return this.webhooks.getEndpoint(workspace);
  }

  @Get('webhooks/deliveries')
  listWebhookDeliveries(
    @CurrentWorkspace() workspace: Workspace,
    @Query('limit') limit?: string,
  ) {
    return this.webhooks.listDeliveries(
      workspace,
      limit ? Number(limit) : undefined,
    );
  }

  @Post('webhooks/deliveries/:id/replay')
  @HttpCode(200)
  replayWebhookDelivery(
    @CurrentWorkspace() workspace: Workspace,
    @Param('id') id: string,
  ) {
    return this.webhooks.replayDelivery(workspace, id);
  }
}
