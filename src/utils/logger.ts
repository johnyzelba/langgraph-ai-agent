import winston from 'winston';
import path from 'path';
import { env } from '../config/env';

const { combine, timestamp, printf, colorize, errors } = winston.format;

// Define custom log info type
interface LogInfo {
  level: string;
  message: string;
  timestamp?: string;
  stack?: string;
  [key: string]: unknown;
}

// Custom format for console output
const consoleFormat = printf((info) => {
  const { level, message, timestamp, ...metadata } = info;
  let msg = `${timestamp} [${level}]: ${message}`;
  
  // Extract stack if it exists
  const stack = metadata.stack as string | undefined;
  delete metadata.stack;
  
  if (Object.keys(metadata).length > 0) {
    msg += ` ${JSON.stringify(metadata)}`;
  }
  
  if (stack) {
    msg += `\n${stack}`;
  }
  
  return msg;
});

// Custom format for file output
const fileFormat = printf((info) => {
  const { level, message, timestamp, ...metadata } = info;
  const log: Record<string, unknown> = {
    timestamp,
    level,
    message,
    ...metadata,
  };
  
  return JSON.stringify(log);
});

// Create the logger
export const logger = winston.createLogger({
  level: env.LOG_LEVEL,
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true }),
  ),
  transports: [
    // Console transport
    new winston.transports.Console({
      format: combine(
        colorize(),
        consoleFormat,
      ),
    }),
    // File transport for all logs
    new winston.transports.File({
      filename: path.join(process.cwd(), 'logs', env.LOG_FILE),
      format: fileFormat,
    }),
    // File transport for errors only
    new winston.transports.File({
      filename: path.join(process.cwd(), 'logs', 'error.log'),
      level: 'error',
      format: fileFormat,
    }),
  ],
  exitOnError: false,
});

// Create a child logger for specific modules
export const createLogger = (module: string): winston.Logger => {
  return logger.child({ module });
};

// Log unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', { promise, reason });
});

// Log uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
}); 