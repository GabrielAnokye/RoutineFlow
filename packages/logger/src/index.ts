import pino, { type LevelWithSilent, type Logger } from 'pino';

export interface CreateLoggerOptions {
  level?: LevelWithSilent;
  name?: string;
}

/**
 * Creates the shared Pino logger used across runner-facing surfaces.
 */
export function createLogger(options: CreateLoggerOptions = {}): Logger {
  return pino({
    level: options.level ?? 'info',
    name: options.name ?? 'routineflow',
    base: null
  });
}
