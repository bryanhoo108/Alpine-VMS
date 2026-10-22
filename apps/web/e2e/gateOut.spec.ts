import { expect, test, type Page } from '@playwright/test';
import { cameraSees, expectGuardLayout, reset, signInWithPin } from './helpers';

const PASSWORD = process.env.E2E_PASSWORD ?? 'e2e-password';
const shot = (name: string) => ({
  path: `e2e-screens/${test.info().project.name}-out-${name}.png`,
});

interface Ready {
  tripId: string;
  cardNo: string;
}

/** As supervisor: gate a truck in and take it as far as asked. */
async function truckReady(
  page: Page,
  plate: string,
  o: {
    sdoNos?: string[];
    do?: boolean;
    approve?: boolean;
    weigh?: boolean;
    type?: 'outbound' | 'inbound';
  } = {},
): Promise<Ready> {
  const r = page.request;
  await r.post('/api/auth/login', { data: { username: 'supervisor', secret: PASSWORD } });
  const { cardNo } = await (await r.get('/api/dev/free-card')).json();
  const gate = await r.post('/api/gate/in', {
    data: {
      plateReadId: null,
      plate,
      type: o.type ?? 'outbound',
      cardNo,
      photoIds: [],
      transporterId: null,
      preRegistrationId: null,
    },
  });
  expect(gate.ok(), await gate.text()).toBe(true);
  const tripId: string = (await gate.json()).trip.id;
  if (o.sdoNos)
    expect(
      (await r.post(`/api/clerk/trips/${tripId}/sdos`, { data: { sdoNos: o.sdoNos } })).ok(),
    ).toBe(true);
  if (o.do && o.sdoNos)
    expect((await r.post('/api/dev/sap/create-do', { data: { sdoNos: o.sdoNos } })).ok()).toBe(
      true,
    );
  if (o.approve) {
    const v = await (await r.get(`/api/checker/trips/${tripId}`)).json();
    const res = await r.post(`/api/checker/trips/${tripId}/decision`, {
      data: {
        decision: 'approve',
        reason: null,
        versions: Object.fromEntries(
          v.sdos.map((s: { sdoNo: string; version: string }) => [s.sdoNo, s.version]),
        ),
        lines: v.sdos.flatMap(
          (s: { sdoNo: string; lines: { lineNo: number; expected: number }[] }) =>
            s.lines.map((l) => ({ sdoNo: s.sdoNo, lineNo: l.lineNo, actualPieces: l.expected })),
        ),
        photoIds: [],
      },
    });
    expect(res.ok(), await res.text()).toBe(true);
  }
  if (o.weigh) {
    expect((await r.post('/api/dev/cwis/weigh-in', { data: { tripId } })).ok()).toBe(true);
    expect((await r.post('/api/dev/cwis/weigh-out', { data: { tripId } })).ok()).toBe(true);
  }
  await r.post('/api/auth/logout');
  return { tripId, cardNo };
}

async function exitGuard(page: Page) {
  await signInWithPin(page, 'Exit Guard');
  await page.getByRole('button', { name: 'Out', exact: true }).click();
  await expect(page.getByText('Waiting for truck')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await reset(page);
});

test('everything done: green Go, card tap, OUT', async ({ page }) => {
  await truckReady(page, 'BKA 4321', { sdoNos: ['5006'], do: true, approve: true, weigh: true });
  await exitGuard(page);
  await expectGuardLayout(page);
  await page.screenshot(shot('1-waiting'));

  await cameraSees(page, 'BKA 4321', 'exit');
  const status = page.getByTestId('exit-status');
  await expect(status).toHaveAttribute('data-level', 'green');
  await expect(status).toContainText('Go');
  await expectGuardLayout(page);
  await page.screenshot(shot('2-green'));

  await page.getByRole('button', { name: 'Test card' }).click();
  const done = page.getByTestId('gate-out-done');
  await expect(done).toHaveAttribute('data-level', 'green');
  await expect(done).toContainText('OUT');
  await done.click();
  await expect(page.getByText('Waiting for truck')).toBeVisible();
});

test('not checked, no DO: red with reasons; No card needs a second tap', async ({ page }) => {
  await truckReady(page, 'BJR 9102', { sdoNos: ['5011'] });
  await exitGuard(page);
  await cameraSees(page, 'BJR 9102', 'exit');
  const status = page.getByTestId('exit-status');
  await expect(status).toHaveAttribute('data-level', 'red');
  await expect(status).toContainText('Call supervisor');
  await expect(status).toContainText('No check · No DO');
  await expectGuardLayout(page);
  await page.screenshot(shot('3-red'));

  await page.getByRole('button', { name: 'No card' }).click();
  await expect(page.getByText('No card?')).toBeVisible();
  await expectGuardLayout(page);
  await page.screenshot(shot('4-no-card'));
  await page.getByRole('button', { name: 'Yes, no card' }).click();
  const done = page.getByTestId('gate-out-done');
  await expect(done).toHaveAttribute('data-level', 'red');
  await expect(done).toContainText('No card');
});

test('misread plate: Not inside, guard picks the truck', async ({ page }) => {
  await truckReady(page, 'WRC 6630', { sdoNos: ['5008'], do: true, approve: true });
  await exitGuard(page);
  await cameraSees(page, 'WRC 663O', 'exit');
  await expect(page.getByRole('alert')).toContainText('Not inside');
  await expectGuardLayout(page);
  await page.screenshot(shot('5-unknown'));
  await page.getByRole('button', { name: 'Pick truck' }).click();
  await expectGuardLayout(page);
  await page
    .getByRole('list', { name: 'Trucks inside' })
    .getByRole('button', { name: /WRC 6630/ })
    .click();
  await expect(page.getByTestId('exit-status')).toHaveAttribute('data-level', 'green');
  await page.getByRole('button', { name: 'Test card' }).click();
  await expect(page.getByTestId('gate-out-done')).toContainText('WRC 6630');
});

test('card tapped with no camera read finds the truck and lets it out', async ({ page }) => {
  const t = await truckReady(page, 'VBA 5521', { type: 'inbound', weigh: true });
  await exitGuard(page);
  await page.keyboard.type(t.cardNo, { delay: 5 });
  await page.keyboard.press('Enter');
  const done = page.getByTestId('gate-out-done');
  await expect(done).toContainText('VBA 5521');
  await expect(done).toHaveAttribute('data-level', 'green');
});

test("another truck's card is refused", async ({ page }) => {
  await truckReady(page, 'BHE 4092', { type: 'inbound' });
  const other = await truckReady(page, 'BHE 4093', { type: 'inbound' });
  await exitGuard(page);
  await cameraSees(page, 'BHE 4092', 'exit');
  await expect(page.getByTestId('exit-status')).toHaveAttribute('data-level', 'amber');
  await page.keyboard.type(other.cardNo, { delay: 5 });
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toContainText('Wrong card');
  await expectGuardLayout(page);
  await page.screenshot(shot('6-wrong-card'));
});
