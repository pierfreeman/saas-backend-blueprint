/**
 * Vitest globalTeardown — runs in its own Node.js process after all test suites.
 *
 * Cleans up any global state. Nock interceptors are per-test-worker, so they
 * are cleaned up in each test file's afterAll hook.
 */
export default async function globalTeardown() {
  console.log('\n[global-teardown] Integration test run complete.\n');
}
