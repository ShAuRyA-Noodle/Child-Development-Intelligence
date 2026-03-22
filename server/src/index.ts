import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { env } from './config/env.js';
import { authRoutes } from './routes/auth.js';
import { childrenRoutes } from './routes/children.js';
import { assessmentRoutes } from './routes/assessments.js';
import { riskScoreRoutes } from './routes/risk-scores.js';
import { alertRoutes } from './routes/alerts.js';
import { interventionRoutes } from './routes/interventions.js';
import { analyticsRoutes } from './routes/analytics.js';
import { syncRoutes } from './routes/sync.js';
import { initializeQueues, startWorkers, closeQueues } from './jobs/queue.js';

// ─── Server bootstrap ──────────────────────────────────────────────────────────

async function buildServer() {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
      transport:
        env.NODE_ENV !== 'production'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
    },
  });

  // ─── Plugins ────────────────────────────────────────────────────────────────

  await app.register(cors, {
    origin: env.NODE_ENV === 'production'
      ? ['https://ecd.ap.gov.in']
      : true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await app.register(jwt, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: env.JWT_EXPIRY },
  });

  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    keyGenerator: (request) => {
      return request.ip;
    },
  });

  // ─── Health check ───────────────────────────────────────────────────────────

  app.get('/api/v1/health', async (_request, reply) => {
    return reply.send({
      status: 'healthy',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      environment: env.NODE_ENV,
    });
  });

  // ─── Routes ─────────────────────────────────────────────────────────────────

  await app.register(authRoutes);
  await app.register(childrenRoutes);
  await app.register(assessmentRoutes);
  await app.register(riskScoreRoutes);
  await app.register(alertRoutes);
  await app.register(interventionRoutes);
  await app.register(analyticsRoutes);
  await app.register(syncRoutes);

  // ─── Global error handler ──────────────────────────────────────────────────

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);

    if (error.validation) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: error.message,
        details: error.validation,
      });
    }

    const statusCode = error.statusCode ?? 500;
    return reply.status(statusCode).send({
      error: statusCode >= 500 ? 'Internal Server Error' : error.name,
      message: env.NODE_ENV === 'production' && statusCode >= 500
        ? 'An unexpected error occurred'
        : error.message,
    });
  });

  return app;
}

// ─── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const app = await buildServer();

  // Initialize BullMQ queues and workers (gracefully handle Redis unavailability)
  try {
    initializeQueues();
    startWorkers();
    app.log.info('BullMQ queues and workers initialized');
  } catch (err) {
    app.log.warn('BullMQ initialization failed (Redis may not be available): %s', (err as Error).message);
    app.log.warn('Risk scoring, alert generation, and notification jobs will not run until Redis is available');
  }

  // Start server
  try {
    const address = await app.listen({ port: env.PORT, host: '0.0.0.0' });
    app.log.info(`ECD Intelligence API server listening on ${address}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  // ─── Graceful shutdown ────────────────────────────────────────────────────

  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, shutting down gracefully...`);

    try {
      await closeQueues();
      app.log.info('BullMQ queues closed');
    } catch (err) {
      app.log.warn('Error closing BullMQ queues: %s', (err as Error).message);
    }

    try {
      await app.close();
      app.log.info('Fastify server closed');
    } catch (err) {
      app.log.error('Error closing server: %s', (err as Error).message);
    }

    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Handle uncaught errors
  process.on('unhandledRejection', (reason) => {
    app.log.error({ err: reason }, 'Unhandled rejection');
  });

  process.on('uncaughtException', (err) => {
    app.log.error({ err }, 'Uncaught exception');
    process.exit(1);
  });
}

main();
