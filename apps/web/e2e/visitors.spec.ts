import { expect, test, type Page } from '@playwright/test';
import {
  cameraSees,
  expectGuardLayout,
  expectNoSidewaysOverflow,
  reset,
  signInWithPin,
} from './helpers';

const PASSWORD = process.env.E2E_PASSWORD ?? 'e2e-password';
const shot = (name: string) => ({
  path: `e2e-screens/${test.info().project.name}-visitors-${name}.png`,
});

async function officeLogin(page: Page, username = 'clerk') {
  await page.goto('/');
  await page.getByRole('button', { name: 'Office login' }).click();
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await reset(page);
});

test('office invites a contractor group and copies the QR', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await officeLogin(page);
  await page.getByRole('tab', { name: /Visitors/ }).click();

  const list = page.getByRole('list', { name: 'Invites' });
  await expect(list).toContainText('Sample Visitor');
  await expect(list).toContainText('Sample Contractor Lead');

  await page.getByRole('button', { name: 'Contractor', exact: true }).click();
  await page.getByLabel('Name (person who registers)').fill('Contractor Delta Lead');
  await page.getByLabel('Company').fill('Contractor Delta Sdn Bhd');
  await page.getByLabel('Mobile (for WhatsApp)').fill('012-345 6789');
  await page
    .getByRole('combobox', { name: /^Host/ })
    .selectOption({ label: 'Plant Engineer (Maintenance)' });
  await page.getByLabel('People in the group').fill('5');
  await page.getByRole('button', { name: 'Create invite' }).click();

  // The new invite opens with its QR, code and message.
  const qr = page.getByTestId('invite-qr');
  await expect(qr.getByRole('img', { name: /QR code for invite/ })).toBeVisible();
  await expect(qr).toContainText('Hello Contractor Delta Lead');
  await expect(qr).toContainText('Group of 5 people');
  const code = (await qr.getByLabel('Invite code').textContent())!.replace(' ', '');
  expect(code).toMatch(/^[2-9A-HJKMNP-Z]{8}$/);
  await expect(list).toContainText('+4 people');

  await qr.getByRole('button', { name: 'Copy QR' }).click();
  await expect(qr.getByRole('status')).toContainText(/QR copied|saved as/);
  await expectNoSidewaysOverflow(page);
  await page.screenshot(shot('1-invite'));

  // Cancel: it stays in the list, marked cancelled.
  await list.getByRole('button', { name: 'Cancel invite for Contractor Delta Lead' }).click();
  await expect(
    list.getByRole('listitem').filter({ hasText: 'Contractor Delta Lead' }),
  ).toContainText('Cancelled');
});

test('office adds and removes a host', async ({ page }) => {
  await officeLogin(page);
  await page.getByRole('tab', { name: /Visitors/ }).click();
  const hosts = page.getByRole('list', { name: 'Hosts' });
  await page.getByLabel('Host name').fill('QA Lead');
  await page.getByLabel('Department').fill('Quality');
  await page.getByRole('button', { name: 'Add host' }).click();
  await expect(hosts).toContainText('QA Lead');
  await hosts.getByRole('button', { name: 'Remove host QA Lead' }).click();
  await expect(hosts).not.toContainText('QA Lead');
  await expectNoSidewaysOverflow(page);
});

