/**
 * The demo day: about six trucks that already left and nine still inside,
 * each showing a different situation, spread over the past few hours. Built
 * through the real services (see actions.ts), so every screen, timeline and
 * alert is genuine. Rebuilt from scratch on each start when DEMO_DAY=on.
 *
 * Kept free for the presenter's own live demo: the pre-registered trucks
 * WXY 1234 (SDO 5005), BPN 2045 (5009, 5010) and BMK 7710 (5007, late).
 */
import { sql } from 'drizzle-orm';
import { seedSampleData } from '../db/seed.js';
import { refreshSdoCache } from '../services/sdoCache.js';
import {
  arrive,
  check,
  demoUsers,
  flush,
  leave,
  makeDo,
  match,
  weighIn,
  weighOut,
  type DemoContext,
  type DemoUsers,
} from './actions.js';
import { demoClock } from './clock.js';

/** Tables holding the day's activity. Users, transporters and the watchlist stay. */
const DAY_TABLES = [
  'trips',
  'plate_reads',
  'photos',
  'trip_sdos',
  'trip_dos',
  'weigh_tickets',
  'checker_decisions',
  'alerts',
  'audit_log',
  'sap_writes',
  'cwis_pushes',
  'pre_registrations',
  'do_cache',
  'do_lines',
  'sdo_cache',
  'sdo_lines',
  'cards',
  'vehicles',
  'persons',
];

interface Step {
  /** Minutes before now. */
  ago: number;
  run: () => Promise<unknown>;
}

