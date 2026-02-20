# Test Suite - Multi-tenant SaaS Backend Blueprint

Comprehensive test suite per il backend SaaS multi-tenant.

## 📁 Struttura Test

```
test/
├── setup/
│   ├── jest.setup.ts           # Setup globale Jest
│   ├── test-app.factory.ts     # Factory per E2E app
│   ├── test-db.ts              # Helper database test
│   ├── test-redis.ts           # Helper Redis test
│   └── test-helpers.ts         # Factory test data
├── unit/                       # Unit tests (mocked dependencies)
│   ├── organizations.service.spec.ts
│   ├── memberships.service.spec.ts
│   ├── billing.service.spec.ts
│   ├── feature-flags.service.spec.ts
│   └── org-scope.guard.spec.ts
├── integration/                # Integration tests (real DB/Redis)
│   ├── organizations-integration.spec.ts
│   ├── teams-integration.spec.ts
│   ├── billing-integration.spec.ts
│   └── redis.integration.spec.ts
└── e2e/                        # End-to-end tests (full app)
    ├── auth.e2e.spec.ts
    ├── organizations.e2e.spec.ts
    └── teams.e2e.spec.ts
```

## 🚀 Comandi Test

### Unit Tests (Standalone)

Test con dipendenze mockate - **non richiedono infrastruttura esterna**.

```bash
# Esegui tutti i unit test
npm run test:unit

# Watch mode
npm run test:watch

# Coverage
npm run test:cov
```

**Status Unit Tests**: ✅ 66 test passano (5 suite)

- OrganizationsService: 8 test
- MembershipsService: 10 test
- BillingService: 8 test
- FeatureFlagsService: 12 test
- OrgScopeGuard: 28 test

### Integration Tests (Richiedono DB + Redis)

Test con database e Redis reali.

**Prerequisiti**:

```bash
# Start PostgreSQL test database
docker run -d --name sports-test-db \
  -p 5433:5432 \
  -e POSTGRES_PASSWORD=test \
  -e POSTGRES_USER=test \
  -e POSTGRES_DB=sports_intelligence_test \
  postgres:16-alpine

# Start Redis test instance
docker run -d --name sports-test-redis \
  -p 6380:6379 \
  redis:7-alpine

# Run migrations
DATABASE_URL="postgresql://test:test@localhost:5433/sports_intelligence_test" \
  npx prisma migrate deploy
```

**Esecuzione**:

```bash
npm run test:integration
```

**Test Disponibili**: 20 test (4 suite)

- Organizations Integration: 6 test
- Teams Integration: 8 test
- Billing Integration: 6 test
- Redis Integration: 14 test

### E2E Tests (Richiedono App Completa)

Test end-to-end con app NestJS completa + DB.

**Prerequisiti**: PostgreSQL test DB (vedi sopra)

```bash
npm run test:e2e
```

**Test Disponibili**: 34 test (3 suite)

- Auth E2E: 8 test
- Organizations E2E: 13 test
- Teams E2E: 13 test

## 📊 Coverage

Soglie configurate in `jest.config.ts`:

- **Global**: 80% statements, branches, lines, functions
- **Per-file**: 70% statements, branches, lines, functions

```bash
# Genera report coverage
npm run test:cov

# Report HTML (aprire coverage/lcov-report/index.html)
npm run test:cov -- --coverage
```

**Coverage Attuale** (solo unit tests):

- Statements: 52.97% (target: 80%)
- Branches: 18.97% (target: 80%)
- Lines: 50.05% (target: 80%)
- Functions: 32.5% (target: 80%)

> ⚠️ Coverage bassa perché molti controller/service non hanno ancora unit test dedicati (players, subscriptions, health, ecc.). I 66 test attuali coprono i componenti core del multi-tenancy.

## 🔧 Test Infrastructure

### TestAppFactory

Factory per creare app NestJS completa per E2E tests.

```typescript
const app = await TestAppFactory.createApp();
// ... test HTTP endpoints
await TestAppFactory.cleanup(app);
```

### TestDatabase

Helper per gestire database PostgreSQL test.

```typescript
const testDb = new TestDatabase();
await testDb.start();
const prisma = testDb.getPrisma();
// ... test con Prisma
await testDb.stop();
```

### TestDataFactory

Factory per creare dati test consistenti.

- ✅ Test isolati e deterministici
- ✅ Focus su logica business
- ✅ Veloci (<10ms per test)

### Integration Tests

- ✅ Usa database test reale
- ✅ Cleanup tra test (`beforeEach`)
- ✅ Test multi-tenancy isolation
- ✅ Test transazioni e rollback

