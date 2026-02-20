import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { UploadSessionEntity } from '../entities/upload-session.entity';
import { StorageProvider, UploadSessionStatus, Prisma } from '@prisma/client';

@Injectable()
export class UploadSessionService {
  private readonly logger = new Logger(UploadSessionService.name);
  private readonly defaultExpirationHours = 24;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new upload session
   */
  async createSession(data: {
    orgId: string;
    userId: string;
    fileName: string;
    mimeType: string;
    expectedSize: bigint;
    storageProvider: StorageProvider;
    uploadProviderId: string;
    expectedParts?: number;
    metadata?: Record<string, unknown>;
  }): Promise<UploadSessionEntity> {
    this.logger.debug(`Creating upload session for file: ${data.fileName}`);

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + this.defaultExpirationHours);

    const session = await this.prisma.uploadSession.create({
      data: {
        orgId: data.orgId,
        userId: data.userId,
        fileName: data.fileName,
        mimeType: data.mimeType,
        expectedSize: data.expectedSize,
        storageProvider: data.storageProvider,
        uploadProviderId: data.uploadProviderId,
        status: UploadSessionStatus.INITIATED,
        expectedParts: data.expectedParts,
        uploadedParts: 0,
        metadata: data.metadata as Prisma.InputJsonValue,
        expiresAt,
      },
    });

    return new UploadSessionEntity(session);
  }

  /**
   * Find session by ID
   */
  async findById(sessionId: string): Promise<UploadSessionEntity | null> {
    const session = await this.prisma.uploadSession.findUnique({
      where: { id: sessionId },
    });

    return session ? new UploadSessionEntity(session) : null;
  }

  /**
   * Find session by ID with error throwing
   */
  async findByIdOrFail(sessionId: string): Promise<UploadSessionEntity> {
    const session = await this.findById(sessionId);
    if (!session) {
      throw new NotFoundException(`Upload session not found: ${sessionId}`);
    }
    return session;
  }

  /**
   * Update session status
   */
  async updateStatus(sessionId: string, status: UploadSessionStatus): Promise<UploadSessionEntity> {
    this.logger.debug(`Updating session ${sessionId} status to: ${status}`);

    const session = await this.prisma.uploadSession.update({
      where: { id: sessionId },
      data: { status },
    });

    return new UploadSessionEntity(session);
  }

  /**
   * Update provider upload ID
   */
  async updateUploadProviderId(
    sessionId: string,
    uploadProviderId: string,
  ): Promise<UploadSessionEntity> {
    this.logger.debug(`Updating session ${sessionId} upload provider ID`);

    const session = await this.prisma.uploadSession.update({
      where: { id: sessionId },
      data: { uploadProviderId },
    });

    return new UploadSessionEntity(session);
  }

  /**
   * Increment uploaded parts count
   */
  async incrementUploadedParts(sessionId: string): Promise<UploadSessionEntity> {
    const session = await this.prisma.uploadSession.update({
      where: { id: sessionId },
      data: {
        uploadedParts: { increment: 1 },
        status: UploadSessionStatus.UPLOADING,
      },
    });

    return new UploadSessionEntity(session);
  }

  /**
   * Mark session as completed
   */
  async completeSession(sessionId: string): Promise<UploadSessionEntity> {
    this.logger.debug(`Completing upload session: ${sessionId}`);

    const session = await this.prisma.uploadSession.update({
      where: { id: sessionId },
      data: { status: UploadSessionStatus.COMPLETED },
    });

    return new UploadSessionEntity(session);
  }

  /**
   * Abort session
   */
  async abortSession(sessionId: string): Promise<UploadSessionEntity> {
    this.logger.debug(`Aborting upload session: ${sessionId}`);

    const session = await this.prisma.uploadSession.update({
      where: { id: sessionId },
      data: { status: UploadSessionStatus.ABORTED },
    });

    return new UploadSessionEntity(session);
  }

  /**
   * Find expired sessions
   */
  async findExpiredSessions(limit: number = 100): Promise<UploadSessionEntity[]> {
    const sessions = await this.prisma.uploadSession.findMany({
      where: {
        expiresAt: { lt: new Date() },
        status: {
          in: [UploadSessionStatus.INITIATED, UploadSessionStatus.UPLOADING],
        },
      },
      take: limit,
      orderBy: { expiresAt: 'asc' },
    });

    return sessions.map((session) => new UploadSessionEntity(session));
  }

  /**
   * Mark expired sessions
   */
  async markExpiredSessions(): Promise<number> {
    this.logger.debug('Marking expired upload sessions');

    const result = await this.prisma.uploadSession.updateMany({
      where: {
        expiresAt: { lt: new Date() },
        status: {
          in: [UploadSessionStatus.INITIATED, UploadSessionStatus.UPLOADING],
        },
      },
      data: { status: UploadSessionStatus.EXPIRED },
    });

    this.logger.log(`Marked ${result.count} sessions as expired`);
    return result.count;
  }

  /**
   * Validate session is active and not expired
   */
  async validateSession(sessionId: string): Promise<UploadSessionEntity> {
    const session = await this.findByIdOrFail(sessionId);

    if (session.status === UploadSessionStatus.COMPLETED) {
      throw new BadRequestException('Upload session already completed');
    }

    if (session.status === UploadSessionStatus.ABORTED) {
      throw new BadRequestException('Upload session was aborted');
    }

    if (session.status === UploadSessionStatus.EXPIRED) {
      throw new BadRequestException('Upload session has expired');
    }

    if (session.expiresAt < new Date()) {
      // Mark as expired
      await this.updateStatus(sessionId, UploadSessionStatus.EXPIRED);
      throw new BadRequestException('Upload session has expired');
    }

    return session;
  }

  /**
   * Find sessions by organization
   */
  async findByOrg(
    orgId: string,
    options?: {
      status?: UploadSessionStatus;
      limit?: number;
      offset?: number;
    },
  ): Promise<UploadSessionEntity[]> {
    const where: Prisma.UploadSessionWhereInput = { orgId };

    if (options?.status) {
      where.status = options.status;
    }

    const sessions = await this.prisma.uploadSession.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: options?.limit || 100,
      skip: options?.offset || 0,
    });

    return sessions.map((session) => new UploadSessionEntity(session));
  }

  /**
   * Delete old completed/aborted sessions (cleanup)
   */
  async deleteOldSessions(daysOld: number = 7): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const result = await this.prisma.uploadSession.deleteMany({
      where: {
        createdAt: { lt: cutoffDate },
        status: {
          in: [
            UploadSessionStatus.COMPLETED,
            UploadSessionStatus.ABORTED,
            UploadSessionStatus.EXPIRED,
          ],
        },
      },
    });

    this.logger.log(`Deleted ${result.count} old upload sessions`);
    return result.count;
  }
}
