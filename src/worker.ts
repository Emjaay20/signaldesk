import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { IngestProcessor } from './ingests/ingest.processor';
import { StructuredLogger } from './observability/request-context';

const POLL_MS = Number(process.env.INGEST_POLL_MS) || 1000;
const logger = new StructuredLogger('IngestWorker');

async function main() {
  const prisma = new PrismaClient();
  const processor = new IngestProcessor(prisma);
  let shuttingDown = false;
  let activeTick = false;

  logger.info('worker_started', { pollIntervalMs: POLL_MS });

  const tick = async () => {
    if (shuttingDown || activeTick) {
      return;
    }
    activeTick = true;
    try {
      const n = await processor.processPending();
      if (n > 0) {
        logger.info('worker_batch_processed', { ingestsCompleted: n });
      }
    } catch (err) {
      logger.error('worker_tick_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      activeTick = false;
    }
  };

  await tick();
  const timer = setInterval(() => {
    void tick();
  }, POLL_MS);

  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    clearInterval(timer);
    logger.info('worker_graceful_shutdown_initiated', { signal });
    while (activeTick) {
      await new Promise((r) => setTimeout(r, 50));
    }
    await prisma.$disconnect();
    logger.info('worker_graceful_shutdown_complete', { signal });
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
