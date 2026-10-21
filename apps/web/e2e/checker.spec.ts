import { expect, test, type Page } from '@playwright/test';
import { expectGuardLayout, reset, signInWithPin } from './helpers';

const PASSWORD = process.env.E2E_PASSWORD ?? 'e2e-password';
const shot = (name: string) => ({
  path: `e2e-screens/${test.info().project.name}-checker-${name}.png`,
});

/** As supervisor (all roles): gate a truck in and link SDOs. Returns trip id and card. */
async function truckReady(page: Page, plate: string, sdoNos: string[]) {
  await page.request.post('/api/auth/login', {
    data: { username: 'supervisor', secret: PASSWORD },
  });
  const { cardNo } = await (await page.request.get('/api/dev/free-card')).json();
  const res = await page.request.post('/api/gate/in', {
    data: {
      plateReadId: null,
      plate,
      type: 'outbound',
      cardNo,
      photoIds: [],
      transporterId: null,
      preRegistrationId: null,
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
  const { trip } = await res.json();
  if (sdoNos.length) {
    const link = await page.request.post(`/api/clerk/trips/${trip.id}/sdos`, { data: { sdoNos } });
    expect(link.ok(), await link.text()).toBe(true);
  }
  await page.request.post('/api/auth/logout');
  return { tripId: trip.id as string, cardNo: cardNo as string };
}

test.beforeEach(async ({ page }) => {
  await reset(page);
});

test('normal load: All OK, Photo, Approve', async ({ page }) => {
  await truckReady(page, 'BPN 2046', ['5009', '5010']);
  await signInWithPin(page, 'Checker 1');
  const queue = page.getByRole('list', { name: 'Waiting for check' });
  await expect(queue).toContainText('BPN 2046');
  await expectGuardLayout(page);
  await page.screenshot(shot('1-waiting'));

  await queue.getByRole('button', { name: /BPN 2046/ }).click();
  await expect(page.getByRole('list', { name: 'Lines' }).getByRole('listitem')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Approve' })).toBeDisabled();
  await expectGuardLayout(page);
  await page.screenshot(shot('2-lines'));

  await page.getByRole('button', { name: 'All OK' }).click(); // tap 1
  await page.getByRole('button', { name: 'Photo' }).click(); // tap 2
  await expect(page.getByTestId('count-load')).toHaveText('1');
  await expectGuardLayout(page);
  await page.screenshot(shot('3-ready'));
  await page.getByRole('button', { name: 'Approve' }).click(); // tap 3
  await expect(page.getByTestId('check-done')).toContainText('Approved');
  await expectGuardLayout(page);
  await page.getByTestId('check-done').click();
  await expect(page.getByText('No truck to check')).toBeVisible();
});

test('card tap opens the truck; count a short line; reject as damaged', async ({ page }) => {
  const { cardNo } = await truckReady(page, 'WRC 6630', ['5008']);
  await signInWithPin(page, 'Checker 2');
  await expect(page.getByText('Tap card')).toBeVisible();
  // A USB/NFC reader types the card number and Enter.
  await page.keyboard.type(cardNo, { delay: 5 });
  await page.keyboard.press('Enter');
  const line = page.getByTestId('line-5008#0');
  await expect(line).toBeVisible();

  await page.getByRole('button', { name: /^Count/ }).click();
  await expect(page.getByTestId('counter-value')).toHaveText('250');
  await expectGuardLayout(page);
  await page.screenshot(shot('4-counter'));
  await page.getByRole('button', { name: '-10', exact: true }).click();
  await page.getByRole('button', { name: '-1', exact: true }).click();
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(line).toHaveAttribute('data-state', 'differs');
  await expect(line).toContainText('239');

  await page.getByRole('button', { name: 'Reject' }).click();
  await expectGuardLayout(page);
  await page.screenshot(shot('5-reasons'));
  await page.getByRole('button', { name: 'Damaged' }).click();
  await expect(page.getByTestId('check-done')).toContainText('Back to loading');
  await page.getByTestId('check-done').click();
  await expect(page.getByRole('list', { name: 'Waiting for check' })).toContainText('Re-check');
});

test('SDO amended after gate in shows "SDO changed" on the line', async ({ page }) => {
  const { tripId } = await truckReady(page, 'BQA 7701', ['5004']);
  await signInWithPin(page, 'Checker 1');
  await page.request.post('/api/dev/sap/amend', { data: { sdoNo: '5004', lineNo: 0, pieces: 30 } });
  await page
    .getByRole('list', { name: 'Waiting for check' })
    .getByRole('button', { name: /BQA 7701/ })
    .click();
  await expect(page.getByTestId('sdo-changed')).toBeVisible();
  await expect(page.getByTestId('line-5004#0')).toContainText('Changed');
  await expect(page.getByTestId('line-5004#0')).toContainText('30');
  await expectGuardLayout(page);
  await page.screenshot(shot('6-changed'));
  expect(tripId).toBeTruthy();
});

test('unknown card says so', async ({ page }) => {
  await signInWithPin(page, 'Checker 1');
  await page.keyboard.type('04FFFFFFFFFFFF', { delay: 5 });
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toContainText('Card not on a truck');
});
