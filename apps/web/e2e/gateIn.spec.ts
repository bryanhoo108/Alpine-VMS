import { expect, test } from '@playwright/test';
import { cameraSees, expectGuardLayout, reset, signInWithPin } from './helpers';

test.beforeEach(async ({ page }) => {
  await reset(page);
  await signInWithPin(page, 'Entry Guard');
  await expect(page.getByText('Waiting for truck')).toBeVisible();
});

const shot = (name: string) => ({ path: `e2e-screens/${test.info().project.name}-${name}.png` });

test('pre-registered truck: Collect, 2 photos, card tap', async ({ page }) => {
  await expectGuardLayout(page);
  await page.screenshot(shot('1-waiting'));

  await cameraSees(page, 'WXY 1234');
  await expect(page.getByTestId('plate-text')).toHaveText('WXY 1234');
  await expect(page.getByTestId('prereg-chip')).toContainText('SDO 5005');
  await expectGuardLayout(page);
  await page.screenshot(shot('2-plate'));

  await page.getByRole('button', { name: 'Collect' }).click(); // tap 1
  await expect(page.getByText('Tap card')).toBeVisible();
  await page.getByRole('button', { name: 'Photo' }).click(); // tap 2 (IC)
  await expect(page.getByTestId('count-ic')).toHaveText('1');
  await page.getByRole('button', { name: 'Photo' }).click(); // tap 3 (documents)
  await expect(page.getByTestId('count-doc')).toHaveText('1');
  await expectGuardLayout(page);
  await page.screenshot(shot('3-photos'));

  await page.getByRole('button', { name: 'Test card' }).click(); // driver taps card
  const done = page.getByTestId('gate-in-done');
  await expect(done).toContainText('IN');
  await expect(done).toContainText(/T-\d{6}-001/);
  await expect(done).toContainText('SDO 5005');
  await expectGuardLayout(page);
  await page.screenshot(shot('4-done'));

  await done.click();
  await expect(page.getByText('Waiting for truck')).toBeVisible();
});

test('watchlist plate shows red and still lets the guard continue', async ({ page }) => {
  await cameraSees(page, 'BQL 1187');
  const banner = page.getByRole('alert');
  await expect(banner).toHaveAttribute('data-level', 'red');
  await expect(banner).toContainText('Call supervisor');
  await expect(banner).toContainText('Watchlist');
  await expectGuardLayout(page);
  await page.screenshot(shot('5-watchlist'));
  await expect(page.getByRole('button', { name: 'Collect' })).toBeEnabled();
});

test('camera misread: guard picks from the pre-registered list', async ({ page }) => {
  await cameraSees(page, 'BPN 2O45');
  // Wait for the plate screen, so the tap does not land as the screen changes.
  await expect(page.getByTestId('plate-text')).toHaveText('BPN 2 O 45');
  await expect(page.getByTestId('prereg-chip')).toHaveCount(0);
  await page.getByRole('button', { name: 'Pre-registered' }).click();
  await expectGuardLayout(page);
  await page.screenshot(shot('6-prereg-list'));
  await page.getByRole('button', { name: /BPN 2045/ }).click();
  await expect(page.getByTestId('plate-text')).toHaveText('BPN 2045');
  await expect(page.getByTestId('prereg-chip')).toContainText('SDO 5009, 5010');
  await page.getByRole('button', { name: 'Collect' }).click();
  await page.getByRole('button', { name: 'Test card' }).click();
  await expect(page.getByTestId('gate-in-done')).toContainText('SDO 5009, 5010');
});

test('new truck, first visit: pick company, Deliver (coil)', async ({ page }) => {
  await cameraSees(page, 'VBA 5521');
  await page.getByRole('button', { name: 'Deliver' }).click();
  await expect(page.getByText('Company?')).toBeVisible();
  await expectGuardLayout(page);
  await page.screenshot(shot('7-company'));
  await page.getByRole('button', { name: 'Transporter Two Haulage' }).click();
  await page.getByRole('button', { name: 'Test card' }).click();
  await expect(page.getByTestId('gate-in-done')).toContainText('VBA 5521');
});

test('guard corrects the plate with the on-screen keyboard', async ({ page }) => {
  await cameraSees(page, 'WVT 3389');
  await page.getByRole('button', { name: 'Change plate' }).click();
  await expectGuardLayout(page);
  await page.screenshot(shot('8-keyboard'));
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('button', { name: '8', exact: true }).click();
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByTestId('plate-text')).toHaveText('WVT 3388');
});

test('a card already in use asks for another card', async ({ page }) => {
  await cameraSees(page, 'BHE 4092');
  await page.getByRole('button', { name: 'Collect' }).click();
  await page.getByRole('button', { name: 'Skip' }).click();
  // Simulate a reader returning a card that is already on a trip.
  const { cardNo } = await (await page.request.get('/api/dev/free-card')).json();
  await page.request.post('/api/gate/in', {
    data: {
      plateReadId: null,
      plate: 'ZZZ1',
      type: 'inbound',
      cardNo,
      photoIds: [],
      transporterId: null,
      preRegistrationId: null,
    },
  });
  await page.keyboard.type(cardNo, { delay: 5 });
  await page.keyboard.press('Enter');
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Use another card');
  await expect(alert).toContainText('Card in use');
  await expectGuardLayout(page);
  await page.screenshot(shot('9-card-in-use'));
});
