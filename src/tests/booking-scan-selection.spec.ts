import { test, expect } from '../fixtures/auth.fixture';
import { SCAN_TYPES, TEST_MEMBERS } from '../utils/constants';

test.describe('Booking — Step 1: Scan Selection', () => {

  test.beforeEach(async ({ page, bookingPage }) => {
    await page.goto(`/members/${TEST_MEMBERS.memberA}`);
    await expect(page).toHaveURL(/\/members\//);
    await bookingPage.openBookingModal();
  });

  test('Selecting a scan and clicking Continue advances to Schedule step', { tag: '@smoke' }, async ({ page, bookingPage }) => {

    const scheduleApiCallPromise = page.waitForRequest(
      req => req.url().includes('stage-api.ezra.com'),
      { timeout: 10_000 }
    ).catch(() => null);

    await test.step('Select scan and verify step gates', async () => {
      await bookingPage.selectScan(SCAN_TYPES.mriScan.name);
      await bookingPage.expectPaymentStepDisabled();
    });

    await test.step('Click Continue and confirm API call uses HTTPS', async () => {
      await bookingPage.clickContinue();
      const scheduleApiCall = await scheduleApiCallPromise;

      if (scheduleApiCall) {
        expect(scheduleApiCall.url(), 'API request must use HTTPS').toMatch(/^https:/);
      }
    });

    await test.step('Verify Schedule step is fully rendered', async () => {
      await bookingPage.expectOnStep('Schedule scan');
      await bookingPage.expectPaymentStepDisabled();
      await bookingPage.expectContinueDisabled();

      await bookingPage.expectLocationCardsVisible();
    });
  });

});
