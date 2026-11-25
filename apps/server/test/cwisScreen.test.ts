import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sampleCardNo } from '../src/db/seed.js';
import { createTestApp, gateInTruck, type TestApp } from './helpers/testApp.js';

// The simulated CWIS screen (mock only): what CWIS got from the VMS, and the
// operator scanning the gate pass to weigh in and out.
let h: TestApp;
let guard: string;
let sup: string;

beforeAll(async () => {
  h = await createTestApp();
  guard = await h.login('guard.entry');
  sup = await h.login('supervisor');
});
afterAll(async () => h?.close());

const inject = (method: 'GET' | 'POST', url: string, cookie: string, payload?: object) =>
  h.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

describe('simulated CWIS screen', () => {
  it('shows the truck the gate sent, then the pass scan weighs it in and out', async () => {
    const cardNo = sampleCardNo(9);
    const { trip } = await gateInTruck(h, guard, { plate: 'VCW 2201', cardNo });

    const state = (await inject('GET', '/api/dev/cwis/state', sup)).json();
    const pending = state.pending.find((p: { tripNo: string }) => p.tripNo === trip.tripNo);
    expect(pending).toMatchObject({ plate: 'VCW2201', cardNo });
    expect(pending.receivedAt).toBeTruthy();

    // The QR text works as well as the plain number.
    const weighIn = await inject('POST', '/api/dev/cwis/scan', sup, {
      cardNo: `APMVMS-PASS:${cardNo}`,
    });
    expect(weighIn.statusCode, weighIn.body).toBe(200);
    expect(weighIn.json()).toMatchObject({ action: 'in', ticket: { vmsTripNo: trip.tripNo } });

    const after = (await inject('GET', '/api/dev/cwis/state', sup)).json();
    expect(after.pending.some((p: { tripNo: string }) => p.tripNo === trip.tripNo)).toBe(false);
    expect(after.tickets[0]).toMatchObject({ vmsTripNo: trip.tripNo, outKg: null });
    expect(after.tickets[0].inKg).toBeGreaterThan(9000);

    // The VMS picked up the ticket straight away.
    const detail = (await inject('GET', `/api/clerk/trips/${trip.id}`, sup)).json();
    expect(detail.ticket?.ticketNo ?? detail.tickets?.[0]?.ticketNo).toBe(
      weighIn.json().ticket.ticketNo,
    );

    const weighOut = (await inject('POST', '/api/dev/cwis/scan', sup, { cardNo })).json();
    expect(weighOut.action).toBe('out');
    expect(weighOut.ticket.weighOutAt).toBeTruthy();
  });

  it('a pass not on a truck is refused', async () => {
    const res = await inject('POST', '/api/dev/cwis/scan', sup, { cardNo: sampleCardNo(40) });
    expect(res.statusCode).toBe(404);
    expect(res.json().code ?? res.json().error).toContain('CARD_NOT_ON_TRIP');
  });
});
