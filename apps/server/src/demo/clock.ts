/**
 * The server's clock. Normally the real time; while the demo day is being
 * built it is set back step by step, so the sample trucks arrive and leave
 * over the past few hours instead of all at the same second.
 */
export const demoClock = {
  override: null as Date | null,
  now(): Date {
    return demoClock.override ?? new Date();
  },
};