test.describe('gate in', () => {
  test('invited group: Visitor, pick name, Photo, card (3 taps)', async ({ page }) => {
    await signInWithPin(page, 'Entry Guard');
    await page.getByRole('button', { name: 'Visitor' }).click();
    const expected = page.getByRole('list', { name: 'Expected today' });
    await expect(expected).toContainText('Sample Visitor');
    await expect(expected).toContainText('Sample Contractor Lead');
    await expectGuardLayout(page);
    await page.screenshot(shot('2-expected'));

    await expected.getByRole('button', { name: /Sample Contractor Lead/ }).click();
    await expect(page.getByTestId('group-size')).toHaveText('4');
    // Only 3 of the 4 came today.
    await page.getByRole('button', { name: 'Fewer people' }).click();
    await page.getByRole('button', { name: 'Photo' }).click();
    await expect(page.getByTestId('count-ic')).toHaveText('1');
    const ic = page.getByTestId('ic-read');
    await expect(ic).toContainText('5678', { timeout: 15_000 });
    // Not the person in front of the guard: "Wrong" keeps the read off the record.
    await ic.getByRole('button', { name: 'Wrong' }).click();
    await expect(ic).toHaveAttribute('data-rejected', 'true');
    await expectGuardLayout(page);
    await page.screenshot(shot('3-photo'));
    await page.getByRole('button', { name: 'Test card' }).click();

    const done = page.getByTestId('visit-in-done');
    await expect(done).toContainText('Sample Contractor Lead');
    await expect(done).toContainText('+ 2 people');
    await expect(done).toHaveClass(/bg-ok/);
    await expectGuardLayout(page);
    await page.screenshot(shot('4-done'));
  });

  test('scanning the QR finds the invite', async ({ page }) => {
    await signInWithPin(page, 'Entry Guard');
    await page.getByRole('button', { name: 'Visitor' }).click();
    await page.getByRole('button', { name: 'Scan QR' }).click();
    await expectGuardLayout(page);
    await page.getByRole('button', { name: 'Test QR' }).click();
    await expect(page.getByTestId('group-size')).toBeVisible();
    await page.getByRole('button', { name: 'Test card' }).click();
    await expect(page.getByTestId('visit-in-done')).toContainText('IN');
  });

  test('walk-in registers on the tablet, host does not answer: amber', async ({ page }) => {
    await signInWithPin(page, 'Entry Guard');
    await page.getByRole('button', { name: 'Visitor' }).click();
    await page.getByRole('button', { name: 'Walk-in' }).click();
    await page.getByRole('button', { name: 'Contractor' }).click();
    await page.getByLabel('Your name').fill('Walk In Welder');
    await page.getByLabel('Company').fill('Fixers Sdn Bhd');
    await page.getByRole('button', { name: 'More people' }).click();
    await expectGuardLayout(page);
    await page.screenshot(shot('5-walk-in'));
    await page.getByRole('button', { name: 'Next' }).click();
    await page
      .getByRole('list', { name: 'Hosts' })
      .getByRole('button', { name: /Plant Engineer/ })
      .click();
    await expect(page.getByText('Ext 305')).toBeVisible();
    await expectGuardLayout(page);
    await page.screenshot(shot('6-call-host'));
    await page.getByRole('button', { name: 'No answer' }).click();
    await page.getByRole('button', { name: 'Test card' }).click();
    const done = page.getByTestId('visit-in-done');
    await expect(done).toContainText('Walk In Welder');
    await expect(done).toContainText('No host OK');
    await expect(done).toHaveClass(/bg-warn/);
  });

  test('staff car: one tap logs the plate', async ({ page }) => {
    await signInWithPin(page, 'Entry Guard');
    await cameraSees(page, 'WSF 8080');
    await expect(page.getByRole('button', { name: 'Staff' })).toBeVisible();
    await expectGuardLayout(page);
    await page.screenshot(shot('7-plate-buttons'));
    await page.getByRole('button', { name: 'Staff' }).click();
    await expect(page.getByTestId('staff-done')).toContainText('WSF 8080');
    // Back to waiting; the same read does not come back.
    await expect(page.getByText('Waiting for truck')).toBeVisible({ timeout: 5000 });
  });
});

