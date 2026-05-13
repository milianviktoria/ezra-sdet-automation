import { test, expect } from '../fixtures/auth.fixture';
import type { Page, Request } from '@playwright/test';
import { API_BASE, BASE_URL, TEST_MEMBERS } from '../utils/constants';

const MEMBER_A_GUID  = TEST_MEMBERS.memberA;
const MEMBER_B_GUID  = TEST_MEMBERS.memberB;
const API_HOST       = new URL(API_BASE).hostname;  // e.g. "${API_HOST}"

const PHI_FIELD_NAMES = [
  'questionnaire_answers', 'medical_history', 'diagnosis', 'prescription',
  'medication', 'allergy', 'bloodType', 'blood_type', 'mrn', 'ssn',
  'socialSecurityNumber', 'social_security_number', 'insuranceId', 'insurance_id',
  'dateOfBirth', 'date_of_birth', 'firstName', 'first_name', 'lastName', 'last_name',
  'phoneNumber', 'phone_number',
] as const;

async function captureQuestionnaireEndpoint(
  page: Page,
  memberGuid: string
): Promise<{ token: string; questionnaireUrl: string; additionalUrls: string[] }> {

  const fallbackUrl    = `${API_BASE}/individuals/api/members/${memberGuid}/questionnaire`;
  const additionalUrls: string[] = [];

  page.on('request', (req: Request) => {
    const url = req.url();
    if (url.includes(`${API_HOST}`) && url.includes(memberGuid) && !url.includes('questionnaire')) {
      additionalUrls.push(url);
    }
  });

  const tokenPromise = page
    .waitForRequest(
      (req: Request) => {
        const auth = req.headers()['authorization'];
        return !!(auth?.startsWith('Bearer ') && req.url().includes(`${API_HOST}`));
      },
      { timeout: 15_000 }
    )
    .then((req: Request) => req.headers()['authorization'] ?? '')
    .catch(() => '');

  await page.goto(`/members/${memberGuid}`);

  if (page.url().includes('sign-in')) {
    throw new Error(`Session expired — redirected to sign-in for member ${memberGuid}`);
  }

  const token = await tokenPromise;

  const btn = page
    .locator('button:has-text("Begin Medical Questionnaire"), a:has-text("Begin Medical Questionnaire")')
    .first();
  const btnVisible = await btn.isVisible({ timeout: 5_000 }).catch(() => false);

  if (!btnVisible) {
    return { token, questionnaireUrl: fallbackUrl, additionalUrls };
  }

  const questionnaireReqPromise = page
    .waitForRequest(
      (req: Request) =>
        req.url().includes(`${API_HOST}`) && req.url().toLowerCase().includes('questionnaire'),
      { timeout: 10_000 }
    )
    .catch(() => null);

  await btn.click();
  const questionnaireReq = await questionnaireReqPromise;

  return {
    token,
    questionnaireUrl: questionnaireReq?.url() ?? fallbackUrl,
    additionalUrls: [...new Set(additionalUrls)],
  };
}

test.describe('Privacy — IDOR Protection', () => {

  let capturedToken          = '';
  let capturedUrl            = '';
  let capturedAdditionalUrls: string[] = [];

  // Capture the Bearer token and questionnaire URL once before all tests.
  // Avoids repeating the page navigation and network interception for every test.
  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({
      storageState: 'auth.json',
      baseURL:      BASE_URL,
    });
    const page   = await context.newPage();
    const result = await captureQuestionnaireEndpoint(page, MEMBER_A_GUID);
    capturedToken          = result.token;
    capturedUrl            = result.questionnaireUrl;
    capturedAdditionalUrls = result.additionalUrls;
    await context.close();
  });

  test('Member A data does not appear in Member B questionnaire response', { tag: '@smoke' }, async ({ request }) => {

    test.skip(!capturedToken, 'No Bearer token intercepted — app may use cookie-only auth');

    const ownResp      = await request.get(capturedUrl, { headers: { Authorization: capturedToken } });
    const ownBody      = await ownResp.text();
    const memberAEmail = (() => {
      try {
        const p = JSON.parse(ownBody);
        return p.email ?? p.emailAddress ?? p.member?.email ?? '';
      } catch { return ''; }
    })();

    const memberBUrl = capturedUrl.replace(MEMBER_A_GUID, MEMBER_B_GUID);
    const crossResp  = await request.get(memberBUrl, { headers: { Authorization: capturedToken } });
    const crossBody  = await crossResp.text();

    await test.step('Cross-member request must be rejected — 401, 403, or 404', async () => {
      expect(
        [401, 403, 404],
        `Expected access to be denied, but server returned ${crossResp.status()}. A 200 means access control is broken.`
      ).toContain(crossResp.status());
    });

    await test.step('Cross-member body must not contain Member A identifying data', async () => {
      if (memberAEmail) {
        expect(crossBody, 'Member A email must not appear in Member B response').not.toContain(memberAEmail);
      }
      expect(crossBody, 'Member A GUID must not appear in Member B response').not.toContain(MEMBER_A_GUID);
    });

    await test.step('Cross-member response must not expose PHI field names', async () => {
      for (const field of PHI_FIELD_NAMES) {
        expect(crossBody, `PHI field "${field}" must not be present`).not.toMatch(new RegExp(field, 'i'));
      }
    });

    await test.step('Response must include at least one security header', async () => {
      const headers = crossResp.headers();
      const hasSecurityHeader =
        !!headers['strict-transport-security'] ||
        !!headers['x-content-type-options']    ||
        !!headers['content-security-policy']   ||
        !!headers['x-frame-options'];

      expect(
        hasSecurityHeader,
        `Missing security headers. Received: ${Object.keys(headers).join(', ')}`
      ).toBe(true);
    });

    await test.step('Tampered token must be rejected', async () => {
      const tamperedToken = capturedToken.slice(0, -4) + 'XXXX';
      const tamperedResp  = await request.get(capturedUrl, { headers: { Authorization: tamperedToken } });
      expect(
        [401, 403, 404, 422],
        `Expected rejection, got: ${tamperedResp.status()}`
      ).toContain(tamperedResp.status());
    });

    for (const endpointUrl of capturedAdditionalUrls.slice(0, 3)) {
      const crossEndpointUrl = endpointUrl.replace(MEMBER_A_GUID, MEMBER_B_GUID);
      await test.step(`Cross-member sweep: ${new URL(endpointUrl).pathname}`, async () => {
        const sweepResp = await request.get(crossEndpointUrl, { headers: { Authorization: capturedToken } });
        const sweepBody = await sweepResp.text();

        if (memberAEmail) {
          expect(sweepBody, 'Member A email must not appear in sweep response').not.toContain(memberAEmail);
        }
        expect(sweepBody, 'Member A GUID must not appear in sweep response').not.toContain(MEMBER_A_GUID);
      });
    }
  });

});
