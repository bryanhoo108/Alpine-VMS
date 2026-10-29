# Alpine VMS

Visitor and truck management system for Alpine Pipe Manufacturing. Spec: [`docs/SPEC.md`](docs/SPEC.md). Build rules: [`CLAUDE.md`](CLAUDE.md). Decisions and open questions: [`docs/decisions.md`](docs/decisions.md).

Phase 1 covers trucks only. CWIS, SAP and LPR are mocked behind adapters.

**Install on site:** [`docs/INSTALL.md`](docs/INSTALL.md) (Docker or native, Linux or Windows Server, HTTPS for tablets, users and cards, backups).

## Try it in one command (Docker)

```sh
cp .env.example .env     # set SEED_DEMO_PIN (4-8 digits) and SEED_DEMO_PASSWORD (10+ characters)
docker compose up --build
```

Open http://localhost:8080. Sample data and mock SAP / CWIS / cameras are loaded; see "Trying ..." below. Add `DEMO_DAY=on` to `.env` for a busy day already under way (see "Showing a demo").

## Layout

| Path                | What                                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/domain`   | Pure business rules: exit status, SDO→DO linking, pre-registration matching, plate matching, card lifecycle, SDO change, gate-in alerts and the alert catalogue          |
| `packages/adapters` | `SapAdapter`, `CwisAdapter`, `LprAdapter`, `Notifier` interfaces, mocks with sample data, and contract tests. `createAdapters` is the only place that picks mock or real |
| `apps/server`       | Fastify server, PostgreSQL schema and migrations (Drizzle), seed data                                                                                                    |
| `apps/web`          | Guard, clerk, checker and Live overview screens                                                                                                                          |

## Demo link on Render

For showing the system to people without installing anything. Sample data and mock SAP / CWIS / cameras only; the real system runs on Alpine's own server.

1. Sign up at [render.com](https://render.com) with your GitHub account and allow it to see this repository.
2. In the Render dashboard: **New → Blueprint**, pick **Alpine-VMS**. Render reads `render.yaml`.
3. When asked, enter **SEED_DEMO_PIN** (4–8 digits, for guards and checkers) and **SEED_DEMO_PASSWORD** (10+ characters, for clerk and supervisor). Click **Apply**.
4. Wait for the first build (about 5–10 minutes), then open the `…onrender.com` link Render shows.

Free plan: the app sleeps after 15 minutes without visitors, so open the link a minute before a demo. On waking, the busy sample day is built again from scratch (`DEMO_DAY=on` in `render.yaml`), so every demo starts from the same story. The free database expires after 30 days; upgrading the app to Starter (about USD 7/month) keeps it always on.

## Showing a demo

With `DEMO_DAY=on` (mock adapters only) each start wipes the day's activity and builds a busy day through the real services: 6 trucks already left (3 green, 2 amber, 1 red) and 9 inside, each in a different situation (waiting check, ready to go, SDO amended, plate differs at the weighbridge, load rejected, two trucks on one SDO, watchlisted plate, coil truck waiting to weigh out). The pre-registered trucks WXY 1234, BPN 2045 and BMK 7710 are kept free for you to bring in live.

A suggested 10-minute walk-through:

1. **Live** (sign in as `supervisor`): trucks inside and where each one is, exits by colour, open alerts, SAP / CWIS sync. Tap a truck for its **timeline** (every step, who did it, when).
2. **In**: press the mock camera for WXY 1234: Collect, photos, card. It appears on Live straight away.
3. **Office** (clerk): match a walk-in, link a DO, clear an alert. **Left today** shows trucks that left, read-only, with their timelines.
4. **Check**: approve BQA 7701 (its SDO was amended, so the line shows "SDO changed").
5. **Out**: let BMK 7711 out green; let WRC 6650 out red and hear the alarm.

On **Live**, **Auto-play** moves its own trucks (plates starting with JQ) one step every 20 seconds so the screens change by themselves while you talk; **1× / 4× / 10×** fast-forwards it (10× is a step every 2 seconds); **Restart day** rebuilds the sample day. `DEMO_AUTOPLAY=on` starts auto-play at boot. Only the supervisor sees these controls.

## Develop

Requires Node 22, pnpm 10 and PostgreSQL 16 (local install, or just the database in Docker: `docker compose up -d db`).

```sh
pnpm install
cp .env.example .env      # then set DATABASE_URL, SEED_DEMO_PIN, SEED_DEMO_PASSWORD
pnpm db:seed              # migrates, then adds the site, demo users, 60 cards, sample data
pnpm dev                  # API on http://localhost:8080
pnpm dev:web              # screens on http://localhost:5173 (proxies /api)
pnpm test                 # unit, contract and database tests
pnpm e2e                  # browser tests at tablet (1280×800) and phone (390×844) size
pnpm typecheck
```

Browser tests start their own server and throwaway database. If Playwright cannot download its browser, point it at an installed Chromium: `CHROMIUM_PATH=/path/to/chrome pnpm e2e`. Screenshots of every step land in `apps/web/e2e-screens/`.

### Trying Gate In with the mocks

Sign in as **Entry Guard**. The purple **Test** button (bottom left, mock mode only) makes the entry camera "see" a sample plate. In the card step, **Test card** stands in for an RFID tap. On a real tablet the card is read by NFC (Chrome on Android) or a USB keyboard-style reader.

- `WXY 1234`: pre-registered, links SDO 5005 automatically
- `BPN 2045`: pre-registered with two SDOs; send `BPN 2O45` to see a misread and pick it from the list
- `BMK 7710`: pre-registered yesterday, shows as late
- `BQL 1187`: on the watchlist, red screen and alarm
- any other plate: new truck, guard picks the company or skips

### Trying the Office screen (clerk)

Use **Office login** with user `clerk` and `SEED_DEMO_PASSWORD`.

- **Trucks on site:** pick a truck to see gate photos, link SDOs from the shortlist (SDOs on its CWIS ticket first, then customers this company usually carries, then newest), set the company and driver (last 4 IC digits only). In mock mode, **Test weigh in / Wrong plate / Test weigh out** stand in for the weighbridge.
- **Pre-registered:** add plate + SDO(s) + date before the truck comes. Late ones stay until cleared with a reason.
- **Alerts:** open amber and red alerts, red first; clearing needs a reason (kept in the audit log).

Supervisors land on Office and can switch to Gate In from the title bar.

### Trying the Check screen (checker)

Sign in as **Checker 1** with the PIN. Trucks with SDOs that are not approved yet are listed; tap one, or tap its RFID card. The SDO lines are re-read live from SAP (the cached copy is shown, marked **Offline**, when SAP does not answer within 4 seconds). Normal load: **All OK**, **Photo**, **Approve**. Tap a line's number to count pieces with −10/−1/+1/+10. **Reject** asks for one of four reasons and alerts the supervisor and logistics; the truck goes back on the list as **Re-check**.

To see **SDO changed** in mock mode, amend an SDO line after the truck is matched: `POST /api/dev/sap/amend {"sdoNo":"5004","lineNo":0,"pieces":30}`.

### Trying Gate Out

Sign in as **Exit Guard** and tap **Out** in the title bar (each tablet remembers In or Out). The purple **Test** button makes the exit camera see a plate. The screen shows **Go** (green), **Check** (amber) or **Call supervisor** (red, with alarm) and the reasons. The driver's card tap lets the truck out (**Test card** in mock mode); **No card** then **Yes, no card** marks the card lost. A misread plate shows **Not inside** with **Pick truck**. A card tapped with no camera read finds its truck and lets it out.

Daily reconciliation (exits with no DO, DOs with no exit): `GET /api/reports/reconcile?date=YYYY-MM-DD` (clerk or supervisor).

### DOs (mock mode)

On a matched truck in **Office**, **Test DO** makes a DO in the mock SAP from the truck's SDOs (**Test part DO**: half the pieces, a split delivery). The DO links to the truck by itself and its SAP status turns **In SAP** once the UDFs are written. The checker then counts against the DO's pieces, with the SDO's shown alongside.

### Background jobs

The server runs these itself (no extra service to install); each retries on its own if SAP or CWIS is down, and the gate never waits on them:

| Job                | Every                                | What                                                                                                                                             |
| ------------------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sdo-refresh`      | 3 min (full about hourly)            | Copy open SDOs from SAP into the local cache                                                                                                     |
| `cwis-poll`        | 30 s                                 | Read new CWIS tickets, link them to trucks, flag plate mismatches                                                                                |
| `cwis-push`        | 10 s, and ~1 s after a trip changes  | Send truck details (plate, card, company, driver, SDOs, trip number) to CWIS, retrying with back-off                                             |
| `do-discovery`     | 2 min, and ~1 s after a trip changes | Find DOs made from the trucks' SDOs ("Copy To") and link each to its truck when only one truck fits                                              |
| `sap-writes`       | 15 s, and ~1 s after a trip changes  | Write plate, WB ticket, checker name/time and gate times to the DO's UDFs, retrying with back-off; the CWIS ticket number is the idempotency key |
| `transporter-sync` | 1 h                                  | Copy transporters from SAP business partners                                                                                                     |

The plan named pg-boss for these; a small in-process scheduler over the `cwis_pushes` / `sap_writes` outbox tables does the same job with one less dependency.

### Production

`pnpm build`, then run the server with `WEB_DIR=apps/web/dist` so one process serves the API and the screens on the LAN.

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
