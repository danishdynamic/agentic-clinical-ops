# Local Infrastructure

This guide describes the development services defined in
[`docker-compose.yml`](./docker-compose.yml). These containers are for local
development and synthetic testing, not production or real clinical data.

## Services

| Service | Image | Host port | Purpose |
|---|---|---:|---|
| `postgres` | `postgres:16` | `5434` | Application database (`agentic_ops`) |
| `redis` | `redis:7` | `6379` | Application run-state cache |
| `fhir` | `hapiproject/hapi:v7.6.0` | `8080` | Local HAPI FHIR server |
| `ehrbase` | `ehrbase/ehrbase:2.36.0` | `8081` | Local openEHR service |
| `ehrdb` | `ehrbase/ehrbase-v2-postgres:16.2` | `5433` | Database used by EHRbase |
| `keycloak` | `quay.io/keycloak/keycloak:24.0.3` | `8082` | Development identity-provider service |

The Compose project defines named volumes for the application PostgreSQL
database and Redis data. EHRbase and Keycloak share the `ehrbase-net` network.
EHRbase waits for its database health check before starting.

## Start and inspect services

Run these commands from the repository root:

```bash
docker compose -f infrastructure/docker-compose.yml config
docker compose -f infrastructure/docker-compose.yml up -d
docker compose -f infrastructure/docker-compose.yml ps
docker compose -f infrastructure/docker-compose.yml logs -f postgres redis fhir ehrbase ehrdb keycloak
```

Stop the containers while preserving named volumes:

```bash
docker compose -f infrastructure/docker-compose.yml down
```

To also delete the persisted application PostgreSQL and Redis volumes, use
`down -v`. This deletes local data and is not required for routine shutdown.

## Application connection settings

The Compose file publishes the application services on the following host
ports:

```dotenv
DATABASE_URL=postgresql://agentic:agentic_password@localhost:5434/agentic_ops
REDIS_URL=redis://localhost:6379
FHIR_BASE_URL=http://localhost:8080/fhir
EHRBASE_BASE_URL=http://localhost:8081/ehrbase/rest/openehr/v1
```

Use these values only with the local Compose environment. The application API
is not started by this Compose file; start it separately with `pnpm dev` after
configuring the remaining variables from the root `.env.example`.

The `AUTH_ISSUER`, `AUTH_AUDIENCE`, and `AUTH_JWKS_URL` values must match a
configured identity provider and token issuer. Although Keycloak is included,
this Compose file does not provision a realm, client, users, roles, or signing
configuration. Configure those separately before using authenticated API
routes.

## Development-only security notes

- The Compose file contains fixed development passwords and the Keycloak
  development admin password. Do not reuse them outside a disposable local
  environment.
- Ports are published on the host. Restrict access to the local machine or a
  trusted development network.
- The Keycloak container runs `start-dev`; it is not a production deployment.
- Do not load real patient information or connect these services to a live
  clinical system.
- Review the Compose configuration and `DATABASE_URL` before running
  `pnpm db:migrate`, because migrations alter the selected database.