### E2E Tests

- ✅ Test scenari utente completi
- ✅ Verifica RBAC (OWNER, ADMIN, COACH, VIEWER)
- ✅ Test autenticazione JWT
- ✅ Test limiti piano Free/Pro/Enterprise

## 🐛 Troubleshooting

### Integration/E2E tests falliscono con "Can't reach database"

**Soluzione**: Assicurati che PostgreSQL test sia in esecuzione su porta 5433:

```bash
docker ps | grep sports-test-db
```

### Redis tests falliscono

**Soluzione**: Avvia Redis test su porta 6380:

```bash
docker run -d -p 6380:6379 redis:7-alpine
```

### Unit tests passano ma coverage bassa

**Normale**: Coverage include anche file non testati. Aggiungi test per:

- players.service.ts (25% coverage)
- subscriptions.service.ts (23% coverage)
- teams.service.ts (35% coverage)
- health.service.ts (28% coverage)

### "jest.setTimeout" warnings

**Soluzione**: Test infrastructure aumenta timeout a 30s in `jest.setup.ts` per DB operations.

## 📝 Note Tecniche

### Jest Configuration

- **testTimeout**: 30000ms (30s)
- **testMatch**: `**/*.spec.ts`
- **collectCoverageFrom**: `src/**/*.ts` (esclusi main.ts, _.module.ts, _.dto.ts)
- **moduleNameMapper**: Supporta path alias TypeScript

### Test Environment

Variabili da `.env.test`:

- `DATABASE_URL`: postgresql://test:test@localhost:5433/sports_intelligence_test
- `REDIS_HOST`: localhost
- `REDIS_PORT`: 6380
- `NODE_ENV`: test

### Mocking Strategy

- **PrismaService**: Mocked come `any` per evitare type conflicts con generated client
- **RedisService**: Real per integration, mocked per unit
- **EventBusService**: Mocked per verificare event emission
- **StripeService**: Mocked con fake data

## 🎓 Aggiungere Nuovi Test

### 1. Unit Test

```typescript
import { Test } from '@nestjs/testing';
import { MyService } from './my.service';

describe('MyService', () => {
  let service: MyService;
  let mockDep: any;

  beforeEach(async () => {
    mockDep = { method: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [MyService, { provide: 'Dependency', useValue: mockDep }],
    }).compile();

    service = module.get(MyService);
  });

  it('should do something', () => {
    mockDep.method.mockResolvedValue('result');
    expect(await service.doSomething()).toBe('result');
  });
});
```

### 2. Integration Test

```typescript
import { TestDatabase } from '../setup/test-db';

describe('My Integration Test', () => {
  let testDb: TestDatabase;
  let prisma: PrismaClient;

  beforeAll(async () => {
    testDb = new TestDatabase();
    await testDb.start();
    prisma = testDb.getPrisma();
  });

  afterAll(async () => {
    await testDb.stop();
  });

  beforeEach(async () => {
    await testDb.clean();
  });

  it('should persist to database', async () => {
    const result = await prisma.user.create({ data: {...} });
    expect(result.id).toBeDefined();
  });
});
```

### 3. E2E Test

```typescript
import { TestAppFactory } from '../setup/test-app.factory';
import request from 'supertest';

describe('My E2E Test', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await TestAppFactory.createApp();
  });

  afterAll(async () => {
    await TestAppFactory.cleanup(app);
  });

  it('POST /endpoint', async () => {
    const response = await request(app.getHttpServer())
      .post('/endpoint')
      .set('Authorization', 'Bearer token')
      .send({ data: 'test' });

    expect(response.status).toBe(201);
  });
});
```

## 🚀 Quick Start

Usa lo script automatico per configurare tutto:

```bash
./test/setup-test-env.sh
```

Oppure manualmente:

```bash
# 1. Start databases
docker run -d --name sports-test-db -p 5433:5432 \
  -e POSTGRES_USER=test -e POSTGRES_PASSWORD=test \
  -e POSTGRES_DB=sports_intelligence_test postgres:16-alpine

docker run -d --name sports-test-redis -p 6380:6379 redis:7-alpine

# 2. Run migrations
DATABASE_URL="postgresql://test:test@localhost:5433/sports_intelligence_test" \
  npx prisma migrate deploy

# 3. Run tests
npm run test:unit
```

## 📚 Riferimenti

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [NestJS Testing](https://docs.nestjs.com/fundamentals/testing)
- [Prisma Testing Guide](https://www.prisma.io/docs/guides/testing/unit-testing)
- [Supertest](https://github.com/ladjs/supertest)
