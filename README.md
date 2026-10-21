# Alpine VMS

Visitor and truck management system for Alpine Pipe Manufacturing. Spec: [`docs/SPEC.md`](docs/SPEC.md). Build rules: [`CLAUDE.md`](CLAUDE.md). Open questions and provisional answers: [`docs/decisions.md`](docs/decisions.md).

Phase 1 covers trucks only. CWIS, SAP and LPR are mocked behind adapters.

## Layout

| Path                | What                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `packages/domain`   | Pure business rules (exit status, SDO→DO linking, plate matching, card lifecycle, SDO change, alert catalogue), with unit tests |
| `packages/adapters` | `SapAdapter`, `CwisAdapter`, `LprAdapter`, `Notifier` interfaces and mocks _(next step)_                                        |
| `apps/server`       | Fastify + PostgreSQL server and background jobs _(next steps)_                                                                  |
| `apps/web`          | Guard, clerk and checker screens _(next steps)_                                                                                 |

## Develop

Requires Node 22 and pnpm 10.

```sh
pnpm install
pnpm test        # all unit tests
pnpm typecheck
```
