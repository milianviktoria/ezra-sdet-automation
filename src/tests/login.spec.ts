import { test } from '../fixtures/auth.fixture';
import { CREDENTIALS } from '../utils/constants';

// Auth tests run without storageState — the login form must render fresh each time.
// Tagged @auth so they run in the dedicated auth project (see playwright.config.ts).
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Authentication', () => {

  test.beforeEach(async ({ loginPage }) => {
    await loginPage.goto();
  });

  test('valid credentials redirect to /members', { tag: '@auth' }, async ({ loginPage }) => {
    await loginPage.login(CREDENTIALS.email, CREDENTIALS.password);
    await loginPage.expectRedirectedToMembers();
  });

  test('wrong password shows error toast', { tag: '@auth' }, async ({ loginPage }) => {
    await loginPage.login(CREDENTIALS.email, 'wrongpassword');
    await loginPage.expectLoginError();
    await loginPage.expectStaysOnSignIn();
  });

  test('wrong email shows error toast', { tag: '@auth' }, async ({ loginPage }) => {
    await loginPage.login('notauser@example.com', CREDENTIALS.password);
    await loginPage.expectLoginError();
    await loginPage.expectStaysOnSignIn();
  });

  test('empty email keeps submit disabled', { tag: '@auth' }, async ({ loginPage }) => {
    await loginPage.fillPassword(CREDENTIALS.password);
    await loginPage.clickSubmit();
    await loginPage.expectStaysOnSignIn();
  });

  test('forgot password link is visible on sign-in page', { tag: '@auth' }, async ({ loginPage }) => {
    await loginPage.expectForgotPasswordVisible();
  });

});
