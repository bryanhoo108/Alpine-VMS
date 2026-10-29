import { expect, test, type Page } from '@playwright/test';
import { expectNoSidewaysOverflow, reset } from './helpers';

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
