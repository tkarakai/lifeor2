/** Explicit public query errors; unexpected exceptions remain redacted. */
export class QueryError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
