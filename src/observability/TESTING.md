# Observability Module - Testing Guide

## Running Tests

### All Observability Tests

```bash
npm test -- test/unit/observability
```

### Specific Test File

```bash
npm test -- test/unit/observability/logger-factory.spec.ts
```

### With Coverage

```bash
npm run test:cov -- --testPathPattern=observability
```

### Watch Mode

```bash
npm test -- test/unit/observability --watch
```

## Test Structure

```
test/unit/observability/
├── logger-factory.spec.ts              # Logger provider selection
├── nest-logger-adapter.spec.ts         # NestJS Logger wrapper
├── request-context-service.spec.ts     # Context management
├── request-context-middleware.spec.ts  # HTTP middleware
├── websocket-context-helper.spec.ts    # WebSocket context
└── websocket-logger.spec.ts            # WebSocket logging
```

## Test Coverage

Current coverage:

- **LoggerFactory**: Provider selection logic
- **NestLoggerAdapter**: Context enrichment
- **RequestContextService**: AsyncLocalStorage operations
- **RequestContextMiddleware**: Request ID extraction and context initialization
- **WebSocketContextHelper**: Socket context management
- **WebSocketLogger**: Event logging and sanitization

## Expected Output

```
PASS  test/unit/observability/logger-factory.spec.ts
PASS  test/unit/observability/nest-logger-adapter.spec.ts
PASS  test/unit/observability/request-context-service.spec.ts
PASS  test/unit/observability/request-context-middleware.spec.ts
PASS  test/unit/observability/websocket-context-helper.spec.ts
PASS  test/unit/observability/websocket-logger.spec.ts

Test Suites: 6 passed, 6 total
Tests:       42 passed, 42 total
```

## Integration Testing

To test the full integration:

1. **Start the application locally**:
   ```bash
   npm run start:dev
   ```

2. **Make a request**:
   ```bash
   curl http://localhost:3000/health
   ```

3. **Check console output**:
   - Should see logs with `requestId`
   - Should see request context in logs

4. **Test error logging**:
   ```typescript
   // In any controller
   throw new Error('Test error for observability');
   ```
   - Check console for error log with stack trace

5. **Test WebSocket** (after integration):
   ```typescript
   // Connect WebSocket client
   // Check console for connection logs with userId
   ```

## Manual Testing Checklist

### Logger Factory
- [ ] Returns NestJS Logger in local env
- [ ] Returns NestJS Logger in dev env
- [ ] Returns Sentry Logger when DSN configured
- [ ] Returns Datadog Logger when API key configured
- [ ] Falls back to NestJS Logger on missing config
- [ ] Falls back to NestJS Logger on error

### Request Context
- [ ] Generates UUID request ID
- [ ] Uses client request ID if provided
- [ ] Extracts userId from JWT
- [ ] Extracts orgId from JWT or header
- [ ] Sets X-Request-Id response header
- [ ] Context available in async operations

### WebSocket Context
- [ ] Initializes socket with request ID
- [ ] Sets user context after authentication
- [ ] Tracks context across event handlers
- [ ] Logs connection with context
- [ ] Logs disconnection with reason

### Sensitive Data Masking
- [ ] Passwords are redacted
- [ ] Tokens are redacted
- [ ] API keys are redacted
- [ ] Authorization headers are redacted
- [ ] Normal data is not affected

## Troubleshooting Tests

### Tests Failing with "Cannot find module"

**Solution**: Install dependencies
```bash
npm install
```

### Tests Failing with TypeScript Errors

**Solution**: Build the project first
```bash
npm run build
npm test
```

### Tests Timing Out

**Solution**: Increase timeout in jest.config.ts
```typescript
testTimeout: 30000, // 30 seconds
```

### Console Output Too Verbose

**Solution**: Mock console in beforeEach
```typescript
beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation();
  jest.spyOn(console, 'error').mockImplementation();
});
```

## CI/CD Integration

Add to your CI pipeline:

```yaml
# Example for GitHub Actions
- name: Run Observability Tests
  run: npm test -- test/unit/observability --ci --coverage

- name: Upload Coverage
  uses: codecov/codecov-action@v3
  with:
    files: ./coverage/lcov.info
    flags: observability
```

## Adding New Tests

When adding new features:

1. Create test file: `test/unit/observability/new-feature.spec.ts`
2. Follow existing patterns
3. Test happy path + error cases
4. Mock external dependencies (Sentry, Datadog)
5. Run tests locally before committing

Example template:

```typescript
import { NewFeature } from '../../../src/observability/new-feature';

describe('NewFeature', () => {
  let feature: NewFeature;

  beforeEach(() => {
    feature = new NewFeature();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('method', () => {
    it('should do something', () => {
      // Arrange
      const input = 'test';

      // Act
      const result = feature.method(input);

      // Assert
      expect(result).toBe('expected');
    });

    it('should handle errors', () => {
      // Test error case
    });
  });
});
```

## Coverage Goals

Target coverage for observability module:

- **Statements**: > 80%
- **Branches**: > 75%
- **Functions**: > 80%
- **Lines**: > 80%

Check coverage:

```bash
npm run test:cov
open coverage/lcov-report/index.html
```

## Test Data

Use these test values consistently:

- Request ID: `req-123`
- User ID: `user-456`
- Org ID: `org-789`
- Socket ID: `socket-123`
- Email: `user@example.com`

This makes tests more readable and maintainable.
