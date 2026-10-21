import { expect, test, type Page } from '@playwright/test';
import { cameraSees, expectNoSidewaysOverflow, reset, signInWithPin } from './helpers';

const PASSWORD = process.env.E2E_PASSWORD ?? 'e2e-password';
const shot = (name: string) => ({
  path: `e2e-screens/${test.info().project.name}-office-${name}.png`,
});

async function officeLogin(page: Page, username = 'clerk') {
  await page.goto('/');
  await page.getByRole('button', { name: 'Office login' }).click();
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
}

/** Gate a truck in through the guard API (faster than the guard screen). */
async function gateIn(page: Page, plate: string, type: 'outbound' | 'inbound' = 'outbound') {
  const { cardNo } = await (await page.request.get('/api/dev/free-card')).json();
  const res = await page.request.post('/api/gate/in', {
    data: {
      plateReadId: null,
      plate,
      type,
      cardNo,
      photoIds: [],
      transporterId: null,
      preRegistrationId: null,
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
}

test.beforeEach(async ({ page }) => {
  await reset(page);
});

test('clerk matches a walk-in truck to the SDO on its CWIS ticket', async ({ page }) => {
  await signInWithPin(page, 'Entry Guard');
  await gateIn(page, 'BJR 9102');
  await page.getByRole('button', { name: 'Sign out' }).click();

  await officeLogin(page);
  const list = page.getByRole('list', { name: 'Trucks on site' });
  await expect(list).toContainText('BJR 9102');
  await expect(list).toContainText('Not matched');
  await expectNoSidewaysOverflow(page);
  await page.screenshot(shot('1-list'));

  await list.getByRole('button', { name: /BJR 9102/ }).click();
  const panel = page.getByTestId('trip-panel');
  await expect(panel).toContainText('Not matched yet');

  // Weighbridge operator weighs it in and types SDO 5011 (mock control).
  // The screen updates by itself (live events).
  const [trip] = await (await page.request.get('/api/clerk/trips')).json();
  const weigh = await page.request.post('/api/dev/cwis/weigh-in', {
    data: { tripId: trip.id, sdoNos: ['5011'] },
  });
  expect(weigh.ok()).toBe(true);
  await expect(panel.getByText(/^WB\d+/)).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'SDO shortlist' }).getByRole('listitem').first(),
  ).toContainText('On CWIS ticket');

  const shortlist = page.getByRole('list', { name: 'SDO shortlist' });
  await shortlist.getByText('SDO 5011').click();
  await page.getByRole('button', { name: /^Link/ }).click();
  await expect(page.getByTestId('linked-5011')).toContainText('Customer Bravo Trading');
  await expectNoSidewaysOverflow(page);
  await page.screenshot(shot('2-matched'));
  // On a phone the list is hidden while a truck is open.
  const back = page.getByRole('button', { name: 'Back to list' });
  if (await back.isVisible()) await back.click();
  await expect(list).toContainText('SDO 5011');
});

test('clerk pre-registers a truck and the guard sees it auto-match at the gate', async ({
  page,
}) => {
  await officeLogin(page);
  await page.getByRole('tab', { name: /Pre-registered/ }).click();
  await page.getByLabel('Plate').fill('bqa 77');
  await page.getByLabel('Search SDOs').fill('5006');
  await page.getByRole('checkbox').first().check();
  await page.getByRole('button', { name: 'Pre-register' }).click();
  await expect(page.getByText('Saved BQA 77.')).toBeVisible();
  const rows = page.getByRole('list', { name: 'Pre-registered trucks' });
  await expect(rows).toContainText('BQA 77');
  await expect(rows.getByText('Late', { exact: true })).toBeVisible(); // seeded BMK 7710 stays until cleared
  await expectNoSidewaysOverflow(page);
  await page.screenshot(shot('3-prereg'));

  // Clear the late one by hand.
  const late = rows.getByRole('listitem').filter({ hasText: 'BMK 7710' });
  await late.getByRole('button', { name: 'Clear' }).click();
  await late.getByLabel('Reason').fill('Customer cancelled');
  await late.getByRole('button', { name: 'Clear' }).click();
  await expect(late).toContainText('Cleared');

  await page.getByRole('button', { name: 'Sign out' }).click();
  await signInWithPin(page, 'Entry Guard');
  await cameraSees(page, 'BQA 77');
  await expect(page.getByTestId('prereg-chip')).toContainText('SDO 5006');
});

test('alerts tab shows red first and clears with a reason', async ({ page }) => {
  await signInWithPin(page, 'Entry Guard');
  await gateIn(page, 'BQL 1187'); // watchlist
  await page.getByRole('button', { name: 'Sign out' }).click();
  await officeLogin(page);
  await page.getByRole('tab', { name: /Alerts/ }).click();
  const list = page.getByRole('list', { name: 'Open alerts' });
  await expect(list.getByRole('listitem').first()).toContainText('Watchlist');
  await expectNoSidewaysOverflow(page);
  await page.screenshot(shot('4-alerts'));
  await list.getByRole('button', { name: 'Clear' }).first().click();
  await list.getByLabel('Reason').fill('Supervisor checked the load');
  await list.getByRole('button', { name: 'Clear' }).first().click();
  await expect(page.getByText('No open alerts.')).toBeVisible();
});

test('supervisor switches between Office and Gate In', async ({ page }) => {
  await officeLogin(page, 'supervisor');
  await expect(page.getByRole('heading', { name: 'Office' })).toBeVisible();
  await page.getByRole('button', { name: 'Gate In', pressed: false }).click();
  await expect(page.getByText('Waiting for truck')).toBeVisible();
});
