import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { MembershipRole } from '@prisma/client';

export class UpdateMembershipDto {
  @ApiProperty({
    enum: MembershipRole,
    enumName: 'MembershipRole',
    description:
      'New role to assign to the member. ' +
      'OWNER has full control; ADMIN can manage members; ' +
      'MEMBER has standard access; READ_ONLY can only view.',
    example: MembershipRole.ADMIN,
  })
  @IsEnum(MembershipRole)
  role!: MembershipRole;
}
