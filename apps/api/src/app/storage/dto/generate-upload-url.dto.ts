import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNumber, IsPositive, MaxLength } from 'class-validator';

export class GenerateUploadUrlDto {
  @ApiProperty({
    description: 'Original filename',
    example: 'document.pdf',
    maxLength: 255,
  })
  @IsString()
  @MaxLength(255)
  filename!: string;

  @ApiProperty({
    description: 'MIME type of the file',
    example: 'application/pdf',
  })
  @IsString()
  mimeType!: string;

  @ApiProperty({
    description: 'File size in bytes',
    example: 1048576,
    minimum: 1,
  })
  @IsNumber()
  @IsPositive()
  size!: number;
}
