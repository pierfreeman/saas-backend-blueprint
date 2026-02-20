# Code Quality Tools

ESLint and Prettier configuration for Multi-tenant SaaS Backend Blueprint Backend project.

## Configurations

- **ESLint**: `.eslintrc.js` - TypeScript linting with strict rules
- **Prettier**: `.prettierrc` - Consistent code formatting
- **EditorConfig**: `.editorconfig` - Universal editor configuration

## Main Rules

### ESLint

- **No `any`**: `any` type forbidden in production (allowed only in tests)
- **No unused vars**: Unused variables must start with `_`
- **No floating promises**: All promises must be awaited or handled
- **Naming conventions**: Interfaces without `I` prefix
- **Strict TypeScript**: Await thenable, no misused promises

### Prettier

- **Single quotes**: `'` instead of `"`
- **Semicolons**: Required
- **Trailing commas**: All (better for git diff)
- **Print width**: 100 characters
- **Tab width**: 2 spaces
- **Line ending**: LF (Unix)

## Commands

### Linting

```bash
# Auto-fix ESLint issues
npm run lint

# Check without modifications (for CI/CD)
npm run lint:check
```

### Formatting

```bash
# Format all code
npm run format

# Check formatting without modifications (for CI/CD)
npm run format:check
```

### Pre-commit (Recommended)

Run before every commit:

```bash
npm run format && npm run lint
```

### Security-focused Tests

Run security middleware tests before merging security-related changes:

```bash
npm test -- --runInBand \
  test/security/attack-detection.service.spec.ts \
  test/security/payload-sanitization.middleware.spec.ts \
  test/security/security-layer.integration.spec.ts
```

## Editor Integration

### VS Code

Install extensions:

- [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint)
- [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)
- [EditorConfig](https://marketplace.visualstudio.com/items?itemName=EditorConfig.EditorConfig)

Configuration `.vscode/settings.json`:

```json
{
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "eslint.validate": ["typescript"],
  "prettier.requireConfig": true
}
```

### WebStorm / IntelliJ IDEA

- ESLint: Activates automatically
- Prettier: File → Settings → Languages → Prettier → On save
- EditorConfig: Native support

## Detailed Rules

### Secure Coding Baseline

- Validate and sanitize untrusted input (`body`, `query`, `params`)
- Avoid introducing dynamic SQL string composition
- Never trust client-side authorization context without server checks
- Keep auth and RBAC checks explicit at controller/guard level
- Emit audit/security events for blocked or suspicious behavior

### TypeScript Strict Rules

```typescript
// ❌ Forbidden
const data: any = fetchData();
function unused(param) {} // param not used

// ✅ Correct
const data: UserData = fetchData();
function process(_unusedParam: string) {} // _ prefix
```

### Promise Handling

```typescript
// ❌ Forbidden
bootstrap(); // floating promise

// ✅ Correct
void bootstrap(); // explicitly ignored
// or
bootstrap().catch(console.error);
```

### Naming Conventions

```typescript
// ❌ Forbidden
interface IUser {}

// ✅ Correct
interface User {}
```

## Test Files

Rules for test files (`.spec.ts`, `.e2e-spec.ts`, `test/**/*.ts`) are more permissive:

- `any` allowed (for mocking)
- `console.log` allowed (for debugging)

For security tests, prefer deterministic mocks for Redis/event bus and assert:

- Correct HTTP status for blocked requests (`400/403/413/429`)
- Security events emitted (`security.blocked`, `security.suspicious`)
- No regression on valid payload paths

## Troubleshooting

### ESLint can't find files

```bash
# Cache clear
rm -rf node_modules/.cache
npm run lint
```

### ESLint/Prettier conflicts

The configuration uses `eslint-config-prettier` which disables ESLint rules conflicting with Prettier.

### TypeScript version errors

ESLint supports TypeScript `>=4.3.5 <5.4.0`. The project uses TypeScript 5.3.3 (compatible).

## Resources

- [ESLint Rules](https://eslint.org/docs/rules/)
- [TypeScript ESLint](https://typescript-eslint.io/rules/)
- [Prettier Options](https://prettier.io/docs/en/options.html)
- [EditorConfig](https://editorconfig.org/)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/)
