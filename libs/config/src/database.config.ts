import { registerAs } from '@nestjs/config';

export default registerAs('database', () => ({
  url: process.env['DATABASE_URL'],
  legalAuditUrl: process.env['LEGAL_AUDIT_DATABASE_URL'],
}));
