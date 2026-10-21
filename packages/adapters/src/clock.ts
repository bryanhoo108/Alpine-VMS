/** Injectable clock so mocks and tests can control time. */
export type Clock = () => Date;

export const systemClock: Clock = () => new Date();
