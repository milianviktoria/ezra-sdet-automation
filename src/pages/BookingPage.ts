import { Page, Locator, expect } from '@playwright/test';

// CSS filter that selects only calendar cells a user can actually click.
// Extracted as a constant because it is used in three calendar methods —
// a single edit here covers all of them if the vuecal class names ever change.
const AVAILABLE_CELL =
  '.vuecal__cell' +
  ':not(.vuecal__cell--disabled)' +
  ':not(.vuecal__cell--before-min)' +
  ':not(.vuecal__cell--out-of-scope)' +
  ':not(.vuecal__cell--after-max)';

export class BookingPage {
  readonly page: Page;

  private readonly addPackageButton: Locator;
  private readonly stepPayment: Locator;
  private readonly continueButton: Locator;
  private readonly backButton: Locator;

  private readonly cardNumberFrame: Locator;
  private readonly cardExpiryFrame: Locator;
  private readonly cardCvcFrame: Locator;
  private readonly zipCodeFrame: Locator;
  private readonly payButton: Locator;
  private readonly paymentSuccessMessage: Locator;

  constructor(page: Page) {
    this.page = page;

    this.addPackageButton = page.locator('button:has-text("Add a new package")');
    this.stepPayment      = page.locator('button:has-text("Payment")');
    // Steps 1 & 2: role+name targets the confirmed "Continue" text precisely.
    // Step 3 (Payment): payButton uses [data-test="submit"] — unambiguous on that step.
    this.continueButton = page.getByRole('button', { name: 'Continue' });
    this.backButton     = page.locator('button:has-text("Back")');

    this.cardNumberFrame = this.stripeFrame.getByPlaceholder('1234 1234 1234 1234');
    this.cardExpiryFrame = this.stripeFrame.getByPlaceholder('MM / YY');
    this.cardCvcFrame    = this.stripeFrame.getByPlaceholder('CVC');
    this.zipCodeFrame    = this.stripeFrame.getByPlaceholder('12345');

    this.payButton             = page.locator('[data-test="submit"]');
    this.paymentSuccessMessage = page.getByText('Package Active', { exact: true }).first();
  }

  async openBookingModal(): Promise<void> {
    await this.addPackageButton.click();
    await this.page.waitForLoadState('domcontentloaded');
  }

  async selectScan(scanName: string): Promise<void> {
    await this.page.locator('li').filter({ hasText: scanName }).first().click();
    await expect(this.continueButton).toBeEnabled();
  }

  async expectContinueDisabled(): Promise<void> {
    await expect(this.continueButton).toBeDisabled();
  }

  async expectContinueEnabled(): Promise<void> {
    await expect(this.continueButton).toBeEnabled();
  }

  async expectPaymentStepDisabled(): Promise<void> {
    await expect(this.stepPayment).toBeDisabled();
  }

  async clickContinue(): Promise<void> {
    await this.continueButton.click();
    await this.page.waitForLoadState('domcontentloaded');
  }

  async clickBack(): Promise<void> {
    await this.backButton.click();
    await this.page.waitForLoadState('domcontentloaded');
  }

  async selectLocation(locationName: string): Promise<void> {
    await this.page.locator(`text=${locationName}`).first().click();
  }

  async selectRecommendedLocation(): Promise<void> {
    await this.page.locator('.location-card').filter({ hasText: 'Recommended' }).first().click();
  }

  async expectLocationCardsVisible(): Promise<void> {
    await expect(this.page.locator('.location-card').first()).toBeVisible();
  }

  async clickSlotPlaceholder(index: number): Promise<void> {
    await this.page.locator('button:has-text("No time / date selected")').nth(index).click();
    await expect(this.page.locator('.vuecal__cell').first()).toBeVisible();
  }

  async expectAvailableDateVisible(): Promise<void> {
    await expect(this.page.locator(AVAILABLE_CELL).first()).toBeVisible();
  }

  async selectFirstAvailableDate(): Promise<void> {
    await this.selectAvailableDateByIndex(0);
  }

  async selectAvailableDateByIndex(index: number): Promise<void> {
    const cell = this.page.locator(AVAILABLE_CELL).nth(index);
    const dateBtn = cell.locator('button').first();
    if (await dateBtn.count() > 0) {
      await dateBtn.click();
    } else {
      await cell.click();
    }
  }

  async selectDateByDay(dayNumber: number): Promise<void> {
    const cell = this.page
      .locator(AVAILABLE_CELL)
      .filter({ has: this.page.getByText(String(dayNumber), { exact: true }) });
    await cell.first().click();
  }

  async selectFirstAvailableTimeSlot(): Promise<void> {
    await this.selectTimeSlotByIndex(0);
  }

  async selectTimeSlotByIndex(index: number): Promise<void> {
    await this.page.locator('.appointments__individual-appointment label').nth(index).click();
    await expect(this.continueButton).toBeEnabled();
  }

  async fillPaymentDetails(cardNumber: string, expiry: string, cvc: string, zip = '10001'): Promise<void> {
    await this.cardNumberFrame.fill(cardNumber);
    await this.cardExpiryFrame.fill(expiry);
    await this.cardCvcFrame.fill(cvc);
    await this.cardCvcFrame.press('Tab');
    await this.zipCodeFrame.fill(zip);
    await expect(this.zipCodeFrame).toHaveValue(zip);
  }

  async submitPayment(): Promise<void> {
    await expect(this.payButton).toBeEnabled();
    await this.payButton.click();
  }

  async expectPaymentSuccess(): Promise<void> {
    await expect(this.paymentSuccessMessage).toBeVisible();
  }

  async expectActivePackageShowsScan(scanName: string): Promise<void> {
    await expect(
      this.page.locator(`text=${scanName}`).first(),
      `Active package must display scan type "${scanName}"`
    ).toBeVisible();
  }

  private get stripeFrame() {
    return this.page.frameLocator('iframe[title="Secure payment input frame"]:not([tabindex="-1"])');
  }

  async expectCardDeclined(): Promise<void> {
    await expect(this.stripeFrame.getByRole('alert').filter({ hasText: /declined/i })).toBeVisible();
  }

  async expectInsufficientFunds(): Promise<void> {
    await expect(this.stripeFrame.getByRole('alert').filter({ hasText: /insufficient/i })).toBeVisible();
  }

  async expectExpiredCard(): Promise<void> {
    await expect(this.stripeFrame.getByRole('alert').filter({ hasText: /expired/i })).toBeVisible();
  }

  async expectIncorrectCvc(): Promise<void> {
    await expect(this.stripeFrame.getByRole('alert').filter({ hasText: /security code/i })).toBeVisible();
  }

  async expectOnStep(stepName: 'Select a scan' | 'Schedule scan' | 'Payment'): Promise<void> {
    await expect(
      this.page.locator(`h6:has-text("${stepName}"), [class*="step-title"]:has-text("${stepName}")`)
    ).toBeVisible();
  }
}
