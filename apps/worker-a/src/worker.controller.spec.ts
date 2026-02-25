import { WorkerController } from './worker.controller';

describe('WorkerController', () => {
  let controller: WorkerController;

  beforeEach(() => {
    controller = new WorkerController();
  });

  describe('handleHeavyJobCreated', () => {
    it('processes a valid payload without throwing', async () => {
      const payload = {
        jobId: 'job_001',
        tenantId: 'org-1',
        payload: { data: 'test' },
        createdAt: new Date(),
      };
      await expect(
        controller.handleHeavyJobCreated(payload),
      ).resolves.not.toThrow();
    });

    it('handles different tenant IDs correctly', async () => {
      const payloads = ['org-a', 'org-b', 'default'].map((tenantId) => ({
        jobId: `job_${tenantId}`,
        tenantId,
        payload: {},
        createdAt: new Date(),
      }));

      for (const p of payloads) {
        await expect(
          controller.handleHeavyJobCreated(p),
        ).resolves.not.toThrow();
      }
    });

    it('handles errors in computation gracefully (no rethrow)', async () => {
      // The controller catches errors internally — should not propagate
      const payload = {
        jobId: 'job_err',
        tenantId: 'org-1',
        payload: null,
        createdAt: new Date(),
      };
      await expect(
        controller.handleHeavyJobCreated(payload),
      ).resolves.not.toThrow();
    });
  });
});
