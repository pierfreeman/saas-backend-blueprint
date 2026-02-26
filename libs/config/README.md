# @libs/config

NestJS `ConfigModule` wrapper. Loads and validates environment variables on startup and exposes them through typed namespaces via `ConfigService`.

---

## Importing

`ConfigModule` is **global** — import it once in `AppModule`:

```typescript
import { ConfigModule } from '@libs/config';

@Module({
  imports: [ConfigModule],
})
export class AppModule {}
```

All other modules can inject `ConfigService` without re-importing `ConfigModule`.

---

## Configuration namespaces

| Namespace  | Env variables                                | Access key                                                    |
| ---------- | -------------------------------------------- | ------------------------------------------------------------- |
| `app`      | `NODE_ENV`, `PORT`                           | `app.nodeEnv`, `app.port`                                     |
| `auth`     | `AUTH0_DOMAIN`, `AUTH0_AUDIENCE`             | `auth.domain`, `auth.audience`, `auth.issuer`, `auth.jwksUri` |
| `database` | `DATABASE_URL`                               | `database.url`                                                |
| `redis`    | `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` | `redis.host`, `redis.port`, `redis.password`                  |

### Reading a value

```typescript
import { ConfigService } from '@nestjs/config';

constructor(private readonly config: ConfigService) {}

const port   = this.config.get<number>('app.port');          // 3000
const domain = this.config.get<string>('auth.domain');       // 'your-tenant.auth0.com'
const dbUrl  = this.config.get<string>('database.url');
const redisHost = this.config.get<string>('redis.host');
```

---

## Environment variable validation

All variables are validated at startup using **Joi** (`libs/config/src/env.validation.ts`). The application refuses to start if a required variable is missing or has an invalid type (`abortEarly: true`).

| Variable         | Required | Default       | Constraints                         |
| ---------------- | :------: | ------------- | ----------------------------------- |
| `NODE_ENV`       |          | `development` | `development \| production \| test` |
| `PORT`           |          | `3000`        | number                              |
| `DATABASE_URL`   |    ✓     | —             | non-empty string                    |
| `REDIS_HOST`     |    ✓     | —             | non-empty string                    |
| `REDIS_PORT`     |          | `6379`        | number                              |
| `REDIS_PASSWORD` |          | —             | optional string                     |
| `AUTH0_DOMAIN`   |    ✓     | —             | non-empty string                    |
| `AUTH0_AUDIENCE` |    ✓     | —             | non-empty string                    |

### Adding a new variable

1. Add the Joi rule to `libs/config/src/env.validation.ts`.
2. Add the value to the relevant namespace factory (e.g. `app.config.ts`) or create a new one with `registerAs('namespace', () => ({ ... }))`.
3. Add the new factory to the `load` array in `libs/config/src/config.module.ts`.
4. Update the table above and the root `README.md` environment variables table.

---

## Future: secrets manager

When migrating to AWS Secrets Manager or HashiCorp Vault, replace the `load` array in `config.module.ts` with async factory functions that pull values remotely. All consumers remain unchanged because they still access values via `configService.get('namespace.key')`.

---

## Nx tasks

```sh
npx nx build config    # compile
npx nx lint config     # lint
```
