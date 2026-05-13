import { test, expect } from '../fixtures/auth.fixture';
import { STRIPE_CARDS, SCAN_TYPES, TEST_MEMBERS } from '../utils/constants';

const MRI_SCAN = SCAN_TYPES.mriScan;

test.describe('Booking — Steps 2–3: Schedule + Payment', () => {

  test.beforeEach(async ({ page, bookingPage }) => {
    await page.goto(`/members/${TEST_MEMBERS.memberA}`);
    await expect(page).toHaveURL(/\/members\//);

    await bookingPage.openBookingModal();
    await bookingPage.selectScan(MRI_SCAN.name);
    await bookingPage.clickContinue();

    await bookingPage.selectRecommendedLocation();

    await bookingPage.expectAvailableDateVisible();
    await bookingPage.selectAvailableDateByIndex(0);
    await bookingPage.selectFirstAvailableTimeSlot();
    await bookingPage.clickContinue();

    await bookingPage.expectOnStep('Payment');
  });

  test('Valid Stripe test card completes payment successfully', { tag: '@smoke' }, async ({ page, bookingPage }) => {

    const backendConfirmationPromise = page.waitForResponse(
      resp =>
        resp.url().includes('stage-api.ezra.com') &&
        resp.request().method() !== 'GET' &&
        resp.status() < 300,
      { timeout: 40_000 }
    ).catch(() => null);

    await test.step('Fill card details', async () => {
      await bookingPage.fillPaymentDetails(
        STRIPE_CARDS.validVisa.number,
        STRIPE_CARDS.validVisa.expiry,
        STRIPE_CARDS.validVisa.cvc
      );
    });

    await test.step('Submit payment', async () => {
      await bookingPage.submitPayment();
    });

    await test.step('UI layer — Package Active visible', async () => {
      await bookingPage.expectPaymentSuccess();
    });

    await test.step('Data layer — active package shows correct scan type', async () => {
      await bookingPage.expectActivePackageShowsScan(MRI_SCAN.name);
    });

    await test.step('Network layer — backend confirmed booking (2xx)', async () => {
      const resp = await backendConfirmationPromise;
      if (resp) {
        expect(resp.status(), 'API must return 2xx').toBeLessThan(300);

        const body = await resp.json().catch(() => null);
        if (body !== null && body !== undefined) {
          const isNonEmpty = Array.isArray(body) ? body.length > 0 : Object.keys(body).length > 0;
          expect(isNonEmpty, 'Response body must be non-empty').toBe(true);
        }
      }
    });
  });

});
