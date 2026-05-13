# Ezra SDET Automation

Playwright + TypeScript E2E test suite for the Ezra booking and privacy flows.
Architecture: Page Object Model · Fixture-based auth · Event-driven waits.

**Author:** Viktoriia Milian · viktoriiamilian@gmail.com

> Security assessment companion: [Cloud Run Security Finding — Wiz Investigation & Response](docs/cloud-run-security-finding.md)

---

## Setup

**Prerequisites:** Node.js 18+

```bash
git clone https://github.com/viktoriiamilian/ezra-sdet-automation.git
cd ezra-sdet-automation
npm install
npx playwright install chromium
```

**Environment variables** — all optional, defaults target the staging environment:

| Variable | Default |
|---|---|
| `BASE_URL` | `https://staging-hub.ezra.com` |
| `EZRA_EMAIL` | `michael.krakovsky+test_interview@functionhealth.com` |
| `EZRA_PASSWORD` | `12121212Aa` |
| `API_BASE` | `https://stage-api.ezra.com` |
| `MEMBER_A_GUID` | `83fd7da8-230a-48f8-b258-9dc95e4df785` |
| `MEMBER_B_GUID` | `f7b6e8ec-785b-4f7f-840f-c42cdcc45188` |

Copy `.env.example` to `.env` and override any values before running.

---

## Running Tests

```bash
npm test              # smoke suite: scan selection + payment + IDOR (headless)
npm run test:auth     # auth suite: login edge-cases (runs without storageState)
npm run test:booking  # smoke — scan selection → schedule step only
npm run test:payment  # smoke — full payment flow only
npm run test:privacy  # smoke — IDOR / PHI protection only
npm run test:report   # open last HTML report in browser
```

The `setup` project runs automatically before `npm test` — it logs in once, writes `auth.json`, and every smoke test starts with a pre-authenticated session. `auth.json` is deleted by `global.teardown.ts` after every run.

---

## Project Structure

```
ezra-sdet-automation/
├── setup/
│   ├── global.setup.ts          # Logs in once → saves auth.json
│   └── global.teardown.ts       # Deletes auth.json after the run
├── src/
│   ├── fixtures/
│   │   └── auth.fixture.ts      # Extended test object: loginPage, bookingPage, authenticatedPage
│   ├── pages/
│   │   ├── BookingPage.ts       # Step 1–3 locators and interactions (POM)
│   │   └── LoginPage.ts         # Sign-in page locators and interactions (POM)
│   ├── tests/
│   │   ├── booking-scan-selection.spec.ts   # @smoke — scan selection → schedule step
│   │   ├── booking-schedule-payment.spec.ts # @smoke — schedule + payment happy path
│   │   ├── login.spec.ts                    # @auth  — login edge-cases
│   │   └── privacy-idor.spec.ts             # @smoke — IDOR / PHI access control
│   └── utils/
│       ├── constants.ts         # STRIPE_CARDS, SCAN_TYPES, CREDENTIALS, TEST_MEMBERS
│       └── helpers.ts           # Test data factory (future: API-seeded member creation)
├── playwright.config.ts         # Projects: setup · chromium (@smoke) · auth (@auth)
└── README.md
```

---

## Test Coverage

Three test cases are automated as the smoke gate. The remaining cases are prioritised candidates for the next automation sprint.

| ID | Test Case | Module | Priority | Automated |
|---|---|---|---|---|
| PAY-001 | Valid card completes payment, shows Package Active | Payment | P1 | ✅ `booking-schedule-payment.spec.ts` |
| SCAN-003 | Selecting a scan and clicking Continue advances to Schedule step | Scan Selection | P1 | ✅ `booking-scan-selection.spec.ts` |
| IDOR-001 | Member A token cannot access Member B questionnaire data | Privacy | P1 | ✅ `privacy-idor.spec.ts` |
| AUTH-001 | Valid credentials redirect to /members | Auth | P1 | ✅ `login.spec.ts` |
| AUTH-002 | Wrong password shows error toast | Auth | P2 | ✅ `login.spec.ts` |
| AUTH-003 | Wrong email shows error toast | Auth | P2 | ✅ `login.spec.ts` |
| PAY-002 | Declined card shows payment failure message | Payment | P1 | future work |
| PAY-003 | Insufficient funds card shows error | Payment | P2 | future work |
| PAY-004 | Expired card shows error | Payment | P2 | future work |
| PAY-005 | Incorrect CVC shows security code error | Payment | P2 | future work |
| IDOR-002 | Unauthenticated request returns 401/403 | Privacy | P1 | future work |
| SCAN-001 | Booking modal opens with Steps 2 and 3 locked | Scan Selection | P2 | future work |
| SCAN-002 | All 5 scan types display with correct prices | Scan Selection | P2 | future work |
| SCHED-001 | Location cards render on Schedule step | Schedule | P2 | future work |
| SCHED-002 | Date and time selection enables Continue | Schedule | P2 | future work |

---

## Why These 3 Cases Were Automated

### PAY-001 — Valid payment card completes booking

This is Ezra's core revenue transaction. A broken payment flow means zero revenue and a patient who does not get their scan scheduled.

The test verifies correctness at three independent layers:
- **Network layer** — the backend API returns a 2xx status confirming the booking was persisted server-side. An optimistic UI could show "Package Active" while the API call silently failed; only a network assertion catches that.
- **UI layer** — "Package Active" is visible on the member profile, confirming the frontend correctly processes the API response.
- **Data layer** — the active package card displays the correct scan type, confirming the right record was created and not substituted with a default or stale value.

Testing the UI layer alone would miss an entire class of silent backend failures.

### SCAN-003 — Scan selection advances to Schedule step

