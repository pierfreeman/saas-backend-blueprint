import { Injectable } from '@nestjs/common';
import { PrismaBusinessService } from '@libs/prisma-business';

@Injectable()
export class AiConversationRepository {
  constructor(private readonly prisma: PrismaBusinessService) {}

  // TODO: Implement conversation persistence methods
}
