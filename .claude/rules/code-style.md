# Code Style Rules

These rules apply to **all code** in this monorepo. They are non-negotiable.

---

## NestJS conventions

1. **Constructor injection** — standard NestJS pattern with `private readonly`.
2. **Decorators** — use `@Injectable()`, `@Controller()`, `@Module()` appropriately.
3. **Feature modules** — every lib has a `{name}.module.ts` that wires providers/exports.
4. **Thin controllers** — controllers delegate immediately to library services. No business logic in controllers.
5. **DTOs** in `apps/api/src/app/{feature}/dto/` — use `class-validator` + `class-transformer`.

```ts
// ✅ Correct controller pattern
@Controller('organizations/:orgId/memberships')
@UseGuards(JwtAuthGuard, OrgContextGuard, RBACGuard)
@OrgScoped()
export class MembershipsController {
  constructor(private readonly membershipsService: MembershipsService) {}

  @Post()
  @RequirePermissions([PERMISSIONS.ORG_MEMBERS_INVITE])
  async create(@Body() dto: CreateMembershipDto): Promise<Membership> {
    return this.membershipsService.create(/* ... */);
  }
}
```

---

## Service conventions

1. **Application services** are the public API of a library — never repositories.
2. **Only inject services**, never foreign repositories.
3. **Existence check before mutate** — `findById()` → `NotFoundException`.
4. **Org-scoped validation** — verify `entity.orgId === orgId`.
5. **Dual audit on every CUD** — `activityLog.logActivity()` + `legalAudit.recordEvent()` (fire-and-forget).
6. **Optional cross-cutting providers** — `@Optional() @Inject(TOKEN)` for audit/email dependencies.

```ts
@Injectable()
export class MembershipsService {
  constructor(
    private readonly membershipsRepository: MembershipsRepository,
    private readonly emailService: EmailService, // ← other lib services OK
    // Never: private readonly userRepo: UserRepository  ← foreign repo FORBIDDEN
  ) {}
}
```

---

## Repository conventions

1. **Single-aggregate** — each repository owns one Prisma model.
2. **Only place for Prisma calls** — never call Prisma directly in services.
3. **Never exported** — not from `index.ts`, not from module `exports[]`.
4. **Multi-aggregate coordination** belongs in application services, not repositories.

---

## DTO conventions

1. **`class-validator`** + **`class-transformer`** decorators on all fields.
2. **`@ApiProperty()`** with description, example, enum for Swagger.
3. **All properties use `!:`** (definite assignment).
4. **Naming**: `Create{Resource}Dto`, `Update{Resource}Dto`, `{Action}{Resource}Dto`.
5. **Update DTOs**: all fields `@IsOptional()`.
6. **Global `ValidationPipe`**: `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`.

```ts
export class CreateMembershipDto {
  @ApiProperty({
    description: 'Email of the user to invite',
    example: 'user@example.com',
  })
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @ApiProperty({ enum: MembershipRole, description: 'Role to assign' })
  @IsEnum(MembershipRole)
  role!: MembershipRole;
}
```

---

## Module conventions

1. **`imports`** — other lib modules you depend on.
2. **`providers`** — all internal services and repositories.
3. **`exports`** — **only application services** — never repositories, clients, or providers.

```ts
@Module({
  imports: [PrismaBusinessModule, ActivityLogModule, LegalAuditModule],
  providers: [MembershipsRepository, MembershipsService],
  exports: [MembershipsService], // ← never MembershipsRepository
})
export class MembershipsModule {}
```

---

## Barrel (`index.ts`) conventions

- Export module + application services + domain types only.
- **Never export** repositories, infrastructure clients, or providers.

```ts
export * from './memberships.module';
export * from './application/services/memberships.service';
// MembershipsRepository is NOT exported
```

---

## File naming and placement

| Artifact              | Location                                       | Name pattern               |
| --------------------- | ---------------------------------------------- | -------------------------- |
| Application service   | `libs/{name}/src/application/services/`        | `{name}.service.ts`        |
| Repository            | `libs/{name}/src/infrastructure/repositories/` | `{name}.repository.ts`     |
| Domain port           | `libs/{name}/src/domain/ports/`                | `{name}.interface.ts`      |
| Infrastructure client | `libs/{name}/src/infrastructure/clients/`      | `{name}.client.ts`         |
| Event handler         | `libs/{name}/src/application/event-handlers/`  | `{event-name}.handler.ts`  |
| Controller            | `apps/api/src/app/{feature}/`                  | `{feature}.controller.ts`  |
| DTO                   | `apps/api/src/app/{feature}/dto/`              | `create-{resource}.dto.ts` |
| Module                | `libs/{name}/src/`                             | `{name}.module.ts`         |
| Spec file             | Same directory as source                       | `{name}.spec.ts`           |
| Prisma schema         | `prisma/`                                      | `{model}.prisma`           |

---

## Error handling

- Use `@nestjs/common` exceptions: `NotFoundException`, `ForbiddenException`, `BadRequestException`.
- Global `AllExceptionsFilter` shapes responses: `{ statusCode, timestamp, path, method, message }`.
- 5xx errors captured by Sentry via `ObservabilityExceptionFilter`.

---

## Anti-patterns (explicitly forbidden)

| Anti-pattern                                  | Use instead                                      |
| --------------------------------------------- | ------------------------------------------------ |
| Import foreign repository                     | Import the application service                   |
| Export repository from module/barrel          | Export only application services                 |
| Business logic in controllers                 | Delegate to library services                     |
| Business logic in apps/                       | Extract to libs/                                 |
| Domain event handlers in apps/                | Place in libs/{name}/application/event-handlers/ |
| Prisma calls outside repositories             | Use repository methods                           |
| Multi-aggregate operations in repositories    | Coordinate in application services               |
| App service bypassing lib's application layer | Go through the lib's public service              |
