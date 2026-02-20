import { Injectable, Logger } from '@nestjs/common';
import { EventBusService } from '../../../events/event-bus.service';
import { BlockedRequestDto } from '../dto/blocked-request.dto';

@Injectable()
export class SecurityLoggerService {
  private readonly logger = new Logger(SecurityLoggerService.name);

  constructor(private readonly eventBus: EventBusService) {}

  logBlockedRequest(payload: BlockedRequestDto): void {
    this.logger.warn(
      `Blocked request ${payload.method} ${payload.endpoint} from ${payload.ip} (${payload.reason})`,
    );

    this.eventBus.emit({
      eventType: 'security.blocked',
      timestamp: new Date(payload.timestamp),
      organizationId: payload.orgId,
      userId: payload.userId,
      payload: { ...payload },
    });
  }

  logSuspiciousActivity(payload: BlockedRequestDto): void {
    this.logger.warn(
      `Suspicious activity detected ${payload.method} ${payload.endpoint} from ${payload.ip} (${payload.reason})`,
    );

    this.eventBus.emit({
      eventType: 'security.suspicious',
      timestamp: new Date(payload.timestamp),
      organizationId: payload.orgId,
      userId: payload.userId,
      payload: { ...payload },
    });

    this.eventBus.emit({
      eventType: 'security.alert.admin',
      timestamp: new Date(payload.timestamp),
      organizationId: payload.orgId,
      userId: payload.userId,
      payload: { ...payload },
    });
  }
}
