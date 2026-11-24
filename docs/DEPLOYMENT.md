# Deployment

> **Not yet run.** No Docker engine was available while this was written. The compose files parse as YAML, but no image has been built and no container started. Do a trial run before relying on it.

## Start

```bash
cp .env.production.example .env     # set every value marked REQUIRED
docker compose up -d --build        # http://localhost:8080
```

| Service | Notes |
|---|---|
| `web` | nginx: serves the app and proxies `/api`, with event streams unbuffered. The only published port. |
| `api` | Runs as a non-root user and applies migrations on start. One instance only (see Limits). |
| `postgres` | System of record. |
| `neo4j` | Projection of PostgreSQL; can be rebuilt at any time. |

Redis is not used. For local development, run only the databases, published on loopback:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres neo4j
```

Put TLS in front of `web`. nginx overwrites `X-Forwarded-For` with the connecting address, because the login limiter keys on it. If you add another proxy in front, configure nginx `real_ip` for that proxy, or every user will share one address.

Health checks: `/api/v1/health` (process), `/api/v1/health/postgres`, `/api/v1/health/neo4j`.

## Backup and recovery

```bash
docker compose exec -T postgres pg_dump -U astrion -Fc astrion > astrion.dump
docker run --rm -v astrion_storage:/s -v "$PWD":/b alpine tar czf /b/storage.tgz -C /s .
```

Restore PostgreSQL with `pg_restore --clean` and unpack the storage volume, then rebuild the graph:

```bash
docker compose exec api python -m app.graph.resync    # non-zero exit if any workspace is inconsistent
```

The graph rebuild is covered by a test against a real Neo4j. The `pg_dump`/`pg_restore` and volume commands have not been run.

Never keep a database in a temporary directory: this project's development cluster was found damaged, with files missing, after being kept in one.

## Security notes

- Secrets come only from `.env`, which is git-ignored. In production the API refuses to start without a JWT secret of at least 32 characters and secure cookies, and refuses the fixture provider.
- Every resource is owner-scoped; other users get 404. Failed logins are rate-limited, each user has a limit on active runs, and each run has hard call, token and cost limits.
- Dependency audit, November 2026: `pip-audit` found no known vulnerabilities. `npm audit` has two moderate advisories left in React Router 6, fixed only in v7. One affects server rendering, which is not used. The other needs an untrusted redirect path; the only one the app accepts (`?next=`) must start with `/app` and may not contain backslashes or control characters.

## Limits

Investigations run inside the API process and the login limiter is in memory, so run exactly one API instance.
