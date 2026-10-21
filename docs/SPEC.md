# Alpine VMS — System Specification

Oct 21, 2026 · Bryan Hoo · Source doc: https://claude.ai/artifact/FSwpSJF4NaNz8q5XcJJdjd

## Purpose and scope

The VMS records every person and vehicle entering Alpine (APM) as one trip, from gate in to gate out. Outbound trucks are linked end to end: SDO, CWIS weighing ticket, checker approval and SAP DO.

**Site as it stands**

| Item | Current state |
| --- | --- |
| Gates | 1 entry, 1 exit; trucks, visitors and staff share the same lane |
| Barriers | Manual |
| Weighbridges | 2, inside the factory (not at the gate) |
| Weighbridge software | CWIS, on Alpine's own server and database |
| ERP | SAP Business One, with a partner-built web portal for daily operations |
| Truck volume | About 70 trucks per day on average |
| Guards | Simple English; low literacy |

**In scope**

- Gate in/out for trucks, visitors, contractors and staff, with LPR plate reading
- RFID gate pass card per trip
- Truck-to-SDO matching, CWIS ticket linking, checker approval, DO capture
- Carry-forward of plate, transporter, driver and SDO into CWIS so the weighbridge operator does not re-key
- Alerts, audit trail and management dashboard

**Out of scope**

- Tolerance checking: stays in CWIS
- Billing by weight
- Replacing CWIS

**Control mode: record and alert.** The system never blocks a vehicle. It flags exceptions to the guard (red or amber screen) and alerts the supervisor.

## System architecture

The VMS runs on the existing on-site server alongside CWIS, so the gate keeps working if the internet drops. Cameras, tablets and card readers talk to it over the factory LAN; SAP and WhatsApp are reached through a sync queue.

> Diagram: VMS architecture · users, core, connected systems — see the diagram in the source doc: https://claude.ai/artifact/FSwpSJF4NaNz8q5XcJJdjd

The trip engine is the centre: every screen reads and writes the same trip record. The gate never waits on SAP; writes queue and retry when it is reachable.

## Outbound pipe flow

Every outbound truck is linked once to its SDO; from there the CWIS ticket, DO and checker decision attach automatically.

> Diagram: outbound pipe flow · 6 steps, 1 reject loop — see the diagram in the source doc: https://claude.ai/artifact/FSwpSJF4NaNz8q5XcJJdjd

The chain is plate → SDO → CWIS ticket → DO → checker → gate out; only step 2 is manual. Gate out is green when the checker approved, a DO exists for every SDO on the trip and the card is returned; otherwise amber or red with a supervisor alert (see Alerts and controls).

## Inbound coil flow

Inbound HRC coil is tracked by weighing only. There is no SDO and no checker step.

1. **Gate in (guard).** LPR reads the plate; guard taps **Deliver**, photographs the driver's IC and delivery documents, and issues an RFID card.
2. **Weigh in and weigh out (CWIS).** Plate, transporter and driver carry forward into CWIS; the ticket is linked to the trip.
3. **Gate out (guard).** Guard taps and collects the card.
   - Green: CWIS weigh-out done.
   - Amber: no weigh-out found. The supervisor is alerted.

The trip record holds plate, driver, transporter, CWIS ticket and gate times.

## Visitors, contractors and staff

All three share the truck lane, so each must clear the gate in a few taps.

| Who | Gate in | On site | Gate out |
| --- | --- | --- | --- |
| Visitor (invited) | Host sends a WhatsApp invite with a QR code; guard scans it, visitor watches the safety video and accepts PPE rules, gets an RFID card as badge | Host is named on the record | Guard taps and collects the card |
| Visitor (walk-in) | Registers on the kiosk; host approves on their phone; then as above | Same | Same |
| Contractor | As a visitor, plus a check of induction validity, permit to work and insurance expiry. Expired items show red and alert the supervisor | Counted in live headcount | Same |
| Staff | LPR reads the plate against the staff vehicle list; guard sees a green "Staff" card and lifts the barrier | Own staff card | LPR at exit |

