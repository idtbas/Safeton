/**
 * End-to-end flow of the OS shell: first boot → complete setup (with a reload in the middle) →
 * initialisation and cold start → login → workspace → lock → second start without setup.
 */
import { expect, test, type Page } from '@playwright/test';

const SHOTS = 'e2e/screenshots';
const PASSWORD = 'Correct-Horse-42!';

const heading = (page: Page) => page.locator('.sh-setup__heading h1');
const footer = (page: Page) => page.locator('.sh-setup__footer');
const next = (page: Page) =>
  footer(page)
    .getByRole('button', { name: /^(Continue|Weiter)/ })
    .click();

async function expectStep(page: Page, title: string) {
  await expect(heading(page)).toHaveText(title);
}

test.describe.configure({ mode: 'serial' });

test('first start: setup, reload resume, initialisation, login, workspace, second start', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  // Boot screen with real host data, then the setup assistant.
  await expect(page.locator('.sh-boot')).toBeVisible();
  await expect(page.locator('.sh-boot')).toContainText('logical cores');
  await page.screenshot({ path: `${SHOTS}/01-boot-dark.png` });
  await expectStep(page, 'Welcome');
  await page.screenshot({ path: `${SHOTS}/02-setup-welcome-dark.png` });

  await next(page);
  await expectStep(page, 'Language & region');
  await next(page);

  // Administrator: validation blocks, weak password is rejected, then PBKDF2 credential.
  await expectStep(page, 'Administrator');
  await next(page);
  await expect(page.getByText('Required.').first()).toBeVisible();
  await page.getByLabel('Full name').fill('Ada Lovelace');
  await expect(page.getByLabel('Username')).toHaveValue('ada.lovelace');
  await page.getByLabel('Password', { exact: true }).fill('weak');
  await page.getByLabel('Confirm password').fill('weak');
  await next(page);
  await expect(page.getByText('The password does not meet the policy.')).toBeVisible();
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm password').fill('mismatch');
  await next(page);
  await expect(page.getByText('Passwords do not match.')).toBeVisible();
  await page.getByLabel('Confirm password').fill(PASSWORD);
  await next(page);

  // System: RFC 1123 hostname validation.
  await expectStep(page, 'System & site');
  await page.getByLabel('Console hostname').fill('Bad_Host!');
  await next(page);
  await expect(page.getByText(/RFC 1123 hostname/)).toBeVisible();
  await page.getByLabel('Console hostname').fill('fra1-ops-01');
  await next(page);

  await expectStep(page, 'Appearance');
  await next(page);
  await expectStep(page, 'Infrastructure profile');
  await page.screenshot({ path: `${SHOTS}/03-setup-profile-dark.png` });
  await next(page);

  // Hardware: live validation, then reload in the middle of the setup.
  await expectStep(page, 'Hardware');
  await page.getByLabel('Compute racks').fill('12');
  await expect(page.locator('.sh-live')).toContainText('384');
  await page.waitForTimeout(600); // debounced draft save
  await page.reload();
  await expectStep(page, 'Hardware');
  await expect(page.getByText('Resumed at the last completed step.')).toBeVisible();
  await expect(page.getByLabel('Compute racks')).toHaveValue('12');
  await page.screenshot({ path: `${SHOTS}/04-setup-hardware-dark.png` });

  // Out-of-range input is clamped to the permitted range on blur.
  await page.getByLabel('Compute racks').fill('99999');
  await page.getByLabel('Data halls').focus();
  await expect(page.getByLabel('Compute racks')).toHaveValue('4096');
  await page.getByLabel('Compute racks').fill('8');
  // An engineering error (8 HGX nodes do not fit the rack's space, power and rear door).
  await page.getByLabel('Nodes per rack').fill('8');
  await page.getByLabel('Data halls').focus();
  await expect(page.locator('.sh-live')).toContainText('blocking error');
  await next(page);

  await expectStep(page, 'Network');
  await next(page);
  await expectStep(page, 'Site & plant');
  await next(page);
  await expectStep(page, 'Monitoring');
  await next(page);
  await expectStep(page, 'Security & operations');
  await page.getByRole('radio', { name: /Cold start/ }).click();
  await next(page);

  // Summary blocks initialisation and links back to the step that owns the error.
  await expectStep(page, 'Review');
  await expect(page.getByText('Initialisation is blocked until these errors are resolved.')).toBeVisible();
  await expect(footer(page).getByRole('button', { name: 'Initialise system' })).toBeDisabled();
  await page.screenshot({ path: `${SHOTS}/05-setup-summary-blocked-dark.png` });
  await page.getByRole('button', { name: 'Fix in “Hardware”' }).first().click();
  await expectStep(page, 'Hardware');
  await page.getByLabel('Nodes per rack').fill('4');
  await page.getByLabel('Data halls').focus();
  await expect(page.locator('.sh-live')).toContainText('No blocking issues');
  for (const step of ['Network', 'Site & plant', 'Monitoring', 'Security & operations', 'Review']) {
    await next(page);
    await expectStep(page, step);
  }
  await expect(page.getByText('Configuration is complete and valid.')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/06-setup-summary-dark.png`, fullPage: true });
  await footer(page).getByRole('button', { name: 'Initialise system' }).click();

  // Initialisation → infrastructure boot (cold start waits for capacity) → login.
  await expect(page.locator('.sh-boot')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.sh-boot__checks')).toContainText('Fabric subnet manager');
  await expect(page.locator('.sh-boot__checks')).toContainText('Cold start', { timeout: 30_000 });
  await page.screenshot({ path: `${SHOTS}/07-boot-infrastructure-dark.png` });
  await page.keyboard.press('v');
  await expect(page.locator('.sh-boot__log')).toContainText('SM: discovered');
  await page.screenshot({ path: `${SHOTS}/08-boot-verbose-dark.png` });
  await page.keyboard.press('v');

  await expect(page.locator('.sh-login')).toBeVisible({ timeout: 120_000 });
  await page.getByLabel('Username').fill('ada.lovelace');
  await page.getByLabel('Password', { exact: true }).fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Incorrect username or password.')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/09-login-dark.png` });
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.locator('.sh-workspace')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Welcome, Ada Lovelace' })).toBeVisible();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/10-workspace-dark.png` });

  // Lock and unlock.
  await page.getByRole('button', { name: 'Lock' }).click();
  await expect(page.getByRole('heading', { name: 'Session locked' })).toBeVisible();
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.locator('.sh-workspace')).toBeVisible();

  // The internal Engineering Preview shares the running kernel; back to the console.
  await page.getByRole('button', { name: 'Engineering Preview' }).click();
  await expect(page.locator('.pv-app')).toBeVisible();
  await expect(page.locator('.pv-header')).toContainText('GPU Cluster 256');
  await page.getByRole('link', { name: 'Console' }).click();
  await expect(page.locator('.sh-workspace')).toBeVisible();

  // Second start: no setup, straight to login.
  await page.reload();
  await expect(page.locator('.sh-boot')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.sh-login')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.sh-setup')).toHaveCount(0);
  await page.getByLabel('Username').fill('ada.lovelace');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('.sh-workspace')).toBeVisible();

  expect(errors).toEqual([]);
});

