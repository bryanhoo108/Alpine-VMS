# Alpine VMS

Visitor and truck management system for Alpine Pipe Manufacturing. Spec: [`docs/SPEC.md`](docs/SPEC.md). Build rules: [`CLAUDE.md`](CLAUDE.md). Decisions and open questions: [`docs/decisions.md`](docs/decisions.md).

Phase 1 covers trucks only. CWIS, SAP and LPR are mocked behind adapters.

## Layout

| Path                | What                                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/domain`   | Pure business rules: exit status, SDO→DO linking, pre-registration matching, plate matching, card lifecycle, SDO change, gate-in alerts and the alert catalogue          |
| `packages/adapters` | `SapAdapter`, `CwisAdapter`, `LprAdapter`, `Notifier` interfaces, mocks with sample data, and contract tests. `createAdapters` is the only place that picks mock or real |
| `apps/server`       | Fastify server, PostgreSQL schema and migrations (Drizzle), seed data                                                                                                    |
| `apps/web`          | Guard, clerk and checker screens _(next steps)_                                                                                                                          |

## Develop

Requires Node 22, pnpm 10 and PostgreSQL 16 (local install, or `docker compose up -d`).

```sh
pnpm install
cp .env.example .env      # then set DATABASE_URL, SEED_DEMO_PIN, SEED_DEMO_PASSWORD
pnpm db:seed              # migrates, then adds the site, demo users, 60 cards, sample data
pnpm dev                  # http://localhost:8080/api/health
pnpm test                 # unit, contract and database tests
pnpm typecheck
```

Database tests create and drop their own throwaway databases on the server in `TEST_DATABASE_URL`.

### Demo users (after seeding)

| Username                    | Role              | Signs in with        |
| --------------------------- | ----------------- | -------------------- |
| `guard.entry`, `guard.exit` | Guard             | `SEED_DEMO_PIN`      |
| `checker1`, `checker2`      | Checker           | `SEED_DEMO_PIN`      |
| `clerk`                     | Clerk             | `SEED_DEMO_PASSWORD` |
| `supervisor`, `admin`       | Supervisor, admin | `SEED_DEMO_PASSWORD` |

### Sample data

- **SAP mock:** 15 SDOs (5001–5015; 5014 closed). SDO 5001 was split into DOs 8001 and 8002; SDOs 5002 and 5003 were combined into DO 8003. Those DOs are dated yesterday, so they do not count for trucks that gate in today.
- **Pre-registrations:** WXY 1234 (SDO 5005, due today), BPN 2045 (SDOs 5009 + 5010, due today), BMK 7710 (SDO 5007, late).
- **Watchlist:** BQL 1187 (sample red alert).

## Database changes

Edit `apps/server/src/db/schema.ts`, then run `pnpm --filter @vms/server db:generate` to write a new SQL migration in `apps/server/src/db/migrations`. The server applies pending migrations on start.
