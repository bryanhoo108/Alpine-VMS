/**
 * What guards, the clerk, the weighbridge, SAP and checkers do, as calls to the
 * same services the screens use. Used to build the demo day and by auto-play.
 * Mock adapters only.
 */
import { plateImageSvg, type MockCwisAdapter, type MockSapAdapter } from '@vms/adapters';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { AppContext } from '../app.js';
import { cards, hosts, transporters, trips, users, visits, weighTickets } from '../db/schema.js';
import { checkView, decide } from '../services/checker.js';
import { linkSdos } from '../services/clerk.js';
import { pollCwisTickets, sendCwisPushes } from '../services/cwis.js';
import { discoverDos, sendSapWrites } from '../services/dos.js';
import { gateIn } from '../services/gateIn.js';
import { gateOut } from '../services/gateOut.js';
import { createInvite } from '../services/invites.js';
import { recordPlateRead } from '../services/plateReads.js';
import { visitGateIn, visitGateOut } from '../services/visits.js';
import { siteDate } from '../time.js';

export interface DemoContext extends AppContext {
  mocks: { sap: MockSapAdapter; cwis: MockCwisAdapter };
}

export interface DemoUsers {
  guardIn: string;
  guardOut: string;
  clerk: string;
  checker1: string;
  checker2: string;
}

/** The demo users from the seed, or null when this is not a demo database. */
export async function demoUsers(c: AppContext): Promise<DemoUsers | null> {
  const names = ['guard.entry', 'guard.exit', 'clerk', 'checker1', 'checker2'];
  const rows = await c.db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(and(eq(users.siteId, c.site.id), inArray(users.username, names)));
  const id = (n: string) => rows.find((r) => r.username === n)?.id;
  const [guardIn, guardOut, clerk, checker1, checker2] = names.map(id);
  if (!guardIn || !guardOut || !clerk || !checker1 || !checker2) return null;
  return { guardIn, guardOut, clerk, checker1, checker2 };
}

async function freeCard(c: AppContext): Promise<string> {
  const [card] = await c.db
    .select({ cardNo: cards.cardNo })
    .from(cards)
    .where(and(eq(cards.siteId, c.site.id), eq(cards.status, 'free')))
    .orderBy(asc(cards.cardNo))
    .limit(1);
  if (!card) throw new Error('no free card');
  return card.cardNo;
}

async function tripRow(c: AppContext, tripId: string) {
  const [row] = await c.db
    .select({ plate: trips.plateIn, cardNo: cards.cardNo })
    .from(trips)
    .leftJoin(cards, eq(cards.id, trips.cardId))
    .where(eq(trips.id, tripId));
  if (!row) throw new Error(`trip ${tripId} not found`);
  return row;
}

const read = (c: AppContext, camera: 'entry' | 'exit', plate: string) =>
  recordPlateRead(
    c,
    c.site.id,
    {
      camera,
      plateText: plate,
      confidence: 0.96,
      photo: { contentType: 'image/svg+xml', data: plateImageSvg(plate) },
      readAt: c.now(),
    },
    // Not announced: auto-play must not pop up on the presenter's gate screen.
    { announce: false },
  );

/** Truck arrives: camera read, guard taps Collect/Deliver, card issued. */
export async function arrive(
  c: DemoContext,
  u: DemoUsers,
  plate: string,
  o: { type: 'outbound' | 'inbound'; transporterCode?: string },
): Promise<string> {
  const r = await read(c, 'entry', plate);
  const [t] = o.transporterCode
    ? await c.db
        .select({ id: transporters.id })
        .from(transporters)
        .where(
          and(eq(transporters.siteId, c.site.id), eq(transporters.sapBpCode, o.transporterCode)),
        )
    : [];
  const res = await gateIn(c, c.site, u.guardIn, {
    plateReadId: r.id,
    plate,
    type: o.type,
    cardNo: await freeCard(c),
    photoIds: [],
    transporterId: t?.id ?? null,
    preRegistrationId: null,
  });
  if (!res.ok) throw new Error(`gate in ${plate}: ${res.error}`);
  return res.trip.id;
}

export const match = (c: DemoContext, u: DemoUsers, tripId: string, sdoNos: string[]) =>
  linkSdos(c, c.site, u.clerk, tripId, sdoNos);

/** Weighbridge: operator taps the card (option A); optionally a different plate or typed SDOs. */
export async function weighIn(
  c: DemoContext,
  tripId: string,
  o: { plate?: string; sdoNos?: string[] } = {},
) {
  const t = await tripRow(c, tripId);
  await sendCwisPushes(c, c.site);
  c.mocks.cwis.weighIn({
    plate: o.plate ?? t.plate,
    ...(t.cardNo ? { cardNo: t.cardNo } : {}),
    ...(o.sdoNos ? { sdoNos: o.sdoNos } : {}),
  });
  await pollCwisTickets(c, c.site);
}

export async function weighOut(c: DemoContext, tripId: string) {
  const [ticket] = await c.db
    .select({ ticketNo: weighTickets.ticketNo })
    .from(weighTickets)
    .where(eq(weighTickets.tripId, tripId));
  if (!ticket) throw new Error('not weighed in');
  c.mocks.cwis.weighOut(ticket.ticketNo);
  await pollCwisTickets(c, c.site);
}

