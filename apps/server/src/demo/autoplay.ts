/**
 * Auto-play for demos: every few seconds one truck takes its next step —
 * arrives, is matched, weighed, gets a DO, is checked, weighs out and leaves —
 * so the screens move by themselves while the presenter talks.
 *
 * Auto-play only touches its own trucks (plates starting with "JQ"), never the
 * demo day's trucks or the ones the presenter brings in.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { sdoCache, trips, tripSdos } from '../db/schema.js';
import { tripsOnSite } from '../services/clerk.js';
import { stageOf } from '../services/overview.js';
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
} from './actions.js';

export const AUTOPLAY_PREFIX = 'JQ';
/** SDOs kept for the presenter's pre-registered trucks. */
const RESERVED_SDOS = ['5005', '5007', '5009', '5010'];
const MAX_TRUCKS = 6;
/** Fast-forward choices on the Live screen: 1× is one step every 20 s. */
export const AUTOPLAY_SPEEDS = [1, 4, 10] as const;
export type AutoPlaySpeed = (typeof AUTOPLAY_SPEEDS)[number];
const COMPANIES = ['T0001', 'T0002', 'T0003', 'T0004'];

export class AutoPlay {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private plateNo = 100 + Math.floor(Math.random() * 800);
  private _speed: AutoPlaySpeed = 1;

  constructor(
    private readonly c: DemoContext,
    private readonly everyMs = 20_000,
    private readonly random: () => number = Math.random,
    private readonly log: (msg: string) => void = () => {},
  ) {}

  get running() {
    return this.timer !== null;
  }

  get speed() {
    return this._speed;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.everyMs / this._speed);
    void this.tick();
  }

  /** Change how fast trucks move; takes effect at once if playing. */
  setSpeed(speed: AutoPlaySpeed) {
    this._speed = speed;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = setInterval(() => void this.tick(), this.everyMs / speed);
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.step();
    } catch (err) {
      this.log(`auto-play step failed: ${(err as Error).message}`);
    } finally {
      this.busy = false;
    }
  }

  private pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.random() * list.length)]!;
  }

  /** One move. Returns what happened, for logs and tests. */
  async step(): Promise<string> {
    const c = this.c;
    const u = await demoUsers(c);
    if (!u) return 'no demo users';
    const mine = (await tripsOnSite(c, c.site)).filter((t) => t.plate.startsWith(AUTOPLAY_PREFIX));

    if (mine.length === 0 || (mine.length < MAX_TRUCKS && this.random() < 0.35)) {
      return this.newTruck(u);
    }

    const t = this.pick(mine);
    const stage = stageOf(t);
    let did: string;
    switch (stage) {
      case 'Not matched': {
        const sdo = await this.freeSdo();
        if (!sdo) return 'no free SDO';
        await match(c, u, t.id, [sdo]);
        did = `matched ${t.plate} to SDO ${sdo}`;
        break;
      }
      case 'Waiting weigh-in':
        await weighIn(c, t.id);
        did = `weighed in ${t.plate}`;
        break;
      case 'Waiting check':
      case 'Rejected': {
        const ok = stage === 'Rejected' || this.random() > 0.1;
        await check(
          c,
          this.pick([u.checker1, u.checker2]),
          t.id,
          ok ? 'approve' : 'reject',
          ok ? null : 'wrong_quantity',
        );
        did = `${ok ? 'approved' : 'rejected'} ${t.plate}`;
        break;
      }
      case 'Waiting DO':
        await makeDo(c, t.sdoNos, this.random() < 0.3);
        did = `DO made for ${t.plate}`;
        break;
      case 'Waiting weigh-out':
        await weighOut(c, t.id);
        did = `weighed out ${t.plate}`;
        break;
      case 'Ready to go':
        await leave(c, u, t.id, this.random() > 0.05);
        did = `${t.plate} left`;
        break;
    }
    await flush(c);
    return did;
  }

  private async newTruck(u: NonNullable<Awaited<ReturnType<typeof demoUsers>>>) {
    const plate = `${AUTOPLAY_PREFIX}${this.pick(['A', 'B', 'C', 'D'])} ${this.plateNo++}`;
    const inbound = this.random() < 0.25;
    const tripId = await arrive(this.c, u, plate, {
      type: inbound ? 'inbound' : 'outbound',
      transporterCode: this.pick(COMPANIES),
    });
    // Most pipe trucks are pre-advised, so the SDO is known right away.
    if (!inbound && this.random() < 0.8) {
      const sdo = await this.freeSdo();
      if (sdo) await match(this.c, u, tripId, [sdo]);
    }
    await flush(this.c);
    return `${plate} arrived`;
  }

  /** An open SDO no truck inside is carrying (and not kept for the presenter). */
  private async freeSdo(): Promise<string | null> {
    const c = this.c;
    const open = await c.db
      .select({ sdoNo: sdoCache.sdoNo })
      .from(sdoCache)
      .where(and(eq(sdoCache.siteId, c.site.id), eq(sdoCache.status, 'open')));
    const inside = await c.db
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.siteId, c.site.id), eq(trips.status, 'on_site')));
    const taken = inside.length
      ? (
          await c.db
            .select({ sdoNo: tripSdos.sdoNo })
            .from(tripSdos)
            .where(
              inArray(
                tripSdos.tripId,
                inside.map((t) => t.id),
              ),
            )
        ).map((s) => s.sdoNo)
      : [];
    const free = open
      .map((s) => s.sdoNo)
      .filter((s) => !taken.includes(s) && !RESERVED_SDOS.includes(s));
    return free.length ? this.pick(free) : null;
  }
}
