jest.mock('ioredis', () => {
  const instance = {
    on: jest.fn(),
    quit: jest.fn().mockResolvedValue('OK'),
    publish: jest.fn().mockResolvedValue(1),
  };
  const Ctor: any = jest.fn(() => instance);
  Ctor.__instance = instance;
  return { __esModule: true, default: Ctor };
});

import Redis from 'ioredis';
import { PubSubService } from './pubsub.service';

const mockClient: any = (Redis as any).__instance;

describe('PubSubService', () => {
  let service: PubSubService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PubSubService();
  });

  describe('publish', () => {
    it('serializes the payload and publishes to the channel', async () => {
      await service.publish('notifications:org-1', {
        type: 'new-message',
        data: 42,
      });
      expect(mockClient.publish).toHaveBeenCalledWith(
        'notifications:org-1',
        JSON.stringify({ type: 'new-message', data: 42 }),
      );
    });

    it('re-throws when Redis publish fails', async () => {
      mockClient.publish.mockRejectedValueOnce(new Error('READONLY'));
      await expect(service.publish('ch', {})).rejects.toThrow('READONLY');
    });
  });

  describe('getRedis', () => {
    it('returns the underlying Redis client instance', () => {
      expect(service.getRedis()).toBe(mockClient);
    });
  });

  describe('onModuleDestroy', () => {
    it('calls quit on the Redis client', async () => {
      await service.onModuleDestroy();
      expect(mockClient.quit).toHaveBeenCalledTimes(1);
    });
  });
});
