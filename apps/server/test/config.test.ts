import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { addDays, siteDate } from '../src/time.js';

describe('loadConfig', () => {
  it('requires DATABASE_URL', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it('applies defaults', () => {
    expect(loadConfig({ DATABASE_URL: 'postgres://x' })).toMatchObject({
      port: 8080,
      siteCode: 'APM',
      icPhotoRetentionDays: 90,
    });
  });

  it('rejects a bad number', () => {
    expect(() => loadConfig({ DATABASE_URL: 'x', IC_PHOTO_RETENTION_DAYS: 'ninety' })).toThrow(
      /IC_PHOTO_RETENTION_DAYS/,
    );
  });
});

describe('site time', () => {
  it('uses the site time zone for the calendar date', () => {
    // 20:00 UTC on the 20th is 04:00 on the 21st in Shah Alam.
    expect(siteDate(new Date('2026-10-20T20:00:00Z'), 'Asia/Kuala_Lumpur')).toBe('2026-10-21');
  });

  it('adds days across month ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});
