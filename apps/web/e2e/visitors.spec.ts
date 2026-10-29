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
