import { IsEnum } from 'class-validator';
import { MembershipRole } from '@prisma/client';

export class UpdateMembershipDto {
  @IsEnum(MembershipRole)
  role!: MembershipRole;
}
