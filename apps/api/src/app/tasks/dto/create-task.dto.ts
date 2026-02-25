import { IsString, IsNotEmpty, IsOptional, IsObject } from "class-validator";

/**
 * Create Task DTO
 * Validates request body for task creation
 */
export class CreateTaskDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsObject()
  @IsOptional()
  data?: Record<string, any>;
}
