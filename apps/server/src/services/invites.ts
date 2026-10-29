/**
 * Hosts and invites for visitors and contractors (decisions V1, V2).
 * Office users create invites; the QR code holds only the invite code.
 */
import {
  inviteQrText,
  inviteState,
  newInviteCode,
  normalizePlate,
  parseInviteCode,
  validGroupSize,
  type VisitType,
} from '@vms/domain';
import { and, asc, desc, eq, gte, isNull } from 'drizzle-orm';
import { randomInt } from 'node:crypto';
import { hosts, invites, visits } from '../db/schema.js';
import { addDays, siteDate } from '../time.js';
import { audit, type DbOrTx } from './audit.js';
import type { ServiceDeps } from './deps.js';
import { conflict, notFound, ServiceError } from './errors.js';
import type { Site } from './sites.js';

export type HostRow = typeof hosts.$inferSelect;
export type InviteRow = typeof invites.$inferSelect;

// --- Hosts -------------------------------------------------------------------------

export interface NewHost {
  name: string;
  department: string | null;
  phone: string | null;
}

export async function listHosts(deps: ServiceDeps, site: Site, includeInactive = false) {
  return deps.db
    .select()
    .from(hosts)
    .where(and(eq(hosts.siteId, site.id), includeInactive ? undefined : eq(hosts.active, true)))
    .orderBy(asc(hosts.name));
}

export async function createHost(deps: ServiceDeps, site: Site, userId: string, input: NewHost) {
  const name = input.name.trim();
  if (name.length < 2) throw new ServiceError(400, 'NAME_REQUIRED');
  const now = deps.now();
  return deps.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(hosts)
      .values({
        siteId: site.id,
        name,
        department: input.department?.trim() || null,
        phone: input.phone?.trim() || null,
        createdAt: now,
      })
      .returning();
    await audit(tx, {
      siteId: site.id,
      userId,
      action: 'add_host',
      entity: 'host',
      entityId: row!.id,
      after: row,
      at: now,
    });
    return row!;
  });
}

/** Hosts are never deleted (visits point at them); they are switched off. */
export async function setHostActive(
  deps: ServiceDeps,
  site: Site,
  userId: string,
  hostId: string,
  active: boolean,
) {
  const now = deps.now();
  await deps.db.transaction(async (tx) => {
    const [row] = await tx
      .update(hosts)
      .set({ active })
      .where(and(eq(hosts.siteId, site.id), eq(hosts.id, hostId)))
      .returning();
    if (!row) throw notFound('HOST_NOT_FOUND');
    await audit(tx, {
      siteId: site.id,
      userId,
      action: active ? 'enable_host' : 'disable_host',
      entity: 'host',
      entityId: hostId,
      at: now,
    });
  });
}

// --- Invites -------------------------------------------------------------------------

export interface NewInvite {
  type: VisitType;
  name: string;
  company: string | null;
  phone: string | null;
  groupSize: number;
  hostId: string;
  purpose: string | null;
  validFrom: string;
  validTo: string;
  /** HH:MM, site-local, or null for no end time. */
  untilTime: string | null;
  plate: string | null;
}

/** Longest invite: a contractor job of a few weeks. */
const MAX_INVITE_DAYS = 31;

async function uniqueCode(tx: DbOrTx, siteId: string): Promise<string> {
  // 31^8 codes: a clash is very unlikely, but check rather than trust it.
  for (let i = 0; i < 5; i++) {
    const code = newInviteCode(() => randomInt(0, 1 << 30) / (1 << 30));
    const [hit] = await tx
      .select({ id: invites.id })
      .from(invites)
      .where(and(eq(invites.siteId, siteId), eq(invites.code, code)));
    if (!hit) return code;
  }
  throw new Error('could not make a unique invite code');
}

export async function createInvite(
  deps: ServiceDeps,
  site: Site,
  userId: string,
  input: NewInvite,
) {
  const name = input.name.trim();
  if (name.length < 2) throw new ServiceError(400, 'NAME_REQUIRED');
  if (!validGroupSize(input.groupSize)) throw new ServiceError(400, 'GROUP_SIZE_INVALID');
  if (input.validTo < input.validFrom) throw new ServiceError(400, 'DATES_INVALID');
  if (input.validTo > addDays(input.validFrom, MAX_INVITE_DAYS)) {
    throw new ServiceError(400, 'DATES_TOO_LONG');
  }
  const today = siteDate(deps.now(), site.timezone);
  if (input.validTo < today) throw new ServiceError(400, 'DATES_IN_PAST');
  const plate = input.plate ? normalizePlate(input.plate) || null : null;
  const now = deps.now();

  return deps.db.transaction(async (tx) => {
    const [host] = await tx
      .select()
      .from(hosts)
      .where(and(eq(hosts.siteId, site.id), eq(hosts.id, input.hostId), eq(hosts.active, true)));
    if (!host) throw notFound('HOST_NOT_FOUND');
    const code = await uniqueCode(tx, site.id);
    const [row] = await tx
      .insert(invites)
      .values({
        siteId: site.id,
        code,
        type: input.type,
        name,
        company: input.company?.trim() || null,
        phone: input.phone?.trim() || null,
        groupSize: input.groupSize,
        hostId: host.id,
        purpose: input.purpose?.trim() || null,
        validFrom: input.validFrom,
        validTo: input.validTo,
        untilTime: input.untilTime,
        plate,
        createdBy: userId,
        createdAt: now,
      })
      .returning();
    await audit(tx, {
      siteId: site.id,
      userId,
      action: 'create_invite',
      entity: 'invite',
      entityId: row!.id,
      after: row,
      at: now,
    });
    return inviteView(row!, host, today, []);
  });
}

