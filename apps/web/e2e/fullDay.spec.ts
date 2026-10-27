/**
 * A short day at the gate, through the screens only: a pre-registered pipe
 * truck and an inbound coil truck from gate in to gate out, plus a walk-in
 * pipe truck the clerk matches. One supervisor session uses every screen.
 */
import { expect, test, type Page } from '@playwright/test';
import { cameraSees, expectGuardLayout, reset } from './helpers';

const PASSWORD = process.env.E2E_PASSWORD ?? 'e2e-password';

const go = (page: Page, label: 'Office' | 'In' | 'Out' | 'Check') =>
  page.getByRole('button', { name: label, exact: true }).click();

async function gateIn(page: Page, plate: string, purpose: 'Collect' | 'Deliver', company?: string) {
  await go(page, 'In');
  await cameraSees(page, plate);
  await expect(page.getByTestId('plate-text')).toHaveText(plate);
  await page.getByRole('button', { name: purpose }).click();
  if (company) await page.getByRole('button', { name: company }).click();
  await page.getByRole('button', { name: 'Photo' }).click();
  await page.getByRole('button', { name: 'Photo' }).click();
  await page.getByRole('button', { name: 'Test card' }).click();
  await expect(page.getByTestId('gate-in-done')).toContainText(plate);
  await page.getByTestId('gate-in-done').click();
}

async function openTruck(page: Page, plate: string) {
  await go(page, 'Office');
  await page
    .getByRole('list', { name: 'Trucks on site' })
    .getByRole('button', { name: new RegExp(plate) })
    .click();
  await expect(page.getByTestId('trip-panel')).toContainText(plate);
}

async function gateOut(page: Page, plate: string, level: 'green' | 'amber' | 'red') {
  await go(page, 'Out');
  await cameraSees(page, plate, 'exit');
  await expect(page.getByTestId('exit-status')).toHaveAttribute('data-level', level);
  await expectGuardLayout(page);
  await page.getByRole('button', { name: 'Test card' }).click();
  await expect(page.getByTestId('gate-out-done')).toHaveAttribute('data-level', level);
  await page.getByTestId('gate-out-done').click();
}

test('a day at the gate, end to end through every screen', async ({ page }) => {
  test.setTimeout(120_000);
  await reset(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Office login' }).click();
  await page.getByLabel('Username').fill('supervisor');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();

  // 1. Pre-registered pipe truck: gate in, weigh, DO, check, gate out green.
  await gateIn(page, 'WXY 1234', 'Collect');
  await openTruck(page, 'WXY 1234');
  await expect(page.getByTestId('linked-5005')).toBeVisible();
  await page.getByRole('button', { name: 'Test weigh in' }).click();
  await page.getByRole('button', { name: 'Test DO' }).click();
  await expect(page.getByRole('list', { name: 'Linked DOs' })).toContainText('In SAP');
  await page.getByRole('button', { name: 'Test weigh out' }).click();
  await expect(page.getByTestId('trip-panel')).toContainText(/WB\d+/);

  await go(page, 'Check');
  await page
    .getByRole('list', { name: 'Waiting for check' })
    .getByRole('button', { name: /WXY 1234/ })
    .click();
  await page.getByRole('button', { name: 'All OK' }).click();
  await page.getByRole('button', { name: 'Photo' }).click();
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByTestId('check-done')).toContainText('Approved');
  await page.getByTestId('check-done').click();

  await gateOut(page, 'WXY 1234', 'green');

  // 2. Inbound coil truck, first visit: company picked at the gate, weighed, green out.
  await gateIn(page, 'VBA 5521', 'Deliver', 'Transporter Two Haulage');
  await openTruck(page, 'VBA 5521');
  await page.getByRole('button', { name: 'Test weigh in' }).click();
  await page.getByRole('button', { name: 'Test weigh out' }).click();
  await gateOut(page, 'VBA 5521', 'green');

  // 3. Walk-in pipe truck: the clerk matches it; it leaves before the check: red, recorded.
  await gateIn(page, 'BJR 9102', 'Collect', 'Transporter One Logistics');
  await openTruck(page, 'BJR 9102');
  await page.getByRole('list', { name: 'SDO shortlist' }).getByText('SDO 5011').click();
  await page.getByRole('button', { name: /^Link/ }).click();
  await expect(page.getByTestId('linked-5011')).toBeVisible();
  await gateOut(page, 'BJR 9102', 'red');

  // End of day: nothing on site, the red exit is an open alert, SAP got everything.
  await go(page, 'Office');
  await expect(page.getByRole('list', { name: 'Trucks on site' })).toContainText('No trucks.');
  await page.getByRole('tab', { name: /Alerts/ }).click();
  await expect(page.getByRole('list', { name: 'Open alerts' })).toContainText('No check');
  // Background jobs empty the SAP and CWIS queues within seconds.
  await expect
    .poll(async () => (await (await page.request.get('/api/health')).json()) as unknown, {
      timeout: 15_000,
    })
    .toMatchObject({
      trucksOnSite: 0,
      queues: { sapWrites: { pending: 0 }, cwisPushes: { pending: 0 } },
    });
  const report = await (
    await page.request.get(
      `/api/reports/reconcile?date=${new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' })}`,
    )
  ).json();
  expect(report.exitsWithoutDo.map((e: { plate: string }) => e.plate)).toEqual(['BJR9102']);
});
