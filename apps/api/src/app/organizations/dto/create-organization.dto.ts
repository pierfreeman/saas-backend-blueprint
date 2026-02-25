import { IsString, IsNotEmpty, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateOrganizationDto {
  @ApiProperty({
    description: 'Organization name',
    example: 'Acme Corp',
    minLength: 3,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  name!: string;
}
