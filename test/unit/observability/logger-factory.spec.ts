import { ConfigService } from '@nestjs/config';
import { LoggerFactory } from '../../../src/observability/logging/logger.factory';
import { NestLoggerAdapter } from '../../../src/observability/logging/adapters/nest-logger.adapter';
import { SentryLogger } from '../../../src/observability/logging/adapters/sentry.logger';
import { DatadogLogger } from '../../../src/observability/logging/adapters/datadog.logger';

describe('LoggerFactory', () => {
  let configService: ConfigService;

  beforeEach(() => {
    configService = new ConfigService();
  });

  describe('createLogger', () => {
    it('should return NestLoggerAdapter for local environment', () => {
      jest.spyOn(configService, 'get').mockImplementation((key: string) => {
        if (key === 'APP_ENV') return 'local';
        if (key === 'LOG_PROVIDER') return 'nest';
        if (key === 'LOG_LEVEL') return 'debug';
        return undefined;
      });

      const logger = LoggerFactory.createLogger(configService);

      expect(logger).toBeInstanceOf(NestLoggerAdapter);
    });

    it('should return NestLoggerAdapter for dev environment', () => {
      jest.spyOn(configService, 'get').mockImplementation((key: string) => {
        if (key === 'APP_ENV') return 'dev';
        if (key === 'LOG_PROVIDER') return 'sentry';
        if (key === 'LOG_LEVEL') return 'debug';
        return undefined;
      });

      const logger = LoggerFactory.createLogger(configService);

      expect(logger).toBeInstanceOf(NestLoggerAdapter);
    });

    it('should return SentryLogger when configured in staging', () => {
      jest.spyOn(configService, 'get').mockImplementation((key: string) => {
        if (key === 'APP_ENV') return 'staging';
        if (key === 'LOG_PROVIDER') return 'sentry';
        if (key === 'SENTRY_DSN') return 'https://example@sentry.io/123';
        if (key === 'LOG_LEVEL') return 'info';
        return undefined;
      });

      const logger = LoggerFactory.createLogger(configService);

      expect(logger).toBeInstanceOf(SentryLogger);
    });

    it('should return DatadogLogger when configured in prod', () => {
      jest.spyOn(configService, 'get').mockImplementation((key: string) => {
        if (key === 'APP_ENV') return 'prod';
        if (key === 'LOG_PROVIDER') return 'datadog';
        if (key === 'DATADOG_API_KEY') return 'test-api-key';
        if (key === 'LOG_LEVEL') return 'warn';
        return undefined;
      });

      const logger = LoggerFactory.createLogger(configService);

      expect(logger).toBeInstanceOf(DatadogLogger);
    });

    it('should fallback to NestLoggerAdapter when Sentry DSN is missing', () => {
      jest.spyOn(configService, 'get').mockImplementation((key: string) => {
        if (key === 'APP_ENV') return 'staging';
        if (key === 'LOG_PROVIDER') return 'sentry';
        if (key === 'SENTRY_DSN') return '';
        if (key === 'LOG_LEVEL') return 'info';
        return undefined;
      });

      const logger = LoggerFactory.createLogger(configService);

      expect(logger).toBeInstanceOf(NestLoggerAdapter);
    });

    it('should fallback to NestLoggerAdapter when Datadog API key is missing', () => {
      jest.spyOn(configService, 'get').mockImplementation((key: string) => {
        if (key === 'APP_ENV') return 'prod';
        if (key === 'LOG_PROVIDER') return 'datadog';
        if (key === 'DATADOG_API_KEY') return '';
        if (key === 'LOG_LEVEL') return 'info';
        return undefined;
      });

      const logger = LoggerFactory.createLogger(configService);

      expect(logger).toBeInstanceOf(NestLoggerAdapter);
    });

    it('should return NestLoggerAdapter for unknown provider', () => {
      jest.spyOn(configService, 'get').mockImplementation((key: string) => {
        if (key === 'APP_ENV') return 'staging';
        if (key === 'LOG_PROVIDER') return 'unknown' as any;
        if (key === 'LOG_LEVEL') return 'info';
        return undefined;
      });

      const logger = LoggerFactory.createLogger(configService);

      expect(logger).toBeInstanceOf(NestLoggerAdapter);
    });
  });
});
