import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { MembershipRole } from '@prisma/client';

export class UpdateMembershipDto {
  @ApiProperty({ enum: MembershipRole, description: 'New role for the member' })
  @IsEnum(MembershipRole)
  role!: MembershipRole;
}
