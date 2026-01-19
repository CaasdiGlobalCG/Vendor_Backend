/**
 * Logger Utility
 * Simple console-based logger for the application
 */

const isDev = process.env.NODE_ENV !== 'production';

export const logger = {
  info: (message, data) => {
    console.log(`[${new Date().toISOString()}] [INFO] ${message}`, data || '');
  },

  warn: (message, data) => {
    console.warn(`[${new Date().toISOString()}] [WARN] ${message}`, data || '');
  },

  error: (message, error) => {
    if (error instanceof Error) {
      console.error(`[${new Date().toISOString()}] [ERROR] ${message}`, {
        message: error.message,
        stack: isDev ? error.stack : undefined,
        code: error.code
      });
    } else {
      console.error(`[${new Date().toISOString()}] [ERROR] ${message}`, error || '');
    }
  },

  debug: (message, data) => {
    if (isDev) {
      console.debug(`[${new Date().toISOString()}] [DEBUG] ${message}`, data || '');
    }
  }
};

export default logger;
