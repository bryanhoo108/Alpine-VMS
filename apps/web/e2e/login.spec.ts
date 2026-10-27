import { expect, test } from '@playwright/test';
import { expectGuardLayout, PIN, reset } from './helpers';

const shot = (name: string) => ({ path: `e2e-screens/${test.info().project.name}-${name}.png` });

test.beforeEach(async ({ page }) => reset(page));

test('guard signs in by tapping name and PIN; wrong PIN shows red dots', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Tap your name')).toBeVisible();
  await expectGuardLayout(page);
  await page.getByRole('button', { name: 'Entry Guard' }).click();
  for (const d of '0000') await page.getByRole('button', { name: d, exact: true }).click();
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByTestId('pin-dots')).toHaveText('Wrong PIN');
  await expectGuardLayout(page);
  await page.screenshot(shot('0-login'));

  for (const d of PIN) await page.getByRole('button', { name: d, exact: true }).click();
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByText('Waiting for truck')).toBeVisible();
});

test('sign-in survives a reload and sign-out returns to the name list', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Exit Guard' }).click();
  for (const d of PIN) await page.getByRole('button', { name: d, exact: true }).click();
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByRole('heading', { name: 'Gate In' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Gate In' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByText('Tap your name')).toBeVisible();
});
