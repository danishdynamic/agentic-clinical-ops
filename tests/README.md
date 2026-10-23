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

- Authentication and reviewer authorization.
- Reviewer identity comes from the verified principal, not the body.
- Invalid approval payloads and malformed run IDs.
- Missing idempotency keys.
- Recording an approval and completing the workflow.
- Exact replay of the same approval request.
- Conflicting approval decisions.
- Concurrent submissions for the same run.
- Rejection persistence and audit events.
- Recovery after a persisted approval's graph resume fails.

### `intake-routes.test.ts`

**Purpose:** Verify intake validation and failure handling.

Coverage includes:

- Authentication is required before creating an intake run.
- Missing and empty patient IDs and unsupported scenarios return HTTP 400.
- Invalid requests do not create runs or invoke the graph.
- Simulated triage graph failure.
- HTTP error response when graph execution fails.
- Agent-run status updated to `failed`.
- Redis state updated to `failed`.
- Failure audit event persisted.

The graph failure is mocked so this test does not need a real Gemini request.

### `triage-graph.test.ts`

**Purpose:** Verify graph level behavior independently of the HTTP routes.

Current coverage includes:

- Propagation of a simulated draft generation failure.
- MCP client cleanup after successful FHIR context loading and tool failure.

Keep graph tests focused on workflow behavior and avoid unnecessary external network dependencies.

## Repository Audit Checklist

Use **PASS** only when backed by a test or a command run against this checkout.
Use **FAIL** for a verified gap or failing check. Use **NOT VERIFIED** when the
behavior cannot be established from the available implementation or evidence.
Passing unit/integration tests do not by themselves establish production
readiness.

| Checklist item | Status | Evidence / limitation |
|---|---|---|
| Intake validation and failure handling | **PASS** | `intake-routes.test.ts` checks missing/empty `patientId`, invalid `scenarioId`, HTTP 400, and no run/graph invocation; it also checks graph failure state and audit event. |
| Approval and rejection paths | **PASS** | `approval-routes.test.ts` checks approval and rejection persistence, run state, and audit events. |
| Idempotency and duplicate approval protection | **PASS** | `approval-routes.test.ts` and `approvals-enforcement.integration.test.ts` cover replay, conflicts, concurrency, and one decision per run. Database row locking and an existing decision check provide protection when the unique migration is absent. |
| Recovery when workflow resume fails | **PASS** | `approval-routes.test.ts` verifies a persisted approval can be retried after graph failure without duplicating its approval or approval audit event. The run is marked failed before retry. |
| FHIR/openEHR writes gated behind validation and human approval | **NOT VERIFIED** | No FHIR/openEHR write operation or executor currently exists. The rejection tests verify no further tool calls after rejection, not safety of a future write implementation. |
| MCP clients closed reliably | **PASS** | `triage-graph.test.ts` checks client cleanup after successful context loading and tool call failure. Timeouts and failures during client shutdown are not separately tested. |
| API authentication and reviewer authorization | **PASS** | `reviewer-auth.test.ts` verifies JWT signature, issuer, and audience; route tests verify unauthenticated and non-reviewer calls are denied and identity is taken from the authenticated principal. |
| Environment variable validation and secrets excluded from Git | **PASS** | `env-validation.test.ts` checks required configuration; `.env` is ignored and not tracked, and `.env.example` contains placeholders. |
| Database migrations | **NOT VERIFIED** | `pnpm db:check` confirms migration file consistency. `pnpm db:migrate` was not run because it mutates the configured database; the applied migration state was not verified. |
| Full test suite | **PASS** | `pnpm test` completed with 19 test files and 73 tests passing. |

### Related gaps and limits

- `resume-triage.test.ts` tests missing approval records and prevents a second resume after completion.
- `agent-run-lifecycle.test.ts` checks invalid transitions and protects a completed run from being overwritten.
- Recovery from a failed graph resume is tested; process crash recovery and resuming-state timeout/reconciliation are **NOT VERIFIED**.
- `triage-graph.test.ts` checks the synthetic rejection route does not make additional FHIR tool calls. FHIR/openEHR validation and write-audit behavior remain **NOT VERIFIED** because write operations are not implemented.
- Migration consistency is checked with `pnpm db:check`. Do not run `pnpm db:migrate` until `DATABASE_URL` is confirmed to point to the intended development/test database.

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

The test suite is ready for the initial project milestone when all tests pass, critical approval and failure recovery paths are covered, external dependencies are controlled, and the test environment can be reproduced from the project documentation.