This is the entry gate to the entire booking funnel. Every booking attempt passes through it. The test validates three things simultaneously: the scan selection UI correctly enables Continue; the backend API receives the selection over HTTPS; and the Schedule step renders completely — location cards visible, calendar available, and Continue disabled until a time slot is chosen. A failure here blocks 100% of new bookings.

### IDOR-001 — Member A token cannot access Member B data

PHI protection is a HIPAA requirement. Auth middleware is the most common source of IDOR regressions and the hardest to catch in manual testing because the failure is silent — the API returns 200 with the wrong data, not an error. The test uses a cookie-free `APIRequestContext` carrying only the Bearer token to simulate a token-replay attack accurately. The admin test account's session cookies would grant legitimate access to all members, defeating the assertion.

---

## Design Decisions

### Page Object Model

All locators and interactions live in `BookingPage.ts` and `LoginPage.ts`. Tests contain only orchestration and assertions. A selector change requires one edit in one file regardless of how many tests use it.

### Fixture-based authentication

The global setup project logs in once before any test runs and saves the session to `auth.json`. The `chromium` project restores it via `storageState`. This means every smoke test starts pre-authenticated without repeating login — saving ~5 seconds per test and keeping the auth logic in one place.

Auth tests (`login.spec.ts`) run in a separate project with no `storageState` and no dependency on the setup project. They always receive a fresh unauthenticated browser so the login form renders correctly.

### Event-driven waits

`waitForRequest`, `waitForResponse`, and `waitFor({ state })` replace all fixed timeouts. Tests wait for the exact condition they need. The one global `expect.timeout: 25_000` in `playwright.config.ts` covers Stripe's async iframe processing without per-assertion overrides.

### Single source of truth for test data

`STRIPE_CARDS`, `SCAN_TYPES`, `TEST_MEMBERS`, and `CREDENTIALS` are defined once in `constants.ts`. Any test that needs a card number imports it — there are no magic strings in test files.

### `test.step()` for diagnostic reporting

Each smoke test is broken into named steps. When one fails, the HTML report identifies the exact layer — network, UI, or data — without reading the full test body.

---

## Trade-offs and Assumptions

| Area | Decision | Reason |
|---|---|---|
| **Credentials in defaults** | Env vars with hardcoded staging fallbacks | Allows `git clone && npm test` without any config; production pattern uses `.env` |
| **Serial execution** | `workers: 1` | Shared staging cannot handle concurrent booking sessions without race conditions |
| **Full UI navigation in beforeEach** | Navigate Steps 1–2 via UI before payment tests | No API endpoint exists for seeding booking sessions in staging; UI navigation is the only reliable path to the Payment step |
| **Calendar by index** | `selectAvailableDateByIndex(0)` | Avoids hardcoded day numbers that break when the calendar rolls to a new month |
| **Cookie-free IDOR context** | `request` fixture, no session cookies | Admin session cookies bypass token auth; a clean context isolates Bearer token enforcement |
| **IDOR body assertions, not status codes** | No `toBe(403)` on cross-member requests | Admin token legitimately returns 200 for any member endpoint; PHI field scanning is the strongest assertion available with current credentials |
| **Chromium only** | One browser for this submission | Cross-browser coverage (Firefox, WebKit) is the next sprint |
| **No booking cleanup** | Packages from PAY-001 accumulate in staging | No simple DELETE endpoint for packages; this is a known limitation of the staging data model |

---

## Future Work

**Negative payment tests (PAY-002 through PAY-005).**
`BookingPage` already has `expectCardDeclined()`, `expectInsufficientFunds()`, `expectExpiredCard()`, and `expectIncorrectCvc()`. `STRIPE_CARDS` in `constants.ts` already has all four test cards. Adding these four tests is the highest-value next step — the infrastructure is fully built, only the test bodies are missing.

**Non-admin test credentials.**
A standard member-level account allows IDOR tests to assert HTTP 403 directly instead of scanning response bodies for PHI field names.

**API-seeded booking sessions.**
Use the admin API to create a booking session in `beforeAll`, bypassing UI navigation for Steps 1–2 in payment tests and making them 5× faster.

**OpenAPI-driven IDOR endpoint discovery.**
Generate the member-scoped endpoint list from the API schema automatically so new endpoints are covered without manual maintenance.

**Cross-browser matrix.**
Add Firefox and WebKit projects to `playwright.config.ts`.

**Nightly full IDOR sweep.**
A scheduled workflow intercepts all member-scoped traffic during a full E2E run and sweeps every discovered URL for cross-member access — covering undocumented endpoints that schema-driven generation misses.

---

## IDOR Test — HTTP Request Sequence

```
# 1. Establish Member A baseline
GET /individuals/api/members/{memberA}/questionnaire
Authorization: Bearer {tokenA}
→ 200; extract email and GUID for cross-member comparison

# 2. Core IDOR assertion — Member A token against Member B resource
GET /individuals/api/members/{memberB}/questionnaire
Authorization: Bearer {tokenA}
→ Assert status: 401, 403, or 404
→ Assert body: does not contain Member A email or GUID
→ Assert body: does not contain any PHI field name
→ Assert headers: at least one security header present

# 3. Tampered token — JWT signature validation
GET /individuals/api/members/{memberA}/questionnaire
Authorization: Bearer {tokenA with last 4 chars replaced with XXXX}
→ Assert status: 401, 403, 404, or 422
```

---

## Stripe Test Cards

| Scenario | Number |
|---|---|
| Valid Visa | 4242 4242 4242 4242 |
| Card declined | 4000 0000 0000 0002 |
| Insufficient funds | 4000 0000 0000 9995 |
| Expired card | 4000 0000 0000 0069 |
| Incorrect CVC | 4000 0000 0000 0127 |

Source: https://docs.stripe.com/testing
