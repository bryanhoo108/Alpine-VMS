import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../src/events.js';
import { startJobs, type JobDef } from '../src/jobs.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const log = { warn: vi.fn() };

describe('job runner', () => {
  it('runs each job at start and on its interval', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const runner = startJobs([{ name: 'a', everyMs: 1000, run }], new EventBus(), log);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(run).toHaveBeenCalledTimes(4);
    runner.stop();
  });

  it('never runs a job twice at the same time', async () => {
    let release!: () => void;
    const run = vi.fn(() => new Promise<void>((r) => (release = r)));
    const runner = startJobs([{ name: 'slow', everyMs: 100, run }], new EventBus(), log);
    await vi.advanceTimersByTimeAsync(500);
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(100);
    expect(run).toHaveBeenCalledTimes(2);
    runner.stop();
  });

  it('logs a failure and tries again next time', async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error('SAP down')).mockResolvedValue(undefined);
    const runner = startJobs([{ name: 'sap', everyMs: 1000, run }], new EventBus(), log);
    await vi.advanceTimersByTimeAsync(0);
    expect(log.warn).toHaveBeenCalledWith({ job: 'sap', err: 'SAP down' }, expect.any(String));
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(2);
    runner.stop();
  });

  it('pushes to CWIS about a second after trip edits, once for a burst', async () => {
    const push = vi.fn().mockResolvedValue(undefined);
    const jobs: JobDef[] = [{ name: 'cwis-push', everyMs: 60_000, run: push }];
    const events = new EventBus();
    const runner = startJobs(jobs, events, log);
    push.mockClear();
    events.publish({ type: 'trip_changed', tripId: 'a' });
    events.publish({ type: 'trip_changed', tripId: 'b' });
    await vi.advanceTimersByTimeAsync(999);
    expect(push).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(push).toHaveBeenCalledTimes(1);
    runner.stop();
  });
});
