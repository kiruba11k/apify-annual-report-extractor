// src/utils/logger.js
// Structured logger with Apify log integration

import { Actor, log as apifyLog } from 'apify';

const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };

class Logger {
  constructor(context = 'Actor') {
    this.context = context;
    this.level = process.env.LOG_LEVEL ? LOG_LEVELS[process.env.LOG_LEVEL] : LOG_LEVELS.INFO;
  }

  _format(level, message, meta = {}) {
    const ts = new Date().toISOString();
    return { timestamp: ts, level, context: this.context, message, ...meta };
  }

  debug(message, meta = {}) {
    if (this.level <= LOG_LEVELS.DEBUG) {
      apifyLog.debug(`[${this.context}] ${message}`, meta);
    }
  }

  info(message, meta = {}) {
    if (this.level <= LOG_LEVELS.INFO) {
      apifyLog.info(`[${this.context}] ${message}`, meta);
    }
  }

  warn(message, meta = {}) {
    if (this.level <= LOG_LEVELS.WARN) {
      apifyLog.warning(`[${this.context}] ${message}`, meta);
    }
  }

  error(message, meta = {}) {
    apifyLog.error(`[${this.context}] ${message}`, meta);
  }

  child(childContext) {
    return new Logger(`${this.context}:${childContext}`);
  }
}

export const createLogger = (context) => new Logger(context);
export default new Logger('Main');