export async function cancelInvite(deps: ServiceDeps, site: Site, userId: string, id: string) {
  const now = deps.now();
  await deps.db.transaction(async (tx) => {
    const [row] = await tx
      .update(invites)
      .set({ cancelledAt: now, cancelledBy: userId })
      .where(and(eq(invites.siteId, site.id), eq(invites.id, id), isNull(invites.cancelledAt)))
      .returning();
    if (!row) throw conflict('ALREADY_CANCELLED');
    await audit(tx, {
      siteId: site.id,
      userId,
      action: 'cancel_invite',
      entity: 'invite',
      entityId: id,
      at: now,
    });
  });
}

type VisitBrief = Pick<typeof visits.$inferSelect, 'id' | 'visitNo' | 'status' | 'gateInAt'>;

function inviteView(row: InviteRow, host: HostRow | null, today: string, arrivals: VisitBrief[]) {
  const inside = arrivals.find((v) => v.status === 'on_site') ?? null;
  return {
    id: row.id,
    code: row.code,
    qrText: inviteQrText(row.code),
    type: row.type,
    name: row.name,
    company: row.company,
    phone: row.phone,
    groupSize: row.groupSize,
    host: host ? { id: host.id, name: host.name, department: host.department } : null,
    purpose: row.purpose,
    validFrom: row.validFrom,
    validTo: row.validTo,
    untilTime: row.untilTime,
    plate: row.plate,
    createdAt: row.createdAt,
    state: inviteState(row, today),
    /** On site right now under this invite. */
    insideVisitId: inside?.id ?? null,
    lastArrivalAt: arrivals[0]?.gateInAt ?? null,
  };
}

export type InviteView = ReturnType<typeof inviteView>;

async function arrivalsByInvite(db: DbOrTx, siteId: string, inviteIds: string[]) {
  const map = new Map<string, VisitBrief[]>();
  if (inviteIds.length === 0) return map;
  const rows = await db
    .select({
      inviteId: visits.inviteId,
      id: visits.id,
      visitNo: visits.visitNo,
      status: visits.status,
      gateInAt: visits.gateInAt,
    })
    .from(visits)
    .where(eq(visits.siteId, siteId))
    .orderBy(desc(visits.gateInAt));
  for (const r of rows) {
    if (!r.inviteId || !inviteIds.includes(r.inviteId)) continue;
    map.set(r.inviteId, [...(map.get(r.inviteId) ?? []), r]);
  }
  return map;
}

/** Office list: invites still to come or ending in the last week, newest first. */
export async function listInvites(deps: ServiceDeps, site: Site) {
  const today = siteDate(deps.now(), site.timezone);
  const rows = await deps.db
    .select({ i: invites, h: hosts })
    .from(invites)
    .leftJoin(hosts, eq(hosts.id, invites.hostId))
    .where(and(eq(invites.siteId, site.id), gte(invites.validTo, addDays(today, -7))))
    .orderBy(asc(invites.validFrom), asc(invites.name));
  const arrivals = await arrivalsByInvite(
    deps.db,
    site.id,
    rows.map((r) => r.i.id),
  );
  return rows.map((r) => inviteView(r.i, r.h, today, arrivals.get(r.i.id) ?? []));
}

/** Gate: invites expected today and not inside right now. */
export async function expectedToday(deps: ServiceDeps, site: Site) {
  return (await listInvites(deps, site)).filter(
    (i) => i.state === 'expected' && i.insideVisitId === null,
  );
}

/** Gate: a scanned QR or typed code. Any state is returned so the guard sees why. */
export async function findInvite(deps: ServiceDeps, site: Site, text: string) {
  const code = parseInviteCode(text);
  if (!code) throw new ServiceError(400, 'NOT_AN_INVITE');
  const today = siteDate(deps.now(), site.timezone);
  const [row] = await deps.db
    .select({ i: invites, h: hosts })
    .from(invites)
    .leftJoin(hosts, eq(hosts.id, invites.hostId))
    .where(and(eq(invites.siteId, site.id), eq(invites.code, code)));
  if (!row) throw notFound('INVITE_NOT_FOUND');
  const arrivals = await arrivalsByInvite(deps.db, site.id, [row.i.id]);
  return inviteView(row.i, row.h, today, arrivals.get(row.i.id) ?? []);
}
