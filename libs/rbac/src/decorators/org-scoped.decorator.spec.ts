import { OrgScoped, ORG_SCOPED_KEY } from './org-scoped.decorator';
import { SetMetadata } from '@nestjs/common';
import { vi } from 'vitest';

// Mock SetMetadata to capture what's being set
let capturedKey: string | undefined;
let capturedValue: unknown;

vi.mock('@nestjs/common', async (importActual) => {
  const actual = await importActual<typeof import('@nestjs/common')>();
  return {
    ...actual,
    SetMetadata: (key: string, value: unknown) => {
      capturedKey = key;
      capturedValue = value;
      return actual.SetMetadata(key, value);
    },
  };
});

describe('OrgScoped decorator', () => {
  beforeEach(() => {
    capturedKey = undefined;
    capturedValue = undefined;
  });

  it('calls SetMetadata with the correct key and value', () => {
    OrgScoped();

    expect(capturedKey).toBe(ORG_SCOPED_KEY);
    expect(capturedValue).toBe(true);
  });

  it('exports the correct metadata key', () => {
    expect(ORG_SCOPED_KEY).toBe('rbac:org-scoped');
  });

  it('returns a decorator function', () => {
    const decorator = OrgScoped();
    expect(typeof decorator).toBe('function');
  });
});
