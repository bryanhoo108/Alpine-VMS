import { describe, expect, it } from 'vitest';
import {
  headcount,
  inviteQrText,
  inviteState,
  musterProgress,
  newInviteCode,
  OVERSTAY_GRACE_MINUTES,
  parseInviteCode,
  validGroupSize,
  visitExitStatus,
  visitGateInAlerts,
  type OnSiteGroup,
} from '../src/visits.js';

describe('invite state', () => {
  const invite = { validFrom: '2026-11-02', validTo: '2026-11-04', cancelledAt: null };

  it('is expected on every day of its range, including the first and last', () => {
    expect(inviteState(invite, '2026-11-02')).toBe('expected');
    expect(inviteState(invite, '2026-11-03')).toBe('expected');
    expect(inviteState(invite, '2026-11-04')).toBe('expected');
  });

  it('is not yet before, and expired after', () => {
    expect(inviteState(invite, '2026-11-01')).toBe('not_yet');
    expect(inviteState(invite, '2026-11-05')).toBe('expired');
  });

  it('cancelled wins over dates', () => {
    expect(inviteState({ ...invite, cancelledAt: new Date() }, '2026-11-03')).toBe('cancelled');
  });
});

describe('invite code', () => {
  it('makes 8-character codes without look-alike characters', () => {
    let seed = 0;
    const random = () => (seed = (seed + 0.137) % 1);
    for (let i = 0; i < 50; i++) {
      const code = newInviteCode(random);
      expect(code).toMatch(/^[2-9A-HJKMNP-Z]{8}$/);
    }
  });

  it('reads the code back from the QR text', () => {
    expect(parseInviteCode(inviteQrText('AB3DEF7H'))).toBe('AB3DEF7H');
  });

  it('reads a code typed or read out with spaces, dashes or lower case', () => {
    expect(parseInviteCode(' ab3d-ef7h ')).toBe('AB3DEF7H');
    expect(parseInviteCode('AB3D EF7H')).toBe('AB3DEF7H');
  });

  it('refuses other QR codes and codes with look-alike characters', () => {
    expect(parseInviteCode('https://example.com/menu')).toBeNull();
    expect(parseInviteCode('AB3DEF7')).toBeNull();
    expect(parseInviteCode('AB3DEFO1')).toBeNull();
  });
});

describe('visit gate in', () => {
  it('raises nothing for an invited visitor arriving on foot', () => {
    expect(visitGateInAlerts({ hostConfirmed: true, plateOnWatchlist: false })).toEqual([]);
  });

  it('amber when the host could not be reached, red when the car is watchlisted', () => {
    const alerts = visitGateInAlerts({ hostConfirmed: false, plateOnWatchlist: true });
    expect(alerts.map((a) => [a.type, a.level])).toEqual([
      ['WATCHLIST_HIT', 'red'],
      ['HOST_NOT_CONFIRMED', 'amber'],
    ]);
  });

  it('accepts groups of 1 to 60 whole people', () => {
    expect(validGroupSize(1)).toBe(true);
    expect(validGroupSize(5)).toBe(true);
    expect(validGroupSize(60)).toBe(true);
    expect(validGroupSize(0)).toBe(false);
    expect(validGroupSize(61)).toBe(false);
    expect(validGroupSize(2.5)).toBe(false);
  });
});

describe('visit exit status', () => {
  const until = new Date('2026-11-02T09:00:00Z');
  const after = (min: number) => new Date(until.getTime() + min * 60_000);

  it('green when the card is back and they leave on time', () => {
    expect(visitExitStatus({ cardReturned: true, expectedUntil: until, at: after(-60) })).toEqual({
      level: 'green',
      reasons: [],
    });
  });

  it('allows a grace period before calling it late', () => {
    const at = after(OVERSTAY_GRACE_MINUTES);
    expect(visitExitStatus({ cardReturned: true, expectedUntil: until, at }).level).toBe('green');
  });

  it('amber when they stay past the invite end time plus grace', () => {
    const s = visitExitStatus({
      cardReturned: true,
      expectedUntil: until,
      at: after(OVERSTAY_GRACE_MINUTES + 1),
    });
    expect(s.level).toBe('amber');
    expect(s.reasons.map((r) => r.type)).toEqual(['VISIT_OVERSTAY']);
  });

  it('walk-ins have no end time, so they are never late', () => {
    expect(visitExitStatus({ cardReturned: true, expectedUntil: null, at: after(600) }).level).toBe(
      'green',
    );
  });

  it('red when the card is not returned, worst reason first', () => {
    const s = visitExitStatus({ cardReturned: false, expectedUntil: until, at: after(120) });
    expect(s.level).toBe('red');
    expect(s.reasons.map((r) => r.type)).toEqual(['CARD_NOT_RETURNED', 'VISIT_OVERSTAY']);
  });
});

describe('headcount and muster', () => {
  const onSite: OnSiteGroup[] = [
    { id: 'T1', kind: 'truck', people: 1 },
    { id: 'T2', kind: 'truck', people: 1 },
    { id: 'V1', kind: 'visitor', people: 3 },
    { id: 'C1', kind: 'contractor', people: 5 },
  ];

  it('counts one driver per truck and the stated group size for visits', () => {
    expect(headcount(onSite)).toEqual({ total: 10, truckDrivers: 2, visitors: 3, contractors: 5 });
    expect(headcount([])).toEqual({ total: 0, truckDrivers: 0, visitors: 0, contractors: 0 });
  });

  it('tracks who is safe and lists missing groups biggest first', () => {
    const p = musterProgress(onSite, new Set(['T1', 'V1']));
    expect(p).toMatchObject({ people: 10, safePeople: 4, groups: 4, safeGroups: 2 });
    expect(p.missing.map((g) => g.id)).toEqual(['C1', 'T2']);
  });

  it('ignores ticks for people not on the roll', () => {
    const p = musterProgress(onSite, new Set(['someone-who-came-later']));
    expect(p.safePeople).toBe(0);
    expect(p.missing).toHaveLength(4);
  });
});
