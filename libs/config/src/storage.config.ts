import { registerAs } from '@nestjs/config';

export interface StorageConfig {
  defaultProvider: 'S3' | 'AZURE';
  s3: {
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
    endpoint?: string;
  };
  azure: {
    storageAccount: string;
    storageKey: string;
    container: string;
    endpoint?: string;
  };
  uploadSession: {
    expirationHours: number;
    retentionDays: number;
  };
  presignedUrl: {
    expirationSeconds: number;
  };
  quotas: {
    freePlan: {
      storageLimitGb?: number;
      fileCountLimit?: number;
      maxFileSizeGb?: number;
    };
    proPlan: {
      storageLimitGb?: number;
      fileCountLimit?: number;
      maxFileSizeGb?: number;
    };
    enterprisePlan: {
      storageLimitGb?: number;
      fileCountLimit?: number;
      maxFileSizeGb?: number;
    };
  };
  cleanup: {
    enabled: boolean;
    expiredSessionsCron?: string;
    oldSessionsCron?: string;
    expiredUploadsCron?: string;
  };
}

export default registerAs(
  'storage',
  (): StorageConfig => ({
    defaultProvider:
      (process.env['DEFAULT_STORAGE_PROVIDER'] as 'S3' | 'AZURE') ?? 'S3',
    s3: {
      region: process.env['AWS_REGION'] ?? 'us-east-1',
      accessKeyId: process.env['AWS_ACCESS_KEY_ID'] ?? '',
      secretAccessKey: process.env['AWS_SECRET_ACCESS_KEY'] ?? '',
      bucket: process.env['AWS_S3_BUCKET'] ?? '',
      endpoint: process.env['AWS_S3_ENDPOINT'],
    },
    azure: {
      storageAccount: process.env['AZURE_STORAGE_ACCOUNT'] ?? '',
      storageKey: process.env['AZURE_STORAGE_KEY'] ?? '',
      container: process.env['AZURE_STORAGE_CONTAINER'] ?? '',
      endpoint: process.env['AZURE_STORAGE_ENDPOINT'],
    },
    uploadSession: {
      expirationHours: parseInt(
        process.env['UPLOAD_SESSION_EXPIRATION_HOURS'] ?? '24',
        10,
      ),
      retentionDays: parseInt(
        process.env['UPLOAD_SESSION_RETENTION_DAYS'] ?? '7',
        10,
      ),
    },
    presignedUrl: {
      expirationSeconds: parseInt(
        process.env['PRESIGNED_URL_EXPIRATION_SECONDS'] ?? '3600',
        10,
      ),
    },
    quotas: {
      freePlan: {
        storageLimitGb: process.env['FREE_PLAN_STORAGE_LIMIT_GB']
          ? parseFloat(process.env['FREE_PLAN_STORAGE_LIMIT_GB'])
          : 1,
        fileCountLimit: process.env['FREE_PLAN_FILE_COUNT_LIMIT']
          ? parseInt(process.env['FREE_PLAN_FILE_COUNT_LIMIT'], 10)
          : 100,
        maxFileSizeGb: process.env['FREE_PLAN_MAX_FILE_SIZE_GB']
          ? parseFloat(process.env['FREE_PLAN_MAX_FILE_SIZE_GB'])
          : 0.1,
      },
      proPlan: {
        storageLimitGb: process.env['PRO_PLAN_STORAGE_LIMIT_GB']
          ? parseFloat(process.env['PRO_PLAN_STORAGE_LIMIT_GB'])
          : 50,
        fileCountLimit: process.env['PRO_PLAN_FILE_COUNT_LIMIT']
          ? parseInt(process.env['PRO_PLAN_FILE_COUNT_LIMIT'], 10)
          : 10000,
        maxFileSizeGb: process.env['PRO_PLAN_MAX_FILE_SIZE_GB']
          ? parseFloat(process.env['PRO_PLAN_MAX_FILE_SIZE_GB'])
          : 20,
      },
      enterprisePlan: {
        storageLimitGb: process.env['ENTERPRISE_PLAN_STORAGE_LIMIT_GB']
          ? parseFloat(process.env['ENTERPRISE_PLAN_STORAGE_LIMIT_GB'])
          : undefined,
        fileCountLimit: process.env['ENTERPRISE_PLAN_FILE_COUNT_LIMIT']
          ? parseInt(process.env['ENTERPRISE_PLAN_FILE_COUNT_LIMIT'], 10)
          : undefined,
        maxFileSizeGb: process.env['ENTERPRISE_PLAN_MAX_FILE_SIZE_GB']
          ? parseFloat(process.env['ENTERPRISE_PLAN_MAX_FILE_SIZE_GB'])
          : 100,
      },
    },
    cleanup: {
      enabled: process.env['STORAGE_CLEANUP_ENABLED'] !== 'false',
      expiredSessionsCron: process.env['STORAGE_CLEANUP_EXPIRED_SESSIONS_CRON'],
      oldSessionsCron: process.env['STORAGE_CLEANUP_OLD_SESSIONS_CRON'],
      expiredUploadsCron: process.env['STORAGE_CLEANUP_EXPIRED_UPLOADS_CRON'],
    },
  }),
);
