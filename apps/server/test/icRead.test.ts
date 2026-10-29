import { readFile } from 'node:fs/promises';
import { readMyKad } from '@vms/domain';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLog, persons, photos, trips, visits } from '../src/db/schema.js';
import { sampleCardNo } from '../src/db/seed.js';
import { decryptIc, encryptIc } from '../src/icCrypto.js';
import { TesseractIcReader } from '../src/ocr.js';
import { purgeExpiredIcNumbers } from '../src/services/retention.js';
import { createTestApp, type TestApp } from './helpers/testApp.js';

const KEY = 'test-ic-encryption-key-at-least-32-chars';
// Fictional sample card, as Tesseract reads it.
const CARD_TEXT = `KAD PENGENALAN MALAYSIA
IDENTITY CARD
900101-14-5678
SAMPLE DRIVER
BIN DEMO
12 JALAN CONTOH 3
40000 SHAH ALAM`;

let h: TestApp;
let guard: string;
let card = 0;
const nextCard = () => sampleCardNo(++card);

beforeAll(async () => {
  h = await createTestApp();
  guard = await h.login('guard.entry');
});
afterAll(async () => h?.close());

const post = (url: string, payload?: object) =>
  h.app.inject({
    method: 'POST',
    url,
    headers: { cookie: guard },
    ...(payload ? { payload } : {}),
  });

const upload = async (kind = 'ic') =>
  (
    await h.app.inject({
      method: 'POST',
      url: `/api/photos?kind=${kind}`,
      headers: { cookie: guard, 'content-type': 'image/jpeg' },
      payload: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    })
  ).json().id as string;

describe('IC encryption', () => {
  it('round-trips, and each encryption looks different', () => {
    const a = encryptIc('900101145678', KEY);
    expect(a).not.toContain('900101');
    expect(encryptIc('900101145678', KEY)).not.toBe(a);
    expect(decryptIc(a, KEY)).toBe('900101145678');
  });

  it('refuses the wrong key', () => {
    expect(() =>
      decryptIc(encryptIc('900101145678', KEY), 'another-key-of-32-characters-long!!'),
    ).toThrow();
  });
});

describe('reading the IC photo at the gate', () => {
  it('returns only the masked number and the name; keeps the full number encrypted', async () => {
    h.icText.value = CARD_TEXT;
    const id = await upload();
    const res = await post(`/api/photos/${id}/read-ic`);
    expect(res.json()).toEqual({
      found: true,
      masked: '••••••-••-5678',
      last4: '5678',
      name: 'SAMPLE DRIVER BIN DEMO',
    });
    expect(res.body).not.toContain('900101');
    const [p] = await h.t.db.select().from(photos).where(eq(photos.id, id));
    expect(decryptIc(p!.icEncrypted!, KEY)).toBe('900101145678');
  });

  it('says not found when there is no IC number on the photo', async () => {
    h.icText.value = 'blurry';
    const res = await post(`/api/photos/${await upload()}/read-ic`);
    expect(res.json()).toEqual({ found: false, masked: null, last4: null, name: null });
  });

  it('only reads IC photos', async () => {
    const res = await post(`/api/photos/${await upload('document')}/read-ic`);
    expect(res.json().error).toBe('NOT_AN_IC_PHOTO');
  });

  it('truck gate in: the read becomes the driver; audit has only the last 4', async () => {
    h.icText.value = CARD_TEXT;
    const id = await upload();
    await post(`/api/photos/${id}/read-ic`);
    const res = await post('/api/gate/in', {
      plateReadId: null,
      plate: 'WIC 1001',
      type: 'outbound',
      cardNo: nextCard(),
      photoIds: [id],
      transporterId: null,
      preRegistrationId: null,
    });
    const tripId = res.json().trip.id;
    const [t] = await h.t.db.select().from(trips).where(eq(trips.id, tripId));
    const [driver] = await h.t.db.select().from(persons).where(eq(persons.id, t!.driverId!));
    expect(driver).toMatchObject({ name: 'SAMPLE DRIVER BIN DEMO', icLast4: '5678' });
    expect(decryptIc(driver!.icEncrypted!, KEY)).toBe('900101145678');
    const logs = await h.t.db.select().from(auditLog).where(eq(auditLog.entityId, tripId));
    expect(JSON.stringify(logs)).not.toContain('900101');
    expect(JSON.stringify(logs)).toContain('5678');

    // The clerk sees the driver, masked.
    const clerk = await h.login('clerk');
    const detail = await h.app.inject({
      url: `/api/clerk/trips/${tripId}`,
      headers: { cookie: clerk },
    });
    expect(detail.json().driver).toEqual({ name: 'SAMPLE DRIVER BIN DEMO', icLast4: '5678' });
    expect(detail.body).not.toContain('900101');
  });

  it('the guard tapped "Wrong": no driver is recorded from the read', async () => {
    h.icText.value = CARD_TEXT;
    const id = await upload();
    await post(`/api/photos/${id}/read-ic`);
    const res = await post('/api/gate/in', {
      plateReadId: null,
      plate: 'WIC 1002',
      type: 'outbound',
      cardNo: nextCard(),
      photoIds: [id],
      transporterId: null,
      preRegistrationId: null,
      icRejected: true,
    });
    const [t] = await h.t.db.select().from(trips).where(eq(trips.id, res.json().trip.id));
    expect(t!.driverId).toBeNull();
  });

  it('visitor gate in keeps the masked IC, the name on the IC and the encrypted number', async () => {
    h.icText.value = CARD_TEXT;
    const id = await upload();
    await post(`/api/photos/${id}/read-ic`);
    const res = await post('/api/gate/visit-in', {
      inviteId: null,
      type: 'visitor',
      name: 'Sample Driver',
      company: null,
      phone: null,
      hostId: null,
      groupSize: 1,
      hostConfirmed: true,
      plate: null,
      plateReadId: null,
      cardNo: nextCard(),
      photoIds: [id],
    });
    const [v] = await h.t.db.select().from(visits).where(eq(visits.id, res.json().visit.id));
    expect(v).toMatchObject({ icLast4: '5678', icName: 'SAMPLE DRIVER BIN DEMO' });
    expect(decryptIc(v!.icEncrypted!, KEY)).toBe('900101145678');
  });

  it('full numbers are cleared after the retention period; the last 4 digits stay', async () => {
    const later = new Date(h.clock.now.getTime() + 91 * 86_400_000);
    expect(await purgeExpiredIcNumbers(h.t.db, h.site.id, later, 90)).toBeGreaterThanOrEqual(2);
    const rows = await h.t.db.select().from(persons);
    expect(rows.every((r) => r.icEncrypted === null)).toBe(true);
    expect(rows.some((r) => r.icLast4 === '5678')).toBe(true);
  });
});

describe('Tesseract on this server (offline, bundled model)', () => {
  it('reads a fictional sample card', async () => {
    const reader = new TesseractIcReader();
    try {
      const text = await reader.text(
        await readFile(new URL('./fixtures/sample-ic.jpg', import.meta.url)),
      );
      expect(readMyKad(text)).toEqual({ icNumber: '900101145678', name: 'SAMPLE DRIVER BIN DEMO' });
    } finally {
      await reader.close();
    }
  }, 60_000);
});