function story(c: DemoContext, u: DemoUsers): Step[] {
  const ids = new Map<string, string>();
  const id = (plate: string) => {
    const t = ids.get(plate);
    if (!t) throw new Error(`${plate} has not arrived`);
    return t;
  };
  const inn = (
    ago: number,
    plate: string,
    type: 'outbound' | 'inbound',
    transporterCode: string,
  ): Step => ({
    ago,
    run: async () => ids.set(plate, await arrive(c, u, plate, { type, transporterCode })),
  });
  const at = (ago: number, run: () => Promise<unknown>): Step => ({ ago, run });

  return [
    // --- Left already ------------------------------------------------------------
    // 1. Everything right: green.
    inn(330, 'BKA 4321', 'outbound', 'T0001'),
    at(325, () => match(c, u, id('BKA 4321'), ['5006'])),
    at(315, () => weighIn(c, id('BKA 4321'))),
    at(290, () => makeDo(c, ['5006'])),
    at(285, () => check(c, u.checker1, id('BKA 4321'), 'approve')),
    at(270, () => weighOut(c, id('BKA 4321'))),
    at(265, () => leave(c, u, id('BKA 4321'))),
    // 2. Coil delivered, weighed in and out: green.
    inn(300, 'VBA 5521', 'inbound', 'T0002'),
    at(295, () => weighIn(c, id('VBA 5521'))),
    at(250, () => weighOut(c, id('VBA 5521'))),
    at(245, () => leave(c, u, id('VBA 5521'))),
    // 3. Split delivery: part DO, checker counts against the DO: green.
    inn(280, 'WVT 3388', 'outbound', 'T0003'),
    at(276, () => match(c, u, id('WVT 3388'), ['5012'])),
    at(268, () => weighIn(c, id('WVT 3388'))),
    at(232, () => makeDo(c, ['5012'], true)),
    at(230, () => check(c, u.checker2, id('WVT 3388'), 'approve')),
    at(222, () => weighOut(c, id('WVT 3388'))),
    at(218, () => leave(c, u, id('WVT 3388'))),
    // 4. Coil truck left without weighing out: amber.
    inn(240, 'BHE 4092', 'inbound', 'T0004'),
    at(236, () => weighIn(c, id('BHE 4092'))),
    at(200, () => leave(c, u, id('BHE 4092'))),
    // 5. Checked and weighed but no DO from SAP yet: amber "No DO".
    inn(210, 'BJR 9102', 'outbound', 'T0001'),
    at(206, () => match(c, u, id('BJR 9102'), ['5013'])),
    at(200, () => weighIn(c, id('BJR 9102'))),
    at(170, () => check(c, u.checker1, id('BJR 9102'), 'approve')),
    at(160, () => weighOut(c, id('BJR 9102'))),
    at(155, () => leave(c, u, id('BJR 9102'))),
    // 6. Left without check, without DO and without returning the card: red.
    inn(190, 'WRC 6630', 'outbound', 'T0002'),
    at(186, () => match(c, u, id('WRC 6630'), ['5002'])),
    at(180, () => weighIn(c, id('WRC 6630'))),
    at(150, () => leave(c, u, id('WRC 6630'), false)),

    // --- Still inside --------------------------------------------------------------
    // 7. Waiting for the checker; logistics amended its SDO meanwhile.
    inn(140, 'BQA 7701', 'outbound', 'T0003'),
    at(136, () => match(c, u, id('BQA 7701'), ['5004'])),
    at(130, () => weighIn(c, id('BQA 7701'))),
    at(100, async () => c.mocks.sap.amendSdoLine('5004', 0, { pieces: 30 })),
    // 8. Ready to go: weighed, DO, approved. Green at the exit.
    inn(125, 'BMK 7711', 'outbound', 'T0004'),
    at(121, () => match(c, u, id('BMK 7711'), ['5008'])),
    at(115, () => weighIn(c, id('BMK 7711'))),
    at(95, () => makeDo(c, ['5008'])),
    at(90, () => check(c, u.checker2, id('BMK 7711'), 'approve')),
    at(80, () => weighOut(c, id('BMK 7711'))),
    // 9. Coil truck waiting for weigh-out.
    inn(110, 'VBA 5530', 'inbound', 'T0002'),
    at(105, () => weighIn(c, id('VBA 5530'))),
    // 10. Walk-in nobody matched; the weighbridge typed SDO 5011 (clerk's shortlist shows it first).
    inn(95, 'WRC 6650', 'outbound', 'T0001'),
    at(88, () => weighIn(c, id('WRC 6650'), { sdoNos: ['5011'] })),
    // 11. Weighbridge recorded a different plate: amber.
    inn(80, 'BKA 7788', 'outbound', 'T0003'),
    at(76, () => match(c, u, id('BKA 7788'), ['5015'])),
    at(70, () => weighIn(c, id('BKA 7788'), { plate: 'BKA 7789' })),
    // 12. Checker rejected the load (damaged): back to loading.
    inn(70, 'BPN 3301', 'outbound', 'T0004'),
    at(66, () => match(c, u, id('BPN 3301'), ['5003'])),
    at(60, () => weighIn(c, id('BPN 3301'))),
    at(45, () => check(c, u.checker1, id('BPN 3301'), 'reject', 'damaged')),
    // 13-14. Two trucks on the same SDO: the new DO fits both, so the clerk picks.
    inn(60, 'BJR 4410', 'outbound', 'T0001'),
    at(56, () => match(c, u, id('BJR 4410'), ['5001'])),
    inn(50, 'BJR 4411', 'outbound', 'T0002'),
    at(46, () => match(c, u, id('BJR 4411'), ['5001'])),
    at(30, () => makeDo(c, ['5001'])),
    // 15. Watchlisted plate came in: red alert open.
    inn(20, 'BQL 1187', 'outbound', 'T0004'),
  ];
}

/** Clear the day's activity and put back fresh sample data (users stay). */
export async function resetDay(c: DemoContext) {
  await c.db.execute(sql.raw(`truncate ${DAY_TABLES.map((t) => `"${t}"`).join(', ')} cascade`));
  c.mocks.sap.reset();
  c.mocks.cwis.reset();
  await seedSampleData(c.db, c.adapters.sap, c.site.id, c.now());
  await refreshSdoCache(c, c.site, { full: true });
}

/**
 * Reset and build the demo day. Background jobs are paused meanwhile so they
 * do not act on the half-built day with the real clock.
 * Returns false when the demo users are missing (not a demo database).
 */
export async function buildDemoDay(
  c: DemoContext,
  log: (msg: string) => void = () => {},
): Promise<boolean> {
  const u = await demoUsers(c);
  if (!u) {
    log('demo day skipped: demo users not found (seed with SEED_DEMO_PIN and SEED_DEMO_PASSWORD)');
    return false;
  }
  await c.jobRunner?.pause();
  const base = Date.now();
  try {
    await resetDay(c);
    const steps = story(c, u).sort((a, b) => b.ago - a.ago);
    for (const step of steps) {
      demoClock.override = new Date(base - step.ago * 60_000);
      await step.run();
      await flush(c);
    }
  } finally {
    demoClock.override = null;
    c.jobRunner?.resume();
  }
  c.events.publish({ type: 'trip_changed', tripId: 'demo-day' });
  log('demo day built');
  return true;
}
