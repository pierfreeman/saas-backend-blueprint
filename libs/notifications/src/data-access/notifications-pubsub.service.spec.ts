/**
 * Unit tests for NotificationsPubSubService.
 *
 * Two ioredis connections are created (publisher first, subscriber second).
 * We capture them via Ctor.__instances so each test can reference both.
 */
jest.mock('ioredis', () => {
  const makeInstance = () => ({
    publish: jest.fn().mockResolvedValue(1),
    psubscribe: jest.fn().mockResolvedValue(undefined),
    subscribe: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
    quit: jest.fn().mockResolvedValue('OK'),
  });

  const Ctor: any = jest.fn(() => {
    const inst = makeInstance();
    Ctor.__instances.push(inst);
    return inst;
  });
  Ctor.__instances = [];

  return { __esModule: true, default: Ctor };
});

import Redis from 'ioredis';
import { NotificationsPubSubService } from './notifications-pubsub.service';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_PATTERNS,
} from '../types/notification.types';

type IoRedisMock = {
  publish: jest.Mock;
  psubscribe: jest.Mock;
  subscribe: jest.Mock;
  on: jest.Mock;
  quit: jest.Mock;
};

const getInstances = (): [IoRedisMock, IoRedisMock] =>
  (Redis as any).__instances as [IoRedisMock, IoRedisMock];

/** Extract a listener registered via subscriber.on(eventName, fn). */
function getListener(
  subscriber: IoRedisMock,
  eventName: string,
): ((...args: unknown[]) => void) | undefined {
  const call = (subscriber.on as jest.Mock).mock.calls.find(
    ([ev]: [string]) => ev === eventName,
  );
  return call?.[1] as ((...args: unknown[]) => void) | undefined;
}

