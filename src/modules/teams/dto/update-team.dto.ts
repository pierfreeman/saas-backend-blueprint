import { IsString, IsNotEmpty, MinLength } from 'class-validator';

export class UpdateTeamDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  name!: string;
}