**Live headcount and muster list.** Every open trip (visitors, contractors, drivers on site) is listed in real time. In an emergency, one tap gives the roll call.

## RFID gate pass

Each truck and visitor gets a reusable RFID card at gate in. The card holds only its own number, which the VMS links to the trip; no personal data is written to it.

Why a key, not data on the card:

- **Speed:** linking a blank card is one tap; no encoder needed.
- **PDPA:** no IC number on a card that can leave the site.
- **Tamper:** the card number means nothing without the VMS.
- **Always current:** SDO changes after gate in need no rewrite.

| Point | Who taps | What happens |
| --- | --- | --- |
| Gate in | Guard | Card linked to the new trip; driver keeps it |
| Weighbridge | WB operator | CWIS fills plate, transporter, driver, SDO (see CWIS integration) |
| Checker | Checker | Opens that truck's SDO directly |
| Gate out | Guard | Card collected; trip closed; card freed for reuse |

**Lost or unreturned card:** alert at gate out; a lost-card fee is charged to the transporter.

**Card type:** short-range tap cards readable by NFC tablets. Confirm with the card supplier that the chosen type reads on the tablets bought, since some card types are not supported by every Android device (not yet verified). Long-range dashboard cards are a later upgrade, not needed at 70 trucks per day.

## Screens by role

Five screens, one per role. Guards and checkers only tap; skilled work (matching) sits with the clerk.

| Role | Device | Main actions |
| --- | --- | --- |
| Guard (entry and exit) | Wall-mounted tablet, kiosk mode, NFC | Confirm LPR plate (photo beside text), tap purpose (Collect / Deliver / Visitor / Staff), photograph IC and documents, issue and collect card, see green / amber / red at exit |
| Clerk (logistics or weighbridge office) | PC | "Trucks on site" list; match each truck to one or more SDOs using gate photos and a shortlist of open SDOs; fix exceptions |
| Checker | Tablet or phone with NFC | Tap card, see latest SDO/DO lines, tick or enter actual pieces, take photos, Approve or Reject with reason |
| Visitor kiosk | Tablet at the gate | Walk-in registration, safety video, PPE acceptance |
| Management | Browser | Trucks on site now, turnaround by stage, exceptions, transporter scorecard, visitor log, muster list |

**Guard and checker UX rules**

- Simple English, 1 to 3 words per button, an icon on every button
- Status by colour: green OK, amber check, red call supervisor; red also plays a sound
- At most 3 taps per vehicle; no scrolling; no typing except to correct a plate
- Camera does the typing: LPR for plates, OCR for ICs
- Short training video for each role

**Checker screen detail**

- Opens from a card tap or the "waiting for check" list
- Shows the latest SDO/DO lines from SAP: size, spec, length, pieces
- Amber "SDO changed" tag if the SDO was amended after gate in
- Reject reasons: wrong item, wrong quantity, damaged, other. Reject alerts the supervisor and logistics on WhatsApp; the truck returns to loading
- Approve stamps checker name and time onto the trip and the DO

## CWIS integration

CWIS stays the weighing system and owns the tolerance check. The VMS sends it each truck's details so the operator does not re-key, and reads back the ticket.

**VMS → CWIS (carry forward)**

| Field | Captured by |
| --- | --- |
| Vehicle number | LPR at gate in |
| Transporter | Plate history; guard taps it on first visit |
| Driver name and IC | OCR of the IC photo |
| SDO | Clerk match |
| VMS trip ID | Automatic |

**CWIS → VMS (read back, read-only)**

- Ticket number, plate and SDO for each weighing. The ticket stores the SDO, so the ticket links to the trip exactly.
- Cross-check: CWIS plate vs LPR plate. A mismatch is flagged amber.

