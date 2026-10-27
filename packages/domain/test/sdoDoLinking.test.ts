import { describe, expect, it } from 'vitest';
import {
  assignDos,
  expectedPieces,
  sdosOfDo,
  selectDosForTrip,
  type DeliveryOrder,
  type DoSelectionInput,
} from '../src/sdoDoLinking.js';

const GATE_IN = new Date('2026-10-21T08:00:00+08:00');
const after = (min: number) => new Date(GATE_IN.getTime() + min * 60_000);

/** DO whose lines were copied from the given SDOs, one line per SDO. */
const delivery = (
  doNo: string,
  sdoNos: (string | null)[],
  createdAt = after(30),
): DeliveryOrder => ({
  doNo,
  createdAt,
  lines: sdoNos.map((s, i) => ({ lineNo: i, baseSdoNo: s, baseLineNo: s === null ? null : i })),
});

const select = (o: Partial<DoSelectionInput>) =>
  selectDosForTrip({
    tripId: 'T1',
    gateInAt: GATE_IN,
    sdoNos: [],
    dos: [],
    claims: new Map(),
    ...o,
  });

describe('sdosOfDo', () => {
  it('reads unique base SDOs from the Copy To line references', () => {
    expect(sdosOfDo(delivery('8001', ['5001', '5001', null, '5002']))).toEqual(['5001', '5002']);
  });
});

describe('selectDosForTrip', () => {
  it('links one SDO to one DO', () => {
    const r = select({ sdoNos: ['5001'], dos: [delivery('8001', ['5001'])] });
    expect(r.doNos).toEqual(['8001']);
    expect(r.bySdo).toEqual({ '5001': ['8001'] });
    expect(r.sdosWithoutDo).toEqual([]);
  });

  it('split: one SDO delivered by several DOs', () => {
    const r = select({
      sdoNos: ['5001'],
      dos: [delivery('8001', ['5001']), delivery('8002', ['5001'])],
    });
    expect(r.bySdo).toEqual({ '5001': ['8001', '8002'] });
    expect(r.sdosWithoutDo).toEqual([]);
  });

  it('combined: one DO carrying several SDOs covers each of them', () => {
    const r = select({ sdoNos: ['5003', '5004'], dos: [delivery('8005', ['5003', '5004'])] });
    expect(r.doNos).toEqual(['8005']);
    expect(r.bySdo).toEqual({ '5003': ['8005'], '5004': ['8005'] });
    expect(r.sdosWithoutDo).toEqual([]);
  });

  it('combined DO with an SDO not linked to the trip suggests linking it', () => {
    const r = select({ sdoNos: ['5003'], dos: [delivery('8005', ['5003', '5004'])] });
    expect(r.bySdo).toEqual({ '5003': ['8005'] });
    expect(r.unlinkedSdosOnDos).toEqual(['5004']);
  });

  it('partial: reports SDOs still waiting for a DO', () => {
    const r = select({ sdoNos: ['5001', '5002'], dos: [delivery('8001', ['5001'])] });
    expect(r.sdosWithoutDo).toEqual(['5002']);
  });

  it('no DO yet: every SDO is missing', () => {
    expect(select({ sdoNos: ['5001', '5002'] }).sdosWithoutDo).toEqual(['5001', '5002']);
  });

  it('ignores DOs for SDOs the trip does not carry', () => {
    const r = select({ sdoNos: ['5001'], dos: [delivery('8009', ['5009'])] });
    expect(r.doNos).toEqual([]);
  });

  it('ignores a DO created before this truck gated in (earlier truck on the same SDO)', () => {
    const r = select({ sdoNos: ['5001'], dos: [delivery('8001', ['5001'], after(-120))] });
    expect(r.doNos).toEqual([]);
    expect(r.sdosWithoutDo).toEqual(['5001']);
  });

  it('ignores a DO already claimed by another trip, keeps one claimed by this trip', () => {
    const r = select({
      sdoNos: ['5001'],
      dos: [delivery('8001', ['5001']), delivery('8002', ['5001'])],
      claims: new Map([
        ['8001', 'T2'],
        ['8002', 'T1'],
      ]),
    });
    expect(r.doNos).toEqual(['8002']);
  });

  it('two trucks on one SDO each get their own DO', () => {
    const dos = [delivery('8001', ['5001'], after(10)), delivery('8002', ['5001'], after(50))];
    const first = select({ tripId: 'T1', sdoNos: ['5001'], dos, claims: new Map() });
    expect(first.doNos).toEqual(['8001', '8002']); // unclaimed: both candidates until claimed
    const claims = new Map([['8001', 'T1']]);
    const second = select({ tripId: 'T2', gateInAt: after(5), sdoNos: ['5001'], dos, claims });
    expect(second.doNos).toEqual(['8002']);
  });

  it('clerk manual link wins over the time and claim rules', () => {
    const r = select({
      sdoNos: ['5001'],
      dos: [delivery('8001', ['5001'], after(-120))],
      claims: new Map([['8001', 'T2']]),
      manualLinks: ['8001'],
    });
    expect(r.doNos).toEqual(['8001']);
  });

  it('clerk manual unlink removes a DO the rule would pick', () => {
    const r = select({
      sdoNos: ['5001'],
      dos: [delivery('8001', ['5001'])],
      manualUnlinks: ['8001'],
    });
    expect(r.doNos).toEqual([]);
    expect(r.sdosWithoutDo).toEqual(['5001']);
  });

  it('a DO created exactly at gate in counts', () => {
    expect(select({ sdoNos: ['5001'], dos: [delivery('8001', ['5001'], GATE_IN)] }).doNos).toEqual([
      '8001',
    ]);
  });
});

