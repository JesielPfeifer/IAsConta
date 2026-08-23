import fs from 'fs';
import path from 'path';
import winston from 'winston';
import type TransportStream from 'winston-transport';
import DailyRotateFile from 'winston-daily-rotate-file';

// ──────────────────────────────────────────────────────────────────────────────
// Logger do IAsConta — arquivo de texto rotacionado por dia + console (espelho)
// - Arquivo: {LOG_DIR}/iasconta-YYYY-MM-DD.log   (default: ./logs)
// - Retenção: 30 dias
// - Nível: LOG_LEVEL (padrão: debug)
// ──────────────────────────────────────────────────────────────────────────────

const logDir = process.env.LOG_DIR || path.join(process.cwd(), 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const fileTransport: TransportStream = new DailyRotateFile({
  dirname: logDir,
  filename: 'iasconta-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  maxFiles: '30d',
  zippedArchive: false,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    winston.format.errors({ stack: true }),
    winston.format.json(),
  ),
}) as unknown as TransportStream;

const consoleTransport = new winston.transports.Console({
  format: winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
    winston.format.printf(({ level, message, module, ...meta }: any) => {
      const mod = module ? `[${module}] ` : '';
      const rest = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
      return `${String(meta.timestamp || '').slice(0, 8)} ${level.padEnd(7)} ${mod}${message}${rest}`;
    }),
  ),
});

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'debug',
  format: winston.format.combine(winston.format.timestamp(), winston.format.errors({ stack: true })),
  transports: [fileTransport, consoleTransport],
  exitOnError: false,
});

export function createModuleLogger(module: string) {
  return logger.child({ module });
}

export default logger;