/** Logistics does "Copy To" in SAP (half=true: a part delivery), then DOs are looked up. */
export async function makeDo(c: DemoContext, sdoNos: string[], half = false) {
  const sources = await Promise.all(
    sdoNos.map(async (sdoNo) => {
      if (!half) return sdoNo;
      const sdo = await c.mocks.sap.getSdo(sdoNo);
      return {
        sdoNo,
        lines: (sdo?.lines ?? []).map((l) => ({
          lineNo: l.lineNo,
          pieces: Math.max(1, Math.floor(l.pieces / 2)),
        })),
      };
    }),
  );
  const d = c.mocks.sap.createDo(sources);
  await discoverDos(c, c.site);
  return d.doNo;
}

/** Checker opens the truck and approves (every line as expected) or rejects. */
export async function check(
  c: DemoContext,
  checkerId: string,
  tripId: string,
  decision: 'approve' | 'reject',
  reason: 'wrong_item' | 'wrong_quantity' | 'damaged' | 'other' | null = null,
) {
  const v = await checkView(c, c.site, tripId);
  await decide(c, c.site, checkerId, tripId, {
    decision,
    reason,
    versions: Object.fromEntries(v.sdos.map((s) => [s.sdoNo, s.version ?? ''])),
    lines: v.sdos.flatMap((s) =>
      s.lines.map((l) => ({ sdoNo: s.sdoNo, lineNo: l.lineNo, actualPieces: l.expected })),
    ),
    photoIds: [],
  });
}

/** Exit camera read, then the card is handed back (or not). */
export async function leave(c: DemoContext, u: DemoUsers, tripId: string, cardReturned = true) {
  const t = await tripRow(c, tripId);
  const r = await read(c, 'exit', t.plate);
  await gateOut(c, c.site, u.guardOut, {
    tripId,
    plateReadId: r.id,
    cardNo: cardReturned ? t.cardNo : null,
  });
}

/** Let CWIS and SAP catch up (what the background jobs do). */
export async function flush(c: DemoContext) {
  await sendCwisPushes(c, c.site);
  await sendSapWrites(c, c.site);
}

/** Site-local HH:MM of a moment, for invite end times. */
function localTime(c: AppContext, at: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: c.site.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(at);
}

/** End time that many minutes from now, kept within today (an invite is per day). */
function untilToday(c: AppContext, now: Date, minutes: number): string {
  const until = new Date(now.getTime() + minutes * 60_000);
  const sameDay = siteDate(until, c.site.timezone) === siteDate(now, c.site.timezone);
  return sameDay ? localTime(c, until) : '23:59';
}

async function hostId(c: AppContext, name: string): Promise<string> {
  const [h] = await c.db
    .select({ id: hosts.id })
    .from(hosts)
    .where(and(eq(hosts.siteId, c.site.id), eq(hosts.name, name)));
  if (!h) throw new Error(`host ${name} not found`);
  return h.id;
}

/**
 * A visitor or contractor group comes in. With `untilMinutes` they were
 * invited (end time that many minutes from now); otherwise a walk-in whose
 * host did or did not answer the guard's call.
 */
export async function visitorArrives(
  c: DemoContext,
  u: DemoUsers,
  o: {
    name: string;
    type: 'visitor' | 'contractor';
    company: string;
    groupSize: number;
    host: string;
    untilMinutes?: number;
    hostAnswered?: boolean;
  },
): Promise<string> {
  const now = c.now();
  const invite =
    o.untilMinutes === undefined
      ? null
      : await createInvite(c, c.site, u.clerk, {
          type: o.type,
          name: o.name,
          company: o.company,
          phone: null,
          groupSize: o.groupSize,
          hostId: await hostId(c, o.host),
          purpose: null,
          validFrom: siteDate(now, c.site.timezone),
          validTo: siteDate(now, c.site.timezone),
          untilTime: untilToday(c, now, o.untilMinutes),
          plate: null,
        });
  const res = await visitGateIn(c, c.site, u.guardIn, {
    inviteId: invite?.id ?? null,
    type: o.type,
    name: o.name,
    company: o.company,
    phone: null,
    hostId: invite ? null : await hostId(c, o.host),
    groupSize: o.groupSize,
    hostConfirmed: o.hostAnswered ?? true,
    plate: null,
    plateReadId: null,
    cardNo: await freeCard(c),
    photoIds: [],
  });
  if (!res.ok) throw new Error(`visit in ${o.name}: ${res.error}`);
  return res.visit.id;
}

export async function visitorLeaves(c: DemoContext, u: DemoUsers, visitId: string) {
  const [v] = await c.db
    .select({ cardNo: cards.cardNo })
    .from(visits)
    .leftJoin(cards, eq(cards.id, visits.cardId))
    .where(eq(visits.id, visitId));
  await visitGateOut(c, c.site, u.guardOut, {
    visitId,
    cardNo: v?.cardNo ?? null,
    plateReadId: null,
  });
}
