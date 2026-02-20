export class BlockedRequestDto {
  reason!: string;
  endpoint!: string;
  method!: string;
  ip!: string;
  timestamp!: string;
  userId?: string;
  orgId?: string;
  metadata?: Record<string, unknown>;
}
