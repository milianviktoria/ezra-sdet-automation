/**
 * Test-data factory helpers — NOT YET WIRED INTO ANY TEST.
 *
 * Planned usage (test data factory pattern):
 *
 *   test.beforeAll(async ({ request }) => {
 *     const { firstName, lastName } = generateTestMemberName();
 *     const email = generateTestEmail();
 *     // POST /api/members  → create synthetic member
 *     // store returned GUID in a shared variable
 *   });
 *
 *   test.afterAll(async ({ request }) => {
 *     // DELETE /api/members/:guid  → clean up after the suite
 *   });
 *
 * This removes the dependency on hardcoded GUIDs in constants.ts and lets
 * each CI run operate on a fresh, isolated member that is deleted on teardown.
 *
 * TODO: implement once the admin API for member creation is documented.
 */

export function generateTestMemberName(): { firstName: string; lastName: string } {
  const ts = Date.now();
  return { firstName: `AutoTest`, lastName: `User${ts}` };
}

export function generateTestEmail(): string {
  return `autotest+${Date.now()}@mailtest.example.com`;
}
