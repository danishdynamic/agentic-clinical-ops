export class ApprovalAlreadyRecordedError extends Error {
  constructor(runId: string) {
    super(`An approval decision already exists for run ${runId}`);
    this.name = "ApprovalAlreadyRecordedError";
  }
}

export class IdempotencyConflictError extends Error {
  constructor() {
    super("Idempotency key was already used for a different request");
    this.name = "IdempotencyConflictError";
  }
}