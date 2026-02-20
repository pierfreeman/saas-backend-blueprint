import { HttpException, HttpStatus } from '@nestjs/common';

export class SecurityIncidentException extends HttpException {
  constructor(
    status: HttpStatus,
    message: string,
    reason: string,
    metadata: Record<string, unknown> = {},
  ) {
    super(
      {
        message,
        reason,
        metadata,
      },
      status,
    );
  }
}