describe('assignDos', () => {
  const trip = (tripId: string, sdoNos: string[], gateInMin = 0, manualUnlinks: string[] = []) => ({
    tripId,
    gateInAt: after(gateInMin),
    sdoNos,
    manualUnlinks,
  });

  it('links a DO to the one truck carrying its SDO', () => {
    const r = assignDos(
      [trip('T1', ['5001']), trip('T2', ['5002'])],
      [delivery('8001', ['5001'])],
      new Map(),
    );
    expect(r).toEqual({ assign: [{ doNo: '8001', tripId: 'T1' }], ambiguous: [] });
  });

  it('split: both DOs of one SDO go to the one truck', () => {
    const r = assignDos(
      [trip('T1', ['5001'])],
      [delivery('8001', ['5001']), delivery('8002', ['5001'])],
      new Map(),
    );
    expect(r.assign.map((a) => a.doNo)).toEqual(['8001', '8002']);
  });

  it('combined: a DO for two SDOs on one truck links once', () => {
    const r = assignDos(
      [trip('T1', ['5003', '5004'])],
      [delivery('8005', ['5003', '5004'])],
      new Map(),
    );
    expect(r.assign).toEqual([{ doNo: '8005', tripId: 'T1' }]);
  });

  it('two trucks on the same SDO: the DO is left for the clerk', () => {
    const r = assignDos(
      [trip('T1', ['5001']), trip('T2', ['5001'], 5)],
      [delivery('8001', ['5001'])],
      new Map(),
    );
    expect(r).toEqual({ assign: [], ambiguous: [{ doNo: '8001', tripIds: ['T1', 'T2'] }] });
  });

  it('a DO older than the second truck belongs to the first', () => {
    const r = assignDos(
      [trip('T1', ['5001']), trip('T2', ['5001'], 60)],
      [delivery('8001', ['5001'], after(30))],
      new Map(),
    );
    expect(r.assign).toEqual([{ doNo: '8001', tripId: 'T1' }]);
  });

  it('skips claimed DOs and DOs the clerk unlinked from the truck', () => {
    const r = assignDos(
      [trip('T1', ['5001'], 0, ['8002'])],
      [delivery('8001', ['5001']), delivery('8002', ['5001'])],
      new Map([['8001', 'T9']]),
    );
    expect(r).toEqual({ assign: [], ambiguous: [] });
  });

  it('ignores DOs created before every truck came in', () => {
    const r = assignDos(
      [trip('T1', ['5001'])],
      [delivery('8001', ['5001'], after(-60))],
      new Map(),
    );
    expect(r).toEqual({ assign: [], ambiguous: [] });
  });
});

describe('expectedPieces', () => {
  const doWith = (doNo: string, lines: [string, number, number][]) => ({
    doNo,
    createdAt: after(10),
    lines: lines.map(([sdo, line, pieces], i) => ({
      lineNo: i,
      baseSdoNo: sdo,
      baseLineNo: line,
      pieces,
    })),
  });

  it('uses the SDO when the truck has no DO for it', () => {
    expect(expectedPieces('5001', 0, 400, [])).toEqual({ pieces: 400, from: 'sdo' });
  });

  it('uses the DO pieces on a split delivery', () => {
    expect(expectedPieces('5001', 0, 400, [doWith('8001', [['5001', 0, 200]])])).toEqual({
      pieces: 200,
      from: 'do',
    });
  });

  it('adds up two DOs on the same truck', () => {
    const dos = [doWith('8001', [['5001', 0, 150]]), doWith('8002', [['5001', 0, 50]])];
    expect(expectedPieces('5001', 0, 400, dos)).toEqual({ pieces: 200, from: 'do' });
  });

  it('a line the DO left out is expected as 0 on this truck', () => {
    expect(expectedPieces('5001', 1, 600, [doWith('8001', [['5001', 0, 200]])])).toEqual({
      pieces: 0,
      from: 'do',
    });
  });

  it('a combined DO covers each SDO separately', () => {
    const dos = [
      doWith('8005', [
        ['5003', 0, 80],
        ['5004', 0, 40],
      ]),
    ];
    expect(expectedPieces('5004', 0, 40, dos)).toEqual({ pieces: 40, from: 'do' });
    expect(expectedPieces('5009', 0, 24, dos)).toEqual({ pieces: 24, from: 'sdo' });
  });
});
