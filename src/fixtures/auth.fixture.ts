import { test as base } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { BookingPage } from '../pages/BookingPage';

type Fixtures = {
  loginPage: LoginPage;
  bookingPage: BookingPage;
};

export const test = base.extend<Fixtures>({

  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },

  bookingPage: async ({ page }, use) => {
    await use(new BookingPage(page));
  },

});

export { expect } from '@playwright/test';
