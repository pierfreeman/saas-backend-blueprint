/** Input to LegalAuditService.recordEvent() */
export interface LegalAuditEvent {
  /**
   * Typed event name using dot-notation.
   * Examples: 'org.created', 'gdpr.consent.revoked', 'org.deleted'
   */
  eventType: string;
  /**
   * Organisation scope. Stored as a plain UUID string — no FK constraint —
   * so the record survives org deletion without modification.
   */
  orgId?: string | null;
  /** Internal UUID of the user who triggered the event. Null for system-initiated events. */
  userId?: string | null;
  /** RBAC role of the actor at the time of the event (e.g. 'OWNER', 'system'). */
  actorRole?: string | null;
  /**
   * Describes what triggered the event.
   * Use one of: 'user_action' | 'admin_action' | 'system' | 'api' | 'scheduler'
   */
  triggerType?: string | null;
  /**
   * Sanitised structured context for the event.
   * Must NOT contain raw PII, credentials, or secrets.
   */
  metadata?: Record<string, unknown>;
}
