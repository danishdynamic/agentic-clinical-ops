# Remaining Development Roadmap

## Project Status

The project is a backend-only agentic clinical operations system using TypeScript, LangGraph, Gemini, PostgreSQL, Redis, MCP, FHIR, and openEHR.

The core safety principle is:

**LLM recommendation → structured proposal → validation → human approval → controlled tool execution → persistence**

An LLM must never directly perform clinical-record writes without the required validation and approval controls.

## Phase 1: Core Workflow Reliability

**Status: Partially completed**

- [x] Intake request validation.
- [x] Agent-run creation and lifecycle status management.
- [x] LangGraph triage workflow with a human-approval interruption.
- [x] Approval and rejection decisions.
- [x] Database transaction for approval records and audit events.
- [x] Idempotency-key validation and replay handling.
- [x] Database constraint preventing multiple approval decisions per run.
- [x] Failure handling when the triage graph throws during intake.
- [x] Redis run-state update on intake failure.
- [ ] Test all workflow state transitions and invalid transitions.
- [ ] Verify that failures during approval/resume do not leave runs stuck in `resuming`.
- [ ] Define recovery behavior when approval is persisted but workflow resumption fails.
- [ ] Ensure terminal states cannot be overwritten by late or duplicate requests.

## Phase 2: Test Coverage

**Status: In progress**

- [x] Approval-route validation tests.
- [x] Successful approval and workflow completion test.
- [x] Approval replay test.
- [x] Conflicting approval decision test.
- [x] Concurrent approval submission test.
- [x] Triage graph draft-generation failure test.
- [x] Intake graph-failure test.
- [ ] Test intake request validation and malformed payloads.
- [ ] Test intake failure persistence, including the failure audit event and Redis state.
- [ ] Test rejection through the complete workflow.
- [ ] Test missing approval records and invalid graph checkpoints.
- [ ] Test failures at each important workflow boundary.
- [ ] Test MCP errors and cleanup of MCP connections.
- [ ] Run the full test suite against a clean test database.
- [ ] Ensure tests use synthetic clinical scenarios only.

## Phase 3: Approval and Failure Recovery

**Status: Remaining**

- [ ] Define a consistent policy for retrying failed workflow executions.
- [ ] Handle failure after an approval decision is recorded but before resumption completes.
- [ ] Ensure retries do not create duplicate approvals or audit events.
- [ ] Make database and Redis state updates consistent, or document how inconsistencies are repaired.
- [ ] Add structured error responses for expected API failures.
- [ ] Add recovery tests for interrupted and partially completed workflows.

## Phase 4: Clinical Safety and Interoperability

**Status: Remaining verification**

- [ ] Validate structured clinical proposals before approval.
- [ ] Verify that rejected proposals never trigger clinical-record writes.
- [ ] Verify that approved proposals can execute only the intended permitted actions.
- [ ] Validate FHIR resources against the intended resource profiles and required fields.
- [ ] Verify openEHR composition structure and template compatibility.
- [ ] Handle external-system timeouts, validation errors, and duplicate requests safely.
- [ ] Record relevant tool executions and outcomes in the audit trail.
- [ ] Use synthetic patient data for development and tests.

## Phase 5: Security and Operational Readiness

**Status: Remaining**

- [ ] Add authentication for protected API endpoints.
- [ ] Implement reviewer authorization on the server; a client-supplied `reviewerId` alone is not proof of identity.
- [ ] Restrict access to patient-related information and run details.
- [ ] Validate environment variables at application startup.
- [ ] Confirm secrets are excluded from version control.
- [ ] Add request IDs and structured logging.
- [ ] Apply appropriate request size limits, timeouts, and rate limits.
- [ ] Document audit retention and access policies.
- [ ] Review error responses and logs for accidental disclosure of sensitive information.

## Phase 6: Documentation and Final Verification

**Status: Remaining**

- [ ] Document local setup and required services.
- [ ] Document environment variables using `.env.example`.
- [ ] Document database migrations and test database setup.
- [ ] Document API endpoints and example requests.
- [ ] Document the architecture and workflow state transitions.
- [ ] Document the synthetic demo scenarios.
- [ ] Run type checking and the complete test suite.
- [ ] Verify a clean local startup and end-to-end workflow.
- [ ] Document known limitations and future improvements.

## Definition of Done

The project is ready for its initial backend demonstration when:

1. Intake creates a valid agent run.
2. The workflow generates a structured proposal and pauses for human approval.
3. An authorized reviewer can approve or reject the proposal.
4. Rejected proposals cannot execute clinical-record writes.
5. Approved proposals execute only validated and permitted operations.
6. Database records, workflow checkpoints, Redis state, and audit events are handled consistently.
7. Duplicate and concurrent requests cannot bypass approval controls.
8. Failures produce recoverable, observable states.
9. Automated tests pass, and the setup is reproducible using documented instructions.

This roadmap describes the initial project milestone. Production clinical use would require additional security, privacy, clinical validation, and operational review.
