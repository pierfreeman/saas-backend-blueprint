/**
 * Event type constants for organization data export events.
 * Used for event bus communication between API and worker.
 */
export const ORG_EXPORT_EVENT_TYPES = {
  EXPORT_REQUESTED: 'org.export.requested',
  EXPORT_STARTED: 'org.export.started',
  EXPORT_COMPLETED: 'org.export.completed',
  EXPORT_FAILED: 'org.export.failed',
} as const;

export type OrgExportEventType =
  (typeof ORG_EXPORT_EVENT_TYPES)[keyof typeof ORG_EXPORT_EVENT_TYPES];
