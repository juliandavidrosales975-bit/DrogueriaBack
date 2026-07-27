import { env } from '@config/env';

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

const levels: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const currentLevel = levels[env.logLevel as LogLevel] || levels.info;

const log = (level: LogLevel, message: string, meta?: any) => {
  if (levels[level] <= currentLevel) {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
    
    if (meta) {
      console[level === 'error' ? 'error' : 'log'](prefix, message, meta);
    } else {
      console[level === 'error' ? 'error' : 'log'](prefix, message);
    }
  }
};

export const logger = {
  info: (message: string, meta?: any) => log('info', message, meta),
  warn: (message: string, meta?: any) => log('warn', message, meta),
  error: (message: string, meta?: any) => log('error', message, meta),
  debug: (message: string, meta?: any) => log('debug', message, meta),
};
