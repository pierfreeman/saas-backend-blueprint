import { User, Organization, Team, Player, Membership } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

/**
 * Test data factories for creating test entities
 * These provide consistent test data with proper defaults
 */

export const TestDataFactory = {
  /**
   * Creates a test user object
   */
  createUser(overrides?: Partial<User>): Omit<User, 'id' | 'createdAt' | 'updatedAt'> {
    return {
      auth0Id: overrides?.auth0Id || `auth0|${uuidv4()}`,
      email: overrides?.email || `test-${uuidv4()}@example.com`,
    };
  },

  /**
   * Creates a test organization object
   */
  createOrganization(
    overrides?: Partial<Organization>,
  ): Omit<Organization, 'id' | 'createdAt' | 'updatedAt'> {
    return {
      name: overrides?.name || 'Test Organization',
      status: overrides?.status || 'ACTIVE',
      stripeCustomerId: overrides?.stripeCustomerId || null,
    };
  },

  /**
   * Creates a test team object
   */
  createTeam(
    orgId: string,
    overrides?: Partial<Team>,
  ): Omit<Team, 'id' | 'createdAt' | 'updatedAt'> {
    return {
      orgId,
      name: overrides?.name || 'Test Team',
    };
  },

  /**
   * Creates a test player object
   */
  createPlayer(
    orgId: string,
    teamId: string,
    overrides?: Partial<Player>,
  ): Omit<Player, 'id' | 'createdAt' | 'updatedAt'> {
    return {
      orgId,
      teamId,
      name: overrides?.name || 'Test Player',
    };
  },

  /**
   * Creates a test membership object
   */
  createMembership(
    userId: string,
    orgId: string,
    overrides?: Partial<Membership>,
  ): Omit<Membership, 'id' | 'createdAt' | 'updatedAt'> {
    return {
      userId,
      orgId,
      role: overrides?.role || 'VIEWER',
      ...overrides,
    };
  },
};

/**
 * Mock JWT payload for testing authenticated requests
 */
export interface MockJwtPayload {
  sub: string;
  email: string;
  name: string;
}

/**
 * Creates a mock JWT payload
 */
export function createMockJwtPayload(overrides?: Partial<MockJwtPayload>): MockJwtPayload {
  return {
    sub: overrides?.sub || `auth0|${uuidv4()}`,
    email: overrides?.email || `test-${uuidv4()}@example.com`,
    name: overrides?.name || 'Test User',
  };
}

/**
 * Waits for a condition to be true
 * Useful for async assertions
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeout = 5000,
  interval = 100,
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error('Timeout waiting for condition');
}

/**
 * Delays execution for a specified time
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
