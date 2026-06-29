import pino from 'pino';
import { config, isProd } from '../config/env.js';

// JSON logs in production, pretty-printed in development.
export const logger = pino({
  level: config.logLevel,
  transport: isProd
    ? undefined
    : {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:HH:MM:ss' },
      },
});
