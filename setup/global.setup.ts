import { test as setup, expect } from '@playwright/test';
import { LoginPage } from '../src/pages/LoginPage';
import { CREDENTIALS } from '../src/utils/constants';

const AUTH_FILE = 'auth.json';

setup('authenticate', async ({ page }) => {
  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.login(CREDENTIALS.email, CREDENTIALS.password);
  await expect(page).toHaveURL(/\/members/, { timeout: 25_000 });
  await page.context().storageState({ path: AUTH_FILE });
});
