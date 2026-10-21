/** Wait before retry n of an outbox write: 10 s doubling, at most 10 minutes. */
export const retryDelayMs = (attempts: number) => Math.min(10_000 * 2 ** (attempts - 1), 600_000);
