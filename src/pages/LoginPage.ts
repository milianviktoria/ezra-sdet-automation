import { Page, Locator, expect } from '@playwright/test';

export class LoginPage {
  readonly page: Page;

  private readonly emailInput: Locator;
  private readonly passwordInput: Locator;
  private readonly submitButton: Locator;
  private readonly errorMessage: Locator;
  private readonly forgotPasswordLink: Locator;

  constructor(page: Page) {
    this.page = page;

    this.emailInput    = page.locator('input[type="email"], input[placeholder="Email"]');
    this.passwordInput = page.locator('input[type="password"]');
    this.submitButton  = page.locator('button[type="submit"], button:has-text("Submit")');
    this.errorMessage       = page.locator('div.toast.--visible, div[class*="toast"][class*="--visible"]').first();
    this.forgotPasswordLink = page.locator('a:has-text("Reset your password")');
  }

  async goto(): Promise<void> {
    await this.page.goto('/sign-in/');
    await this.page.waitForLoadState('domcontentloaded');
    await expect(this.submitButton).toBeVisible();
  }

  async login(email: string, password: string): Promise<void> {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
    await Promise.race([
      this.page.waitForURL('**/members**', { timeout: 20_000 }),
      this.page.locator('div.toast.--visible').waitFor({ state: 'visible', timeout: 20_000 }),
    ]).catch(() => {
      throw new Error('Login failed — neither /members redirect nor error toast appeared within 20s');
    });
  }

  async fillPassword(password: string): Promise<void> {
    await this.passwordInput.fill(password);
  }

  async clickSubmit(): Promise<void> {
    await this.submitButton.click();
  }

  async expectLoginError(): Promise<void> {
    await expect(this.errorMessage).toBeVisible();
  }

  async expectRedirectedToMembers(): Promise<void> {
    await expect(this.page).toHaveURL(/\/members/);
  }

  async expectStaysOnSignIn(): Promise<void> {
    await expect(this.page).not.toHaveURL(/\/members/);
    await expect(this.page).toHaveURL(/sign-in/);
  }

  async expectForgotPasswordVisible(): Promise<void> {
    await expect(this.forgotPasswordLink).toBeVisible();
  }

  async logout(): Promise<void> {
    await this.page
      .locator('button:has-text("Sign out"), a:has-text("Sign out"), button:has-text("Log out"), a:has-text("Log out")')
      .first()
      .click();
    await this.page.waitForURL(/sign-in/, { timeout: 10_000 });
  }
}
