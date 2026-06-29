import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';
import { isProd } from '../config/env.js';

/** 404 handler — reached when no route matched. */
export function notFound(req, res, next) {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

/** Central error handler. Must keep all four args for Express to detect it. */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  let statusCode = err.statusCode ?? 500;
  let message = err.message ?? 'Internal Server Error';
  let details = err.details;

  // Translate common Mongoose/Mongo errors into clean HTTP responses.
  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = 'Validation failed';
    details = Object.values(err.errors).map((e) => e.message);
  } else if (err.code === 11000) {
    statusCode = 409;
    message = 'Duplicate key';
    details = err.keyValue;
  } else if (err.name === 'CastError') {
    statusCode = 400;
    message = `Invalid ${err.path}: ${err.value}`;
  }

  if (statusCode >= 500) {
    logger.error({ err, reqId: req.id }, 'Unhandled error');
  }

  res.status(statusCode).json({
    error: {
      message,
      ...(details ? { details } : {}),
      ...(isProd ? {} : { stack: err.stack }),
    },
  });
}
