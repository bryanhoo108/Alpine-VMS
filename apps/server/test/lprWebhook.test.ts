import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/testApp.js';

let h: TestApp;
beforeAll(async () => {
  h = await createTestApp(undefined, { LPR_WEBHOOK_TOKEN: 'camera-token' });
});
afterAll(async () => h?.close());

describe('POST /api/lpr/:camera', () => {
  it('needs the camera token when one is configured', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/lpr/entry',
      payload: { plate: 'WXY1234' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('records a camera push as a plate read for the entry screen', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/lpr/entry',
      headers: { 'x-vms-token': 'camera-token' },
      payload: { plate: 'WVT 3388', confidence: 0.8 },
    });
    expect(res.statusCode).toBe(200);
    const cookie = await h.login('guard.entry');
    const state = (await h.app.inject({ url: '/api/gate/entry', headers: { cookie } })).json();
    expect(state.read).toMatchObject({ plate: 'WVT3388', confidence: 0.8 });
  });

  it('rejects a body the adapter cannot parse', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/lpr/exit',
      headers: { 'x-vms-token': 'camera-token' },
      payload: { nope: 1 },
    });
    expect(res.statusCode).toBe(400);
  });
});
