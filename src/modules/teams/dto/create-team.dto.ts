import { IsString, IsNotEmpty, MinLength } from 'class-validator';

export class CreateTeamDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  name!: string;
}