test('light theme and mobile layout', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto('/');
  await expectStep(page, 'Willkommen');
  const noOverflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  expect(await noOverflow()).toBe(true);
  await page.screenshot({ path: `${SHOTS}/11-mobile-welcome-dark.png` });

  await next(page);
  await next(page);
  await page.getByLabel('Vollständiger Name').fill('Grace Hopper');
  await page.getByLabel('Passwort', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Passwort bestätigen').fill(PASSWORD);
  await next(page);
  await expectStep(page, 'System & Standort');
  await next(page);
  await expectStep(page, 'Erscheinungsbild');
  await page.getByRole('radio', { name: 'Hell' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.screenshot({ path: `${SHOTS}/12-mobile-appearance-light.png`, fullPage: true });
  await next(page);
  await page.getByRole('radio', { name: /Single AI Server/ }).click();
  for (const step of ['Hardware', 'Netzwerk', 'Standort & Anlage', 'Monitoring', 'Sicherheit & Betrieb']) {
    await next(page);
    await expectStep(page, step);
    expect(await noOverflow()).toBe(true);
  }
  await page.screenshot({ path: `${SHOTS}/13-mobile-operations-light.png` });
  await next(page);
  await expectStep(page, 'Überprüfung');
  await footer(page).getByRole('button', { name: 'System initialisieren' }).click();
  await expect(page.locator('.sh-login')).toBeVisible({ timeout: 120_000 });
  expect(await noOverflow()).toBe(true);
  await page.screenshot({ path: `${SHOTS}/14-mobile-login-light.png` });
  await page.getByLabel('Benutzername').fill('grace.hopper');
  await page.getByLabel('Passwort', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page.locator('.sh-workspace')).toBeVisible();
  expect(await noOverflow()).toBe(true);
  await page.screenshot({ path: `${SHOTS}/15-mobile-workspace-light.png`, fullPage: true });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/16-workspace-light.png` });
  await context.close();
});
