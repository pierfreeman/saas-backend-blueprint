# Example: Integrating Observability into Existing Service

This example shows how to add observability to an existing NestJS service.

## Before: Original Code

```typescript
// src/modules/organizations/services/organizations.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  async createOrganization(dto: CreateOrganizationDto, userId: string) {
    // No logging

    const organization = await this.prisma.organization.create({
      data: {
        name: dto.name,
        ownerId: userId,
      },
    });

    // No success log

    return organization;
  }

  async getOrganization(id: string) {
    // No logging
    
    const organization = await this.prisma.organization.findUnique({
      where: { id },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    return organization;
  }
}
```

## After: With Observability

```typescript
// src/modules/organizations/services/organizations.service.ts
import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { APP_LOGGER, IAppLogger } from '@/observability';

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_LOGGER) private readonly logger: IAppLogger, // ✅ Inject logger
  ) {}

  async createOrganization(dto: CreateOrganizationDto, userId: string) {
    // ✅ Log operation start
    this.logger.log(
      'Creating organization',
      'OrganizationsService',
      {
        userId,
        organizationName: dto.name,
      },
    );

    try {
      const organization = await this.prisma.organization.create({
        data: {
          name: dto.name,
          ownerId: userId,
        },
      });

      // ✅ Log success
      this.logger.log(
        'Organization created successfully',
        'OrganizationsService',
        {
          organizationId: organization.id,
          userId,
        },
      );

      return organization;
    } catch (error) {
      // ✅ Log error with context
      this.logger.error(
        'Failed to create organization',
        error instanceof Error ? error.stack : undefined,
        'OrganizationsService',
        {
          userId,
          dto,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      );
      throw error;
    }
  }

  async getOrganization(id: string) {
    // ✅ Log operation (debug level for reads)
    this.logger.debug(
      'Fetching organization',
      'OrganizationsService',
      { organizationId: id },
    );
    
    try {
      const organization = await this.prisma.organization.findUnique({
        where: { id },
      });

      if (!organization) {
        // ✅ Log not found scenario
        this.logger.warn(
          'Organization not found',
          'OrganizationsService',
          { organizationId: id },
        );
        throw new NotFoundException('Organization not found');
      }

      return organization;
    } catch (error) {
      // Only log unexpected errors (not NotFoundException)
      if (!(error instanceof NotFoundException)) {
        this.logger.error(
          'Error fetching organization',
          error instanceof Error ? error.stack : undefined,
          'OrganizationsService',
          { organizationId: id },
        );
      }
      throw error;
    }
  }
}
```

## What Changed?

1. **Imported observability**: `APP_LOGGER` and `IAppLogger`
2. **Injected logger**: Using `@Inject(APP_LOGGER)`
3. **Added structured logging**:
   - Operation start logs
   - Success logs with IDs
   - Error logs with full context
   - Warning logs for expected failures
4. **Included metadata**: User IDs, resource IDs, DTOs for debugging
5. **Proper error handling**: Try-catch with context logging

## Benefits

### Before
- ❌ No visibility into operations
- ❌ Errors lost in void
- ❌ No correlation between requests
- ❌ Difficult to debug in production

### After
- ✅ Full operation visibility
- ✅ All errors captured with context
- ✅ Automatic request correlation (requestId, userId, orgId)
- ✅ Easy debugging with structured logs
- ✅ Sentry/Datadog integration in production

## Log Output Examples

### Local Development (Console)

```
[Nest] 12345  - 01/15/2026, 10:30:45 AM   LOG [OrganizationsService] Creating organization {"userId":"user-123","organizationName":"Acme Corp","requestId":"req-abc"}

[Nest] 12345  - 01/15/2026, 10:30:46 AM   LOG [OrganizationsService] Organization created successfully {"organizationId":"org-456","userId":"user-123","requestId":"req-abc"}
```

### Production with Sentry

Event captured in Sentry with:
- **Message**: "Failed to create organization"
- **Context**: OrganizationsService
- **Tags**: requestId, userId, organizationId
- **Extra Data**: dto, error message, stack trace
- **User**: Automatically linked to userId from JWT

### Production with Datadog

Structured JSON log:
```json
{
  "timestamp": "2026-01-15T10:30:45.123Z",
  "level": "info",
  "message": "Organization created successfully",
  "service": "sports-intelligence-backend",
  "env": "production",
  "dd.trace_id": "req-abc",
  "usr.id": "user-123",
  "organization.id": "org-456",
  "metadata": {
    "organizationId": "org-456",
    "userId": "user-123"
  }
}
```

## Best Practices Applied

1. **Context Name**: Always use the class name ("OrganizationsService")
2. **Meaningful Messages**: Clear, actionable log messages
3. **Structured Metadata**: Include relevant IDs and context
4. **Log Levels**:
   - `debug` for read operations
   - `log` for write operations
   - `warn` for expected failures
   - `error` for unexpected failures
5. **Error Context**: Always include stack trace and relevant data
6. **No Sensitive Data**: Passwords/tokens already masked automatically

## Migration Checklist

For each service:

- [ ] Import `APP_LOGGER` and `IAppLogger` from observability
- [ ] Inject logger in constructor with `@Inject(APP_LOGGER)`
- [ ] Add operation start logs (log/debug level)
- [ ] Add success logs with resource IDs
- [ ] Wrap risky operations in try-catch
- [ ] Log errors with full context
- [ ] Include metadata for debugging
- [ ] Test locally with `APP_ENV=local`

## Common Patterns

### Controller Logging

```typescript
@Post()
async create(@Body() dto: CreateDto, @GetUser() user: User) {
  this.logger.log('Create request received', 'OrganizationsController', {
    userId: user.id,
  });
  
  const result = await this.service.create(dto, user.id);
  
  return result; // Service already logged success
}
```

### Background Job Logging

```typescript
@Cron('0 0 * * *')
async dailyReport() {
  this.logger.log('Starting daily report generation', 'ReportService');
  
  try {
    const report = await this.generateReport();
    
    this.logger.log('Daily report generated', 'ReportService', {
      reportId: report.id,
      recordCount: report.count,
    });
  } catch (error) {
    this.logger.error(
      'Failed to generate daily report',
      error.stack,
      'ReportService',
    );
    // Don't throw - let cron continue
  }
}
```

### Event Handler Logging

```typescript
@OnEvent('organization.created')
async handleOrganizationCreated(event: OrganizationCreatedEvent) {
  this.logger.log('Handling organization.created event', 'EventHandlers', {
    organizationId: event.organizationId,
  });
  
  try {
    await this.notifyUsers(event);
    
    this.logger.log('Notification sent successfully', 'EventHandlers', {
      organizationId: event.organizationId,
    });
  } catch (error) {
    this.logger.error(
      'Failed to send notification',
      error.stack,
      'EventHandlers',
      { event },
    );
    throw error; // Re-throw for event retry
  }
}
```

## Next Steps

1. Identify your most critical services
2. Apply this pattern service by service
3. Test locally first
4. Deploy and monitor in Sentry/Datadog
5. Iterate based on production insights

Remember: **Logging is not about quantity, it's about quality!** Log meaningful operations with useful context.
