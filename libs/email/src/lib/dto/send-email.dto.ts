import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { EmailTemplateName } from '../types/email-template.type';

/**
 * DTO for sending a transactional email.
 * Validated before being forwarded to the EmailProvider.
 */
export class SendEmailDto {
  @IsEmail()
  to!: string;

  @IsString()
  @IsNotEmpty()
  subject!: string;

  @IsString()
  @IsNotEmpty()
  html!: string;

  @IsString()
  @IsOptional()
  text?: string;

  @IsString()
  @IsOptional()
  template?: EmailTemplateName;

  @IsString()
  @IsOptional()
  orgId?: string;

  @IsString()
  @IsOptional()
  recipientUserId?: string;
}