/** Gate a walk-in group in through the guard API; returns its card number. */
async function walkInGroup(
  page: Page,
  name: string,
  groupSize: number,
  plate: string | null = null,
) {
  await page.goto('/');
  await signInWithPin(page, 'Entry Guard');
  const { cardNo } = await (await page.request.get('/api/dev/free-card')).json();
  const res = await page.request.post('/api/gate/visit-in', {
    data: {
      inviteId: null,
      type: 'contractor',
      name,
      company: 'Fixers Sdn Bhd',
      phone: null,
      hostId: null,
      groupSize,
      hostConfirmed: true,
      plate,
      plateReadId: null,
      cardNo,
      photoIds: [],
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
  await page.getByRole('button', { name: 'Sign out' }).click();
  return cardNo as string;
}

async function exitGuard(page: Page) {
  await signInWithPin(page, 'Exit Guard');
  await page.getByRole('button', { name: 'Out', exact: true }).click();
  await expect(page.getByText('Waiting for truck')).toBeVisible();
}

test.describe('gate out and muster', () => {
  test('the group hands the card back: one tap, green OUT', async ({ page }) => {
    const cardNo = await walkInGroup(page, 'Crane Crew', 4);
    await exitGuard(page);
    await expect(page.getByRole('button', { name: 'People (1)' })).toBeVisible();
    await expectGuardLayout(page);
    await page.keyboard.type(cardNo, { delay: 5 });
    await page.keyboard.press('Enter');
    const done = page.getByTestId('visit-out-done');
    await expect(done).toContainText('Crane Crew');
    await expect(done).toContainText('+ 3 people');
    await expect(done).toHaveAttribute('data-level', 'green');
    await expectGuardLayout(page);
    await page.screenshot(shot('8-out'));
  });

  test('picked from the list, no card: two taps, red', async ({ page }) => {
    await walkInGroup(page, 'Lost Card Crew', 2);
    await exitGuard(page);
    await page.getByRole('button', { name: 'People (1)' }).click();
    await page
      .getByRole('list', { name: 'People inside' })
      .getByRole('button', { name: /Lost Card Crew/ })
      .click();
    await expect(page.getByTestId('exit-group')).toHaveText('2');
    await expectGuardLayout(page);
    await page.screenshot(shot('9-visit-exit'));
    await page.getByRole('button', { name: 'No card' }).click();
    await page.getByRole('button', { name: 'Yes, no card' }).click();
    await expect(page.getByTestId('visit-out-done')).toHaveAttribute('data-level', 'red');
  });

  test('a visitor car at the exit camera: Visitor opens the group by its plate', async ({
    page,
  }) => {
    await walkInGroup(page, 'Car Visitor', 1, 'WVX 2211');
    await exitGuard(page);
    await cameraSees(page, 'WVX 2211', 'exit');
    await expect(page.getByText('Not inside')).toBeVisible();
    await expectGuardLayout(page);
    await page.getByRole('button', { name: 'Visitor' }).click();
    await expect(page.getByText('Car Visitor')).toBeVisible();
    await page.getByRole('button', { name: 'Test card' }).click();
    await expect(page.getByTestId('visit-out-done')).toContainText('Car Visitor');
  });

  test('staff car at the exit: Staff logs it out', async ({ page }) => {
    await exitGuard(page);
    await cameraSees(page, 'WSF 8080', 'exit');
    await expect(page.getByText('Not inside')).toBeVisible();
    await page.getByRole('button', { name: 'Staff' }).click();
    await expect(page.getByTestId('staff-done')).toContainText('WSF 8080');
  });

  test('supervisor sees the headcount and runs a muster', async ({ page }) => {
    await walkInGroup(page, 'Muster Crew', 5);
    await officeLogin(page, 'supervisor');
    await expect(page.getByTestId('headcount')).toHaveText('5');
    await page.getByRole('button', { name: 'Muster' }).click();
    const dialog = page.getByRole('dialog', { name: 'Muster' });
    await dialog.getByRole('button', { name: 'Start roll call' }).click();
    await expect(dialog.getByTestId('muster-count')).toHaveText('0 / 5 safe');
    await expectNoSidewaysOverflow(page);
    await page.screenshot(shot('10-muster'));
    await dialog
      .getByRole('list', { name: 'Not seen' })
      .getByRole('button', { name: /Muster Crew/ })
      .click();
    await expect(dialog.getByTestId('muster-count')).toHaveText('5 / 5 safe');
    await dialog.getByRole('button', { name: 'End muster' }).click();
    await dialog.getByRole('button', { name: 'Yes, end' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: 'Muster', exact: true })).toBeVisible();
  });
});
