import { expect, test, type Page } from '@playwright/test';
import { expectNoSidewaysOverflow, reset } from './helpers';

const PASSWORD = process.env.E2E_PASSWORD ?? 'e2e-password';
const shot = (name: string) => ({
  path: `e2e-screens/${test.info().project.name}-overview-${name}.png`,
});

async function officeLogin(page: Page, username: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Office login' }).click();
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
}

/** Supervisor rebuilds the busy sample day from the Live screen. */
async function restartDay(page: Page) {
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Restart day' }).click();
  await expect(page.getByRole('button', { name: 'Restart day' })).toBeEnabled({ timeout: 30_000 });
}

test.beforeEach(async ({ page }) => {
  await reset(page);
});

test('supervisor sees the live overview of a busy day and a truck timeline', async ({ page }) => {
  await officeLogin(page, 'supervisor');
  const overview = page.getByTestId('overview');
  await expect(overview).toBeVisible();
  await restartDay(page);

  await expect(page.getByTestId('exits')).toHaveText(/3\s*2\s*1/);
  const inside = page.getByRole('list', { name: 'Trucks inside' });
  await expect(inside.getByRole('listitem')).toHaveCount(9);
  await expect(inside).toContainText('Ready to go');
  await expect(inside).toContainText('Not matched');
  await expect(page.getByRole('list', { name: 'Open alerts' })).toContainText('BQL 1187');
  await expectNoSidewaysOverflow(page);
  await page.screenshot(shot('1-live'));

  await inside.getByRole('button', { name: /BMK 7711/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Truck timeline' });
  const timeline = dialog.getByRole('list', { name: 'Timeline' });
  await expect(timeline).toContainText('Gate in');
  await expect(timeline).toContainText('SDO 5008 matched');
  await expect(timeline).toContainText('Load approved');
  // The weighbridge took the SDO from this truck, not from an earlier truck with the same card.
  await expect(timeline).not.toContainText('SDO 5012');
  await expect(timeline).toContainText('Weighed out');
  await expectNoSidewaysOverflow(page);
  await page.screenshot(shot('2-timeline'));
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();

  // Auto-play switches on and off.
  const play = page.getByRole('button', { name: 'Auto-play' });
  await play.click();
  const stop = page.getByRole('button', { name: 'Stop auto-play' });
  await expect(stop).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Speed 1×' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // Fast forward: 10× moves a truck every 2 seconds; auto-play trucks have JQ plates.
  await page.getByRole('button', { name: 'Speed 10×' }).click();
  await expect(page.getByRole('button', { name: 'Speed 10×' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(inside).toContainText('JQ', { timeout: 10_000 });
  await expectNoSidewaysOverflow(page);
  await page.screenshot(shot('4-fast-forward'));
  await stop.click();
  await expect(page.getByRole('button', { name: 'Auto-play' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});

test('clerk looks back at a truck that left today', async ({ page }) => {
  await officeLogin(page, 'supervisor');
  await restartDay(page);
  await page.getByRole('button', { name: 'Sign out' }).click();

  await officeLogin(page, 'clerk');
  await page.getByRole('button', { name: 'Left today' }).click();
  const list = page.getByRole('list', { name: 'Trucks on site' });
  await expect(list.getByRole('listitem')).toHaveCount(6);
  await list.getByRole('button', { name: /WRC 6630/ }).click();

  const panel = page.getByTestId('trip-panel');
  const timeline = panel.getByRole('list', { name: 'Timeline' });
  await expect(timeline).toContainText('Gate out');
  await expect(timeline).toContainText('card NOT returned');
  // Truck has left: nothing to change any more.
  await expect(panel.getByRole('button', { name: /Remove SDO/ })).toHaveCount(0);
  await expectNoSidewaysOverflow(page);
  await page.screenshot(shot('3-left-today'));

  // Clerk has the Live screen too.
  await page.getByRole('button', { name: 'Live' }).click();
  await expect(page.getByTestId('overview')).toBeVisible();
  // Demo controls are for the supervisor only.
  await expect(page.getByRole('button', { name: 'Restart day' })).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Trucks inside' }).getByRole('listitem')).toHaveCount(
    9,
  );
});
