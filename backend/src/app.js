import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { randomUUID } from 'crypto';
import pinoHttp from 'pino-http';
import routes from './routes/index.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';
import { logger } from './utils/logger.js';

// Builds the app without connecting to infra, so tests can import it directly.
export function createApp() {
  const app = express();

  app.set('trust proxy', 1); // honour X-Forwarded-For behind a proxy

  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '100kb' }));

  app.use((req, _res, next) => {
    req.id = req.headers['x-request-id'] || randomUUID();
    next();
  });
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.id,
      autoLogging: { ignore: (req) => req.url === '/healthz' },
    })
  );

  app.use('/api', routes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
