import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';

export interface RequestStore {
  correlationId: string;
  requestId: string;
  workspaceId?: string;
  method?: string;
  path?: string;
  startTimeMs: number;
}

export const requestContextStorage = new AsyncLocalStorage<RequestStore>();

export function getCurrentContext(): RequestStore | undefined {
  return requestContextStorage.getStore();
}

export function getCorrelationId(): string {
  return requestContextStorage.getStore()?.correlationId ?? randomUUID();
}

export class StructuredLogger {
  constructor(private readonly context: string) {}

  info(message: string, meta: Record<string, unknown> = {}): void {
    this.emit('INFO', message, meta);
  }

  warn(message: string, meta: Record<string, unknown> = {}): void {
    this.emit('WARN', message, meta);
  }

  error(message: string, meta: Record<string, unknown> = {}): void {
    this.emit('ERROR', message, meta);
  }

  private emit(
    level: 'INFO' | 'WARN' | 'ERROR',
    message: string,
    meta: Record<string, unknown>,
  ): void {
    if (process.env.NODE_ENV === 'test' && level !== 'ERROR') {
      return;
    }
    const store = getCurrentContext();
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      service: 'signaldesk',
      context: this.context,
      correlationId: store?.correlationId,
      requestId: store?.requestId,
      workspaceId: store?.workspaceId,
      message,
      ...meta,
    };
    const line = JSON.stringify(entry);
    if (level === 'ERROR') {
      process.stderr.write(`${line}\n`);
    } else {
      process.stdout.write(`${line}\n`);
    }
  }
}
