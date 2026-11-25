import { expect, test } from '@playwright/test';
import { expectNoSidewaysOverflow, reset } from './helpers';

const PASSWORD = process.env.E2E_PASSWORD ?? 'e2e-password';
const shot = (name: string) => ({
  path: `e2e-screens/${test.info().project.name}-cwis-${name}.png`,
});

test.beforeEach(async ({ page }) => {
  await reset(page);
});

test('simulated CWIS gets the truck from the gate; the pass scan weighs it in and out', async ({
  page,
}) => {
  const r = page.request;
  await r.post('/api/auth/login', { data: { username: 'supervisor', secret: PASSWORD } });
  const { cardNo } = await (await r.get('/api/dev/free-card')).json();
  const gate = await r.post('/api/gate/in', {
    data: {
      plateReadId: null,
      plate: 'BKA 4321',
      type: 'outbound',
      cardNo,
      photoIds: [],
      transporterId: null,
      preRegistrationId: null,
    },
  });
  expect(gate.ok(), await gate.text()).toBe(true);
  const { trip } = await gate.json();

  await page.goto('/');
  await page.getByRole('button', { name: 'CWIS', exact: true }).click();
  const pending = page.getByRole('table', { name: 'Received from VMS' });
  await expect(pending).toContainText('BKA 4321');
  await expect(pending).toContainText(cardNo);
  await expect(pending).toContainText('NEW');
  await expectNoSidewaysOverflow(page);
  await page.screenshot(shot('1-received'));

  // The operator's reader types the pass (here: the QR text) and Enter.
  await page.keyboard.type(`APMVMS-PASS:${cardNo}`, { delay: 5 });
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toContainText('weighed in');
  await expect(pending).not.toContainText('BKA 4321');
  const tickets = page.getByRole('table', { name: 'Weighing tickets' });
  await expect(tickets).toContainText('BKA 4321');
  await expect(tickets).toContainText('on site');
  await expect(page.getByTestId('cwis-scale')).not.toHaveText('0');
  await page.screenshot(shot('2-weighed-in'));

  await page.keyboard.type(cardNo, { delay: 5 });
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toContainText('weighed out');
  await expect(tickets).not.toContainText('on site');

  // The VMS has the ticket.
  const detail = await (await r.get(`/api/clerk/trips/${trip.id}`)).json();
  expect(JSON.stringify(detail)).toMatch(/WB\d+/);
});
