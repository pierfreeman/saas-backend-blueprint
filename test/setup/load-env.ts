import * as dotenv from 'dotenv';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

// override: true is needed because NX pre-loads .env before running targets.
dotenv.config({ path: path.join(workspaceRoot, '.env.test'), override: true });
