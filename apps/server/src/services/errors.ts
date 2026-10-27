/** A refusal the screen can show (e.g. 409 NOT_ON_SITE). Routes turn it into JSON. */
export class ServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

export const notFound = (what = 'NOT_FOUND') => new ServiceError(404, what);
export const conflict = (code: string) => new ServiceError(409, code);