describe('NotificationsPubSubService', () => {
  let service: NotificationsPubSubService;

  beforeEach(() => {
    jest.clearAllMocks();
    (Redis as any).__instances = [];
    service = new NotificationsPubSubService();
  });

  // ── publishUserNotification ───────────────────────────────────────────────

  describe('publishUserNotification', () => {
    it('publishes to the correct user channel', async () => {
      const userId = 'user-abc';
      const msg = buildMsg(userId);
      const [publisher] = getInstances();

      await service.publishUserNotification(userId, msg);

      expect(publisher.publish).toHaveBeenCalledTimes(1);
      const [channel, raw] = publisher.publish.mock.calls[0] as [
        string,
        string,
      ];
      expect(channel).toBe(NOTIFICATION_CHANNELS.user(userId));

      const parsed = JSON.parse(raw) as { scope: string; userId: string };
      expect(parsed.scope).toBe('user');
      expect(parsed.userId).toBe(userId);
    });
  });

  // ── publishOrgNotification ────────────────────────────────────────────────

  describe('publishOrgNotification', () => {
    it('publishes to the correct org channel', async () => {
      const orgId = 'org-xyz';
      const msg = buildMsg('user-1', orgId);
      const [publisher] = getInstances();

      await service.publishOrgNotification(orgId, msg);

      const [channel, raw] = publisher.publish.mock.calls[0] as [
        string,
        string,
      ];
      expect(channel).toBe(NOTIFICATION_CHANNELS.org(orgId));

      const parsed = JSON.parse(raw) as { scope: string; orgId: string };
      expect(parsed.scope).toBe('org');
      expect(parsed.orgId).toBe(orgId);
    });
  });

  // ── publishGlobalNotification ─────────────────────────────────────────────

  describe('publishGlobalNotification', () => {
    it('publishes to the global channel', async () => {
      const msg = buildMsg('user-1');
      const [publisher] = getInstances();

      await service.publishGlobalNotification(msg);

      const [channel, raw] = publisher.publish.mock.calls[0] as [
        string,
        string,
      ];
      expect(channel).toBe(NOTIFICATION_CHANNELS.global);

      const parsed = JSON.parse(raw) as { scope: string };
      expect(parsed.scope).toBe('global');
    });
  });

  // ── subscribeToUserPattern ────────────────────────────────────────────────

  describe('subscribeToUserPattern', () => {
    it('psubscribes to the user pattern', () => {
      const [, subscriber] = getInstances();
      service.subscribeToUserPattern(jest.fn());
      expect(subscriber.psubscribe).toHaveBeenCalledWith(
        NOTIFICATION_PATTERNS.user,
      );
    });

    it('invokes handler when a matching pmessage arrives', () => {
      const [, subscriber] = getInstances();
      const handler = jest.fn();
      service.subscribeToUserPattern(handler);

      const listener = getListener(subscriber, 'pmessage');
      expect(listener).toBeDefined();

      const event = {
        scope: 'user',
        payload: buildMsg('user-1'),
        timestamp: '',
      };
      listener!(
        NOTIFICATION_PATTERNS.user,
        NOTIFICATION_CHANNELS.user('user-1'),
        JSON.stringify(event),
      );

      expect(handler).toHaveBeenCalledWith(event);
    });

    it('ignores messages from non-user channels', () => {
      const [, subscriber] = getInstances();
      const handler = jest.fn();
      service.subscribeToUserPattern(handler);

      const listener = getListener(subscriber, 'pmessage');
      listener!(
        NOTIFICATION_PATTERNS.org,
        NOTIFICATION_CHANNELS.org('org-1'),
        JSON.stringify({}),
      );

      expect(handler).not.toHaveBeenCalled();
    });
  });

  // ── subscribeToOrgPattern ─────────────────────────────────────────────────

  describe('subscribeToOrgPattern', () => {
    it('psubscribes to the org pattern', () => {
      const [, subscriber] = getInstances();
      service.subscribeToOrgPattern(jest.fn());
      expect(subscriber.psubscribe).toHaveBeenCalledWith(
        NOTIFICATION_PATTERNS.org,
      );
    });

    it('invokes handler when a matching org pmessage arrives', () => {
      const [, subscriber] = getInstances();
      const handler = jest.fn();
      service.subscribeToOrgPattern(handler);

      const listener = getListener(subscriber, 'pmessage');
      const event = {
        scope: 'org',
        payload: buildMsg('user-1', 'org-42'),
        timestamp: '',
      };
      listener!(
        NOTIFICATION_PATTERNS.org,
        NOTIFICATION_CHANNELS.org('org-42'),
        JSON.stringify(event),
      );

      expect(handler).toHaveBeenCalledWith(event);
    });
  });

  // ── subscribeToGlobal ─────────────────────────────────────────────────────

  describe('subscribeToGlobal', () => {
    it('subscribes to the global channel', () => {
      const [, subscriber] = getInstances();
      service.subscribeToGlobal(jest.fn());
      expect(subscriber.subscribe).toHaveBeenCalledWith(
        NOTIFICATION_CHANNELS.global,
      );
    });

    it('invokes handler when a global message arrives', () => {
      const [, subscriber] = getInstances();
      const handler = jest.fn();
      service.subscribeToGlobal(handler);

      const listener = getListener(subscriber, 'message');
      expect(listener).toBeDefined();

      const event = {
        scope: 'global',
        payload: buildMsg('user-1'),
        timestamp: '',
      };
      listener!(NOTIFICATION_CHANNELS.global, JSON.stringify(event));

      expect(handler).toHaveBeenCalledWith(event);
    });
  });

  // ── onModuleDestroy ───────────────────────────────────────────────────────

  describe('onModuleDestroy', () => {
    it('closes both Redis connections', async () => {
      const [publisher, subscriber] = getInstances();
      await service.onModuleDestroy();
      expect(publisher.quit).toHaveBeenCalledTimes(1);
      expect(subscriber.quit).toHaveBeenCalledTimes(1);
    });
  });

  // ── connect / error event handlers ───────────────────────────────────────

  describe('Redis connection event handlers', () => {
    it('logs on publisher connect', () => {
      const [publisher] = getInstances();
      const logSpy = jest
        .spyOn((service as any).logger, 'log')
        .mockImplementation(() => {});

      const connectCb = getListener(publisher, 'connect');
      expect(connectCb).toBeDefined();
      connectCb!();

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('publisher connected'),
      );
    });

    it('logs on subscriber connect', () => {
      const [, subscriber] = getInstances();
      const logSpy = jest
        .spyOn((service as any).logger, 'log')
        .mockImplementation(() => {});

      const connectCb = getListener(subscriber, 'connect');
      expect(connectCb).toBeDefined();
      connectCb!();

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('subscriber connected'),
      );
    });

    it('logs on publisher error', () => {
      const [publisher] = getInstances();
      const errorSpy = jest
        .spyOn((service as any).logger, 'error')
        .mockImplementation(() => {});

      const errorCb = getListener(publisher, 'error') as
        | ((e: Error) => void)
        | undefined;
      expect(errorCb).toBeDefined();
      errorCb!(new Error('conn refused'));

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('publisher error'),
        expect.any(Error),
      );
    });

    it('logs on subscriber error', () => {
      const [, subscriber] = getInstances();
      const errorSpy = jest
        .spyOn((service as any).logger, 'error')
        .mockImplementation(() => {});

      const errorCb = getListener(subscriber, 'error') as
        | ((e: Error) => void)
        | undefined;
      expect(errorCb).toBeDefined();
      errorCb!(new Error('conn refused'));

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('subscriber error'),
        expect.any(Error),
      );
    });
  });

  // ── safeHandle ────────────────────────────────────────────────────────────

  describe('safeHandle (via subscribeToGlobal)', () => {
    it('logs an error and does not throw when the message is invalid JSON', () => {
      const [, subscriber] = getInstances();
      const handler = jest.fn();
      const errorSpy = jest
        .spyOn((service as any).logger, 'error')
        .mockImplementation(() => {});

      service.subscribeToGlobal(handler);

      const listener = getListener(subscriber, 'message');
      listener!(NOTIFICATION_CHANNELS.global, 'not-valid-json');

      expect(handler).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to parse'),
      );
    });
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildMsg(userId: string, orgId = 'org-1') {
  return {
    notificationId: 'notif-1',
    userId,
    orgId,
    type: 'test',
    title: 'Test',
    body: 'Body',
    metadata: null,
    // Cast so TypeScript accepts the value; using an ISO string ensures the
    // value survives JSON.stringify → JSON.parse unchanged in subscriber tests.
    createdAt: '2026-01-01T00:00:00.000Z' as unknown as Date,
  };
}
