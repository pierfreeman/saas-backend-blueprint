import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminMeController } from './admin-me.controller';
import { AdminIdentityService } from '@libs/admin/identity';

describe('AdminMeController', () => {
  let controller: AdminMeController;

  const mockAdminIdentityService = {
    findByIdOrThrow: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminMeController],
      providers: [
        {
          provide: AdminIdentityService,
          useValue: mockAdminIdentityService,
        },
      ],
    }).compile();

    controller = module.get(AdminMeController);
  });

  it('delegates to adminIdentityService.findByIdOrThrow', async () => {
    const profile = {
      adminUserId: 'uuid-1',
      auth0Id: 'auth0|abc',
      email: 'admin@example.com',
      displayName: 'Admin',
    };
    mockAdminIdentityService.findByIdOrThrow.mockResolvedValue(profile);

    const result = await controller.getMe('uuid-1');

    expect(mockAdminIdentityService.findByIdOrThrow).toHaveBeenCalledWith(
      'uuid-1',
    );
    expect(result).toBe(profile);
  });
});
