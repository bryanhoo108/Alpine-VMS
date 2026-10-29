# Alpine VMS — instructions for Claude Code

Visitor and truck management system for Alpine Pipe Manufacturing (APM), Shah Alam. The full spec is in `docs/SPEC.md`. Read it before planning or writing code, and re-read the relevant section before each feature.

## Scope right now: Phase 1 (trucks) and Phase 2 (visitors, contractors)

Build only:
- Gate in / gate out for trucks, with LPR plate capture and RFID card issue/collect
- Clerk screen: match each truck to one or more SDOs
- Checker screen: check pipes against the latest SDO/DO lines, photos, approve/reject
- DO capture (DO found from the SDO via SAP's "Copy To" link)
- Exit alerts (green / amber / red) and the audit log
- Inbound coil trucks: gate in → CWIS weigh in/out → gate out (no SDO, no checker)

Phase 2 (approved by the owner, see `docs/decisions.md` V1–V10): visitors and contractors (invites with QR, walk-in registration on the entry tablet, group visits with one card, gate out), live headcount and muster list, and a "Staff" button that only logs the plate. Contractor document checks, safety video, staff flow, scorecards and multi-site screens are not built yet. Keep a `site_id` on every record so other sites can be added later.

## Hard rules

- **Record and alert, never block.** The system never stops a vehicle. Exceptions show amber/red to the guard and alert the supervisor.
- **Offline first.** Production runs on Alpine's on-site server alongside CWIS, on the factory LAN. The gate must keep working with no internet. No cloud-only services (no Vercel, no Supabase, no hosted auth) in the runtime path. Use a self-hosted database (PostgreSQL) and a server that runs on Linux or Windows Server.
- **The gate never waits on SAP.** All SAP writes go through a queue with retries. The CWIS ticket number is the idempotency key.
- **CWIS:** read-only for tickets. Never write into CWIS's own tables. Carry-forward to CWIS (plate, transporter, driver, SDO, trip ID) goes through an adapter: option A (vendor API / staging table) or option C (RFID reader as keyboard + synced lists). See spec.
- **SAP B1:** read SDOs, DOs and business partners; write only to UDFs on the DO (plate, WB ticket, checker name and time, gate in, gate out). Never write to SAP database tables directly. No stock or accounting postings.
- **Tolerance checking is out of scope.** It stays in CWIS.
- **RFID cards store only the card number.** No personal data on the card.

## Integrations are mocked for now

CWIS and SAP are not reachable from the build environment and access is not yet agreed. Put each behind an adapter interface with a mock implementation and realistic sample data:
- `CwisAdapter`: list tickets (ticket no., plate, SDO, weigh-in/out times), push pending truck
- `SapAdapter`: list open SDOs with lines, get DO(s) for an SDO, list business partners, write DO UDFs
- `LprAdapter`: plate events (plate text, photo, timestamp, camera = entry/exit)

Swapping a mock for the real thing must not touch screen or business logic.

## Data and privacy

- Sample data only. No real IC numbers, customer names, credentials or SAP/CWIS connection strings in the repo. Secrets go in environment variables, with a `.env.example` listing the names.
- IC numbers are masked on screen (show last 4 only). IC photos have a configurable retention period (PDPA).

## Guard and checker screens

Users are guards and checkers with simple English and low literacy.
- Tablet-first (landscape, about 1280×800), big touch targets, 1 to 3 words per button, an icon on every button
- Status by colour: green OK, amber check, red call supervisor (red also plays a sound)
- At most 3 taps per vehicle, no scrolling, no typing except correcting a plate
- Before calling any screen done, check it at tablet size and at phone size and fix layout and touch issues

## How to work

- Plan first and show the plan (data model, stack, folder layout) before writing code.
- Build in small steps; each step ends with something runnable plus tests for the business rules (exit status logic, SDO→DO linking incl. split and combined cases, plate mismatch, card lifecycle).
- When the spec is unclear, list the question instead of guessing. Open questions are in the "Open items" section of the spec.
