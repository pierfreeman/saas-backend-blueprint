import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';
import { BlockedRequestDto } from '../dto/blocked-request.dto';
import { SecurityIncidentException } from '../services/security-incident.exception';
import { SecurityLoggerService } from '../services/security-logger.service';
import { SecurityRequest } from '../types/security-request.interface';

@Catch(SecurityIncidentException)
export class SecurityExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(SecurityExceptionsFilter.name);

  constructor(private readonly securityLogger: SecurityLoggerService) {}

  catch(exception: SecurityIncidentException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<SecurityRequest>();
    const response = ctx.getResponse<Response>();

    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse() as {
      message?: string;
      reason?: string;
      metadata?: Record<string, unknown>;
    };

    const message = exceptionResponse.message || 'Security policy violation';
    const reason = exceptionResponse.reason || 'security_incident';
    const metadata = exceptionResponse.metadata || {};

    const blockedRequest: BlockedRequestDto = {
      reason,
      endpoint: request.path || request.url,
      method: request.method,
      ip: request.securityContext?.ip || request.ip || 'unknown',
      timestamp: new Date().toISOString(),
      userId: request.securityContext?.userId,
      orgId: request.securityContext?.orgId,
      metadata,
    };

    this.securityLogger.logBlockedRequest(blockedRequest);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.url} blocked by security layer`,
        exception.stack,
      );
    }

    response.status(status).json({
      statusCode: status,
      timestamp: blockedRequest.timestamp,
      path: request.url,
      method: request.method,
      reason,
      message,
    });
  }
}
