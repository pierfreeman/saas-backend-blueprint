import { IsEmail, IsEnum, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { MembershipRole } from '@prisma/client';

export class InviteMemberDto {
  @ApiProperty({
    description: 'Email address of the user to invite',
    example: 'alice@example.com',
  })
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @ApiProperty({
    enum: MembershipRole,
    description: 'Role to assign to the invited user',
    example: MembershipRole.MEMBER,
  })
  @IsEnum(MembershipRole)
  role!: MembershipRole;
}
