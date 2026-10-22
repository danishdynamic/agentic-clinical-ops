# Test Suite Guide

## Purpose

This directory contains automated tests for the `agentic-clinical-ops` backend.

The tests verify API behavior, workflow transitions, persistence, approval safeguards, and failure handling.

Use synthetic patient identifiers and demo scenarios only. Tests must not depend on real patient data.

## Running Tests

Run the complete test suite:

```bash
pnpm test
```

Run TypeScript checks:

```bash
pnpm typecheck
```

Run a single test file:

```bash
pnpm exec vitest run tests/approval-routes.test.ts
```

```bash
pnpm exec vitest run tests/intake-routes.test.ts
```

```bash
pnpm exec vitest run tests/triage-graph.test.ts
```

The integration tests require the configured test dependencies, including PostgreSQL and Redis where applicable. Follow the project's environment configuration before running them.

## Current Test Files

### `approval-routes.test.ts`

**Purpose:** Verify the approval API and its interaction with the workflow and database.

Coverage includes:

- Invalid approval payloads and malformed run IDs.
- Missing idempotency keys.
- Recording an approval and completing the workflow.
- Exact replay of the same approval request.
- Conflicting approval decisions.
- Concurrent submissions for the same run.

### `intake-routes.test.ts`

**Purpose:** Verify intake failure handling.

Coverage includes:

- Simulated triage graph failure.
- HTTP error response when graph execution fails.
- Agent-run status updated to `failed`.
- Redis state updated to `failed`.
- Failure audit event persisted.

The graph failure is mocked so this test does not need a real Gemini request.

### `triage-graph.test.ts`

**Purpose:** Verify graph-level behavior independently of the HTTP routes.

Current coverage includes:

- Propagation of a simulated draft-generation failure.

Keep graph tests focused on workflow behavior and avoid unnecessary external network dependencies.

## Remaining Test Plan

### Intake API

- [ ] Reject malformed request bodies.
- [ ] Reject unsupported scenario IDs.
- [ ] Verify a successful intake pauses at human approval.
- [x] Verify graph failures return an error.
- [x] Verify graph failures mark the run as failed.
- [x] Verify Redis receives the failed state.
- [x] Verify a failure audit event is recorded.

### Approval API

- [x] Validate request payloads and run IDs.
- [x] Require an idempotency key.
- [x] Record an approval and complete the workflow.
- [x] Support exact replay without resuming twice.
- [x] Reject conflicting decisions.
- [x] Prevent two concurrent decisions from being accepted for the same run.
- [ ] Test the full rejection path and confirm no clinical write occurs.
- [ ] Test retry behavior after approval persistence succeeds but workflow resumption fails.

### Workflow and Lifecycle

- [x] Propagate draft-generation failures.
- [ ] Test missing approval records.
- [ ] Test invalid graph checkpoints.
- [ ] Verify failures do not leave runs stuck in `resuming`.
- [ ] Verify invalid state transitions are rejected.
- [ ] Verify completed and failed states cannot be overwritten incorrectly.
- [ ] Test recovery after interrupted workflow execution.

### MCP and Clinical Integrations

- [ ] Test MCP tool errors and timeouts.
- [ ] Verify MCP clients are closed on success and failure.
- [ ] Verify unapproved proposals cannot trigger writes.
- [ ] Verify approved proposals are validated before execution.
- [ ] Test FHIR and openEHR validation failures.
- [ ] Verify tool outcomes are represented accurately in audit records.

## Test Design Rules

1. Use synthetic patient data only.
2. Mock Gemini and external network calls in tests that do not require integration verification.
3. Use real PostgreSQL and Redis for integration tests that specifically verify persistence.
4. Isolate test records and clean up dependent tables in foreign-key-safe order.
5. Close Fastify instances and other acquired resources in `finally` blocks when appropriate.
6. Do not rely on test execution order.
7. Test both successful and unsuccessful paths.
8. Assert persisted outcomes, not only HTTP status codes.
9. Never weaken clinical approval safeguards to make a test pass.

## Completion Criteria

The test suite is ready for the initial project milestone when all tests pass, critical approval and failure-recovery paths are covered, external dependencies are controlled, and the test environment can be reproduced from the project documentation.
