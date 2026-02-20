export class NotificationResponseDto {
  id!: string;
  userId!: string;
  type!: string;
  title!: string;
  body!: string;
  metadata?: Record<string, any> | null;
  readAt!: Date | null;
  createdAt!: Date;
}
