import { IsString, IsNotEmpty, IsEnum } from 'class-validator';
import { MembershipRole } from '@prisma/client';

export class CreateMembershipDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @IsString()
  @IsNotEmpty()
  orgId!: string;

  @IsEnum(MembershipRole)
  role!: MembershipRole;
}
