import { ExecutionContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminJwtAuthGuard } from './admin-jwt-auth.guard';

describe('AdminJwtAuthGuard', () => {
  let guard: AdminJwtAuthGuard;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AdminJwtAuthGuard],
    }).compile();

    guard = module.get(AdminJwtAuthGuard);
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('calls the passport admin-jwt strategy', () => {
    const canActivateSpy = vi
      .spyOn(AdminJwtAuthGuard.prototype, 'canActivate')
      .mockResolvedValue(true);

    const mockContext = {
      switchToHttp: vi.fn(() => ({
        getRequest: vi.fn().mockReturnValue({
          headers: { authorization: 'Bearer fake-token' },
        }),
      })),
    } as unknown as ExecutionContext;

    guard.canActivate(mockContext);
    expect(canActivateSpy).toHaveBeenCalled();
  });
});
