# Testing Rules

Two independent test suites: **unit tests** and **integration tests**.
Both use **Vitest 4**. No E2E browser tests.

---

## Test runner and config

- **Runner**: Vitest 4
- **Unit config**: Each project has its own `vite.config.ts`
- **Integration config**: `apps/api-e2e/`, `apps/worker-a-e2e/`
- **Workspace**: `vitest.workspace.ts` aggregates 25 projects
- **Path resolution**: `@libs/*` aliases work in tests via `tsconfig.base.json`

---

## Commands

```sh
# Unit tests
npm run test:unit                      # All projects
npx nx test api                        # Single project
npx nx test memberships                # Single library
npm run test:watch                     # Watch mode

# Integration tests
npm run test:infra:up                  # Start test containers (Postgres ×2, Redis, LocalStack)
npm run test:migrate                   # Apply migrations to test DBs (once per fresh container)
npm run test:integration               # Both suites sequentially
npm run test:integration:api           # API integration only
npm run test:integration:worker        # Worker integration only
npm run test:infra:down                # Stop test containers

# Coverage
npm run test:coverage                  # Unit → coverage/unit/
npm run test:coverage:integration      # Integration → coverage/integration/
```

---

## File placement

Every source file has its spec file **alongside it** in the same directory:

```
{name}.service.ts
{name}.service.spec.ts        ← always co-located

{name}.repository.ts
{name}.repository.spec.ts

{name}.controller.ts
{name}.controller.spec.ts
```

**Never** create `tests/`, `__tests__/`, or `spec/` directories.

---

## Unit test pattern

Use NestJS `Test.createTestingModule()`. Mock all injected dependencies with `vi.fn()`.
**Never use real Prisma** in unit tests — mock the repository.

```ts
describe('JobService', () => {
  let service: JobService;
  const mockRepository = {
    create: vi.fn(),
    findByIdAndOrg: vi.fn(),
    markDone: vi.fn(),
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        JobService,
        { provide: JobRepository, useValue: mockRepository },
      ],
    }).compile();

    service = module.get(JobService);
  });

  it('delegates create to the repository', async () => {
    await service.create('id', 'orgId', 'TYPE', {});
    expect(mockRepository.create).toHaveBeenCalledWith(
      'id',
      'orgId',
      'TYPE',
      {},
      undefined,
    );
  });
});
```

---

## Integration test pattern

Integration tests use **real databases** and **supertest** for HTTP assertions.
Located in `apps/api-e2e/src/api/` and `apps/worker-a-e2e/`.

- Full app bootstrap with real DB connections
- `nock-auth.ts` mocks Auth0 JWKS for JWT validation
- `test-keys/` contains RSA key pair for JWT signing in tests
- `cleanDatabase()` runs between test files
- `maxWorkers: 1`, `isolate: false` (shared state, sequential execution)
- 60-second timeout per test

---

## Mocking guidelines

1. **Mock all injected dependencies** — services, repositories, external clients.
2. **Use `vi.fn()`** for function mocks.
3. **Use `useValue`** in `Test.createTestingModule` providers.
4. **Never call real Prisma** in unit tests.
5. **Optional providers** — use `@Optional() @Inject()` pattern; mock or omit in tests.
6. **Reset mocks** in `beforeEach` to avoid test pollution.

---

## What to test

| Artifact            | Test focus                                                       |
| ------------------- | ---------------------------------------------------------------- |
| Application service | Business logic, delegation to repository, cross-lib coordination |
| Repository          | Prisma query construction (integration tests)                    |
| Controller          | Route binding, DTO validation, guard application                 |
| Guard               | Allow/deny conditions, context injection                         |
| Interceptor         | Request/response transformation                                  |
| Event handler       | Event consumption, side-effect triggering                        |
| Middleware          | Header extraction, request mutation                              |

---

## Coverage

- Unit: `coverage/unit/`
- Integration: `coverage/integration/`
- Format: html + lcov

---

## Testing anti-patterns

| Anti-pattern                         | Correct approach                          |
| ------------------------------------ | ----------------------------------------- |
| Real Prisma in unit tests            | Mock the repository                       |
| Tests in separate `tests/` directory | Co-locate `.spec.ts` next to source file  |
| Parallel integration tests           | `maxWorkers: 1` — they share the database |
| Testing implementation details       | Test behavior and outcomes                |
| No cleanup between integration tests | `cleanDatabase()` between test files      |
| Skipping mock resets                 | Reset in `beforeEach`                     |
