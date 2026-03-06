/**
 * Jest setupFile — loaded in each Jest worker BEFORE test files are imported.
 *
 * Loads .env.test into process.env so that:
 *  1. NestJS ConfigModule picks up test database URLs and auth config.
 *  2. PrismaBusinessService.cleanDatabase() passes the NODE_ENV=test check.
 *
 * This runs in the SAME Node.js process as the test files, so process.env
 * changes here ARE visible to all tests in this worker.
 */
import * as dotenv from 'dotenv';
import * as path from 'path';

// override: true is needed because NX pre-loads .env before running targets.
dotenv.config({ path: path.join(process.cwd(), '.env.test'), override: true });
