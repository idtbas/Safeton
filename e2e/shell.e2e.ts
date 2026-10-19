/**
 * End-to-end flow of the operating system:
 *  - platform gates (install required, desktop only, minimum window size);
 *  - first boot → setup (with a reload in the middle) → initialisation and cold start → sign-in;
 *  - desktop: dock, system search, windows, snapping, context menu, settings, notification
 *    centre, lock, restart (second start without setup) and shut down / power on.
 *
 * The installed-application display mode cannot be emulated through Chromium's DevTools
 * protocol, so the tests report `display-mode: standalone` through an init script.
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const SHOTS = 'e2e/screenshots';
const PASSWORD = 'Correct-Horse-42!';

async function standalone(context: BrowserContext) {
  await context.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = (query: string) =>
      query.includes('display-mode: standalone')
        ? ({
            matches: true,
            media: query,
            onchange: null,
            addEventListener() {},
            removeEventListener() {},
            addListener() {},
            removeListener() {},
            dispatchEvent: () => false,
          } as unknown as MediaQueryList)
        : original(query);
  });
}

const heading = (page: Page) => page.locator('.sh-setup__heading h1');
const footer = (page: Page) => page.locator('.sh-setup__footer');
const next = (page: Page) =>
  footer(page)
    .getByRole('button', { name: /^(Continue|Weiter)/ })
    .click();
const expectStep = (page: Page, title: string) => expect(heading(page)).toHaveText(title);
const dock = (page: Page) => page.locator('.os-dock');

async function signIn(page: Page) {
  await expect(page.locator('.sh-login')).toBeVisible({ timeout: 120_000 });
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.keyboard.press('Enter');
  await expect(page.locator('.os-desktop')).toBeVisible();
}

test.describe.configure({ mode: 'serial' });

test('platform gates: installation required, desktop only, minimum window size', async ({ browser }) => {
  // Regular browser tab → installation screen.
  const tab = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
  const page = await tab.newPage();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Install Safeton' })).toBeVisible();
  await expect(page.locator('.os-gate')).toContainText('Web Workers (simulation engine)');
  await expect(page.locator('.sh-boot')).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/01-install-gate.png` });
  await tab.close();

  // Phone → not supported, even before installation.
  const phone = await browser.newContext({
    viewport: { width: 393, height: 852 },
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    isMobile: true,
    hasTouch: true,
    locale: 'en-US',
  });
  const phonePage = await phone.newPage();
  await phonePage.goto('/');
  await expect(phonePage.getByRole('heading', { name: 'Safeton needs a desktop' })).toBeVisible();
  await phonePage.screenshot({ path: `${SHOTS}/02-phone-blocked.png` });
  await phone.close();

  // Installed, but the window is too small → resize prompt over the system.
  const small = await browser.newContext({
    viewport: { width: 900, height: 640 },
    screen: { width: 1920, height: 1080 },
    locale: 'en-US',
  });
  await standalone(small);
  const smallPage = await small.newPage();
  await smallPage.goto('/');
  await expect(smallPage.getByRole('alertdialog', { name: 'Window too small' })).toBeVisible();
  await small.close();
});

test('first start, desktop session, restart and power cycle', async ({ context, page }) => {
  await standalone(context);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // ---- Boot: splash with real host data in the verbose console ------------------------------
  await page.goto('/');
  await expect(page.locator('.sh-boot')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/03-boot-splash.png` });
  await page.keyboard.press('v');
  await expect(page.locator('.sh-console')).toContainText('logical cores');
  await page.screenshot({ path: `${SHOTS}/04-boot-console.png` });
  await page.keyboard.press('v');

  // ---- Setup assistant ------------------------------------------------------------------------
  await expectStep(page, 'Welcome');
  await page.screenshot({ path: `${SHOTS}/05-setup-welcome.png` });
  await next(page);
  await expectStep(page, 'Language & region');
  await next(page);
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
  await page.getByLabel('Confirm password').fill(PASSWORD);
  await next(page);
  await expectStep(page, 'System & site');
  await page.getByLabel('Console hostname').fill('Bad_Host!');
  await next(page);
  await expect(page.getByText(/RFC 1123 hostname/)).toBeVisible();
  await page.getByLabel('Console hostname').fill('fra1-ops-01');
  await next(page);
  await expectStep(page, 'Appearance');
  await next(page);
  await expectStep(page, 'Infrastructure profile');
  await page.screenshot({ path: `${SHOTS}/06-setup-profile.png` });
  await next(page);

  // Reload in the middle of the setup resumes at the same step with the same values.
  await expectStep(page, 'Hardware');
  await page.getByLabel('Compute racks').fill('12');
  await expect(page.locator('.sh-live')).toContainText('384');
  await page.waitForTimeout(600);
  await page.reload();
  await page.keyboard.press('Escape');
  await expectStep(page, 'Hardware');
  await expect(page.getByText('Resumed at the last completed step.')).toBeVisible();
  await expect(page.getByLabel('Compute racks')).toHaveValue('12');
  await page.getByLabel('Compute racks').fill('8');
  // An engineering error (8 HGX nodes exceed the rack's space, power and rear door).
  await page.getByLabel('Nodes per rack').fill('8');
  await page.getByLabel('Data halls').focus();
  await expect(page.locator('.sh-live')).toContainText('blocking error');
  for (const step of ['Network', 'Site & plant', 'Monitoring', 'Security & operations']) {
    await next(page);
    await expectStep(page, step);
  }
  await page.getByRole('radio', { name: /Cold start/ }).click();
  await next(page);
  await expectStep(page, 'Review');
  await expect(footer(page).getByRole('button', { name: 'Initialise system' })).toBeDisabled();
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
  await footer(page).getByRole('button', { name: 'Initialise system' }).click();

  // ---- Infrastructure boot with cold start ------------------------------------------------------
  await expect(page.locator('.sh-boot')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.sh-boot__checks')).toContainText('Fabric subnet manager');
  await expect(page.locator('.sh-boot__checks')).toContainText('Cold start', { timeout: 30_000 });
  await page.screenshot({ path: `${SHOTS}/07-boot-infrastructure.png` });
  await page.keyboard.press('v');
  await expect(page.locator('.sh-console')).toContainText('SM: discovered');
  await page.keyboard.press('v');

  // ---- Sign-in ------------------------------------------------------------------------------------
  await expect(page.locator('.sh-login')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole('heading', { name: 'Ada Lovelace' })).toBeVisible();
  await page.getByLabel('Password', { exact: true }).fill('wrong-password');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Incorrect username or password.')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/08-sign-in.png` });
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.keyboard.press('Enter');

  // ---- Desktop --------------------------------------------------------------------------------------
  await expect(page.locator('.os-desktop')).toBeVisible();
  await expect(page.locator('.os-widget')).toContainText('GPU Cluster 256');
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/09-desktop.png` });

  // Desktop context menu (the browser menu never appears).
  await page.locator('.os-desktop__area').click({ button: 'right', position: { x: 600, y: 400 } });
  await expect(page.getByRole('menuitem', { name: 'Change wallpaper…' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menuitem', { name: 'Change wallpaper…' })).toHaveCount(0);

  // Dock launches the system monitor.
  await dock(page).getByRole('button', { name: 'System Monitor' }).click();
  const monitor = page.locator('.os-window[data-app="monitor"]');
  await expect(monitor).toContainText('IT load');
  await expect(page.locator('.os-menubar')).toContainText('System Monitor');

  // System search finds a node by hostname and opens its window.
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'System search' }).fill('gpu-h1a01-01');
  await expect(page.getByRole('option', { name: /gpu-h1a01-01/ })).toBeVisible();
  await page.keyboard.press('Enter');
  const node = page.locator('.os-window[data-app="node"]');
  await expect(node).toContainText('GPUs (8)');
  await expect(node.locator('.os-window__title')).toHaveText('gpu-h1a01-01');

  // Keyboard snapping docks the focused window to the left half.
  await page.keyboard.press('Control+Alt+ArrowLeft');
  await expect(node).toHaveAttribute('data-snapped', 'left');

  // App overview from the dock.
  await dock(page).getByRole('button', { name: 'Applications' }).click();
  await page.locator('.os-launcher__app', { hasText: 'Cluster Manager' }).click();
  await expect(page.locator('.os-window[data-app="cluster"]')).toContainText('Select a node');

  // Window menu in the menu bar → arrange all windows.
  await page.getByRole('button', { name: 'Window', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Arrange all windows' }).click();
  await expect(node).not.toHaveAttribute('data-snapped', 'left');
  await page.screenshot({ path: `${SHOTS}/10-desktop-windows.png` });

  // Settings change the wallpaper live.
  await page.getByRole('button', { name: 'System menu' }).click();
  await page.getByRole('menuitem', { name: 'System Settings…' }).click();
  const settings = page.locator('.os-window[data-app="settings"]');
  await settings.getByRole('button', { name: 'Desktop & dock' }).click();
  await settings.getByRole('radio', { name: 'Server hall' }).click();
  await expect(page.locator('.os-desktop > .os-wallpaper')).toHaveAttribute('data-wallpaper', 'racks');
  await page.screenshot({ path: `${SHOTS}/11-settings.png` });

  // Notification centre and control centre.
  await page
    .locator('.os-tray')
    .getByRole('button', { name: /^Notifications/ })
    .click();
  await expect(page.getByRole('dialog', { name: 'Notifications' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Control centre' }).click();
  await expect(page.getByRole('dialog', { name: 'Control centre' })).toContainText('Time scale');
  await page.screenshot({ path: `${SHOTS}/12-control-centre.png` });
  await page.keyboard.press('Escape');

  // Lock and unlock.
  await page.keyboard.press('Control+Alt+l');
  await expect(page.getByText('Session locked')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/13-lock-screen.png` });
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.keyboard.press('Enter');
  await expect(page.locator('.os-window[data-app="settings"]')).toBeVisible();

  // Restart (Ctrl+R) → full boot, no setup, sign-in.
  await page.keyboard.press('Control+r');
  await expect(page.getByRole('dialog', { name: /Restart the system/ })).toBeVisible();
  await page.getByRole('button', { name: 'Restart now' }).click();
  await expect(page.locator('.sh-boot')).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press('Escape');
  await expect(page.locator('.sh-setup')).toHaveCount(0);
  await signIn(page);

  // Shut down → off → power on → boot → sign-in.
  await page.getByRole('button', { name: 'System menu' }).click();
  await page.getByRole('menuitem', { name: 'Shut down…' }).click();
  await page.getByRole('button', { name: 'Shut down now' }).click();
  await expect(page.locator('.os-off')).toBeVisible();
  await page.getByRole('button', { name: 'Switch on' }).click();
  await expect(page.locator('.sh-boot')).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press('Escape');
  await signIn(page);

  expect(errors).toEqual([]);
});

test('light appearance chosen during setup applies to the whole system', async ({ context, page }) => {
  await standalone(context);
  await page.goto('/');
  await page.keyboard.press('Escape');
  await expectStep(page, 'Welcome');
  await next(page);
  await next(page);
  await page.getByLabel('Full name').fill('Grace Hopper');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm password').fill(PASSWORD);
  await next(page);
  await next(page);
  await expectStep(page, 'Appearance');
  await page.getByRole('radio', { name: 'Light' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.screenshot({ path: `${SHOTS}/14-setup-light.png` });
  await next(page);
  await page.getByRole('radio', { name: /Single AI Server/ }).click();
  for (let i = 0; i < 6; i++) await next(page);
  await expectStep(page, 'Review');
  await footer(page).getByRole('button', { name: 'Initialise system' }).click();
  await signIn(page);
  await dock(page).getByRole('button', { name: 'Workloads' }).click();
  await expect(page.locator('.os-window[data-app="workloads"]')).toContainText('New job');
  await dock(page).getByRole('button', { name: 'System Monitor' }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/15-desktop-light.png` });
});