**Option A (target): CWIS API or pre-registration.** The VMS creates a pending truck record in CWIS at gate in. The operator taps the RFID card (or picks the plate from a list) and CWIS fills every field. Needs the CWIS vendor to provide an API, an import function or a vendor-approved staging table. The VMS never writes into CWIS's own tables.

**Option C (fallback): RFID reader as keyboard.** A USB RFID reader at the weighbridge types the card number into a CWIS field. The VMS keeps CWIS's vehicle and transporter lists in sync so the plate pulls the transporter. The driver field may still need typing. No vendor work needed.

The vendor's answers (see Open items) decide A or C.

## SAP B1 integration

SAP stays the source of truth for SDOs and DOs; the VMS reads them and writes trip data back into custom fields. No stock or accounting postings are made by the VMS.

**Route.** Integrate at the data layer, not through the partner-built portal's screens. Either the SAP Service Layer (SAP's REST API) or endpoints the partner exposes from the portal's backend. Never write directly to SAP's database tables. Integrator docs state the Service Layer supports the SQL Server version from 10.0 FP 2102 ([Sana Commerce](https://support.sana-commerce.com/Content/Release-Notes/Sana-for-SAPB1/1017/Service-Layer-SQL-Compatibility.htm)); confirm the installed version and database with the partner.

**Reads (SAP → VMS)**

- Open SDOs: customer, lines (size, spec, length, pieces). Cached and refreshed every few minutes, and re-read at the checker step so the latest version is used
- DOs: found through the SDO reference that "Copy To" carries onto each DO line. Handles one SDO split into several DOs and several SDOs combined into one DO
- Business partners: customers and transporters

**Writes (VMS → SAP), custom fields (UDFs) on the DO**

| UDF | Value |
| --- | --- |
| Plate | From LPR |
| WB ticket | CWIS ticket number |
| Checker | Name and approval time |
| Gate in / gate out | Timestamps |

**Reliability**

- The gate never waits on SAP: writes queue and retry when SAP is reachable
- The CWIS ticket number is a unique key, so a retry cannot create duplicates
- Nightly reconciliation: exits with no DO, DOs with no exit
- Dedicated SAP integration user; the API reachable only from the VMS server
- SAP licensing for API access is partner-specific and not yet verified; raise it with the partner early

## Data model

The trip is the centre: every gate event, weighing, check and document hangs off one trip ID. Every record carries a site ID so HTH and other sites can be added later.

| Entity | Key fields | Notes |
| --- | --- | --- |
| Trip | trip ID, site, type (outbound / inbound / visitor / contractor / staff), card no., gate-in and gate-out times, status | One per visit |
| Vehicle | plate, transporter, first seen, last seen | Learned from plate history |
| Transporter | name, SAP business partner code, lost-card count | Scorecard source |
| Person | name, IC (masked on screen), company, role (driver / visitor / contractor / staff), photo | IC image retention period to be set (PDPA) |
| Trip–SDO link | trip ID, SDO no. | Many-to-many |
| SDO–DO link | SDO no., DO no. | Read from SAP "Copy To" reference |
| Weigh ticket | CWIS ticket no., trip ID, SDO, plate | Read-only copy from CWIS |
| Checker decision | trip ID, checker, time, approve / reject, reason, line ticks, photos | Outbound only |
| Card | card no., status (free / issued / lost), current trip | Reusable pool |
| Contractor compliance | person, induction expiry, permit to work, insurance expiry | Gate check |
| Alert | trip ID, type, raised at, cleared by, reason | Audit trail |
| Audit log | user, action, before, after, time | Every override and edit |

## Alerts and controls

Every alert goes to the guard screen and, where marked, to the supervisor on WhatsApp. Nothing blocks the vehicle.

| Trigger | Where | Level | Supervisor alert |
| --- | --- | --- | --- |
| Outbound truck at exit without checker approval | Gate out | Red | Yes |
| Outbound truck at exit with no DO found for an SDO | Gate out | Amber | Yes |
| Inbound truck at exit with no CWIS weigh-out | Gate out | Amber | Yes |
| Card not returned at exit | Gate out | Red | Yes |
| Plate on CWIS ticket differs from LPR plate | Weighbridge | Amber | Yes |
| SDO amended after gate in | Checker screen | Amber | No |
| Checker rejects load | Checker | Red | Yes, plus logistics |
| Plate on watchlist (vehicle, driver or company) | Gate in | Red | Yes |
| Contractor induction, permit or insurance expired | Gate in | Red | Yes |
| Plate entered twice with no exit between | Gate in | Amber | Yes |
| LPR read not confirmed or manually changed | Gate in | Logged | No |

**Unannounced trucks** are normal, not an exception. The guard captures; the clerk matches. Transporters get a WhatsApp link to pre-advise plate and SDO; pre-advised trucks get loading priority. The share of unannounced trucks per transporter is tracked on the scorecard.

## Hardware list

No new server is needed: the VMS runs on the existing on-site server that hosts CWIS, or a VM on it. Prices to be quoted.

| Item | Qty | Where | Notes |
| --- | --- | --- | --- |
| ANPR camera (on-camera plate recognition) | 2 | Entry gate, exit gate | Dedicated, not existing CCTV; both face the vehicle's front; also record to the NVR |
| Guard tablet, NFC, rugged case, wall mount, always charging | 2 | Entry and exit guard posts | Kiosk mode, single app |
| Checker tablet or phone, NFC | 1 per checker | Checking area |  |
| Visitor kiosk tablet | 1 | Gate | Can share the entry guard tablet in phase 1 |
| USB RFID reader | 2 | One per weighbridge | Option C keyboard input; also usable with option A |
| RFID cards | Pool sized to peak trucks and visitors on site, plus spares | Guardhouse | Size to be set from gate data |
| Network |  | Guardhouse, checking area, weighbridges | Wired LAN to cameras; Wi-Fi for tablets |
| UPS | 1 | Guardhouse | Keeps cameras, network and tablets running in a power cut |
| WhatsApp Business API account | 1 |  | Invites, alerts, pre-advice links |

## Phasing

Phase 1 covers trucks, because that is where material and money leave the site. Dates to be set once the CWIS vendor and SAP partner reply.

> Diagram: phasing · 3 phases, 3 gates — see the diagram in the source doc: https://claude.ai/artifact/FSwpSJF4NaNz8q5XcJJdjd

Gate 0 is the vendor and partner answers in Open items. Gate 1 is every outbound trip linked from gate in to gate out with guards working unaided.

## Open items

The CWIS vendor's answers decide integration option A or C; the SAP partner's decide the read and write route.

**CWIS vendor**

- [ ] Does CWIS have an API, import function or pre-registration for expected vehicles?
- [ ] If not, will they add a staging table the VMS can write pending trucks into?
- [ ] Which fields does a ticket hold (plate, transporter, driver, IC, SDO), and is there a free field for the VMS trip ID?
- [ ] Does CWIS keep its own vehicle and transporter lists the VMS can sync?
- [ ] Does CWIS support an RFID card reader or a card-number field?
- [ ] Can the VMS get read-only access to the CWIS database?

**SAP partner**

- [ ] Which SAP document type is the SDO?
- [ ] Read access to SDOs and DOs: Service Layer or the portal backend's API?
- [ ] Add UDFs on the DO: plate, WB ticket, checker name and time, gate in, gate out
- [ ] Confirm SAP B1 version and database (HANA or SQL Server)
- [ ] Licensing cost for an API integration user

**Internal**

- [ ] Test the SDO → DO "Copy To" link on several real SDOs, including split and combined cases
- [ ] Confirm the VMS can run on the CWIS server (capacity, IT approval)
- [ ] Number of checkers and checking points
- [ ] RFID card pool size and lost-card fee
- [ ] IC image retention period (PDPA)
- [ ] Transporter contact list for pre-advice links
