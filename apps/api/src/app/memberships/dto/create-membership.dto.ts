import { IsString, IsNotEmpty, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { MembershipRole } from '@prisma/client';

export class CreateMembershipDto {
  @ApiProperty({
    description: 'ID of the user to add',
    example: 'uuid-of-user',
  })
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @ApiProperty({
    enum: MembershipRole,
    description: 'Role to assign',
    example: MembershipRole.MEMBER,
  })
  @IsEnum(MembershipRole)
  role!: MembershipRole;
}
