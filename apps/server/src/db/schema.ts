/**
 * Database schema (PostgreSQL). Every table except `sites` carries site_id so
 * other sites can be added later; a test enforces this.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true });
const id = () => uuid('id').primaryKey().defaultRandom();
const siteId = () =>
  uuid('site_id')
    .notNull()
    .references(() => sites.id);
const createdAt = () => ts('created_at').notNull().defaultNow();

// --- Enums -------------------------------------------------------------------

export const userRole = pgEnum('user_role', ['guard', 'clerk', 'checker', 'supervisor', 'admin']);
export const tripType = pgEnum('trip_type', ['outbound', 'inbound']);
export const tripStatus = pgEnum('trip_status', ['on_site', 'closed']);
export const exitLevel = pgEnum('exit_level', ['green', 'amber', 'red']);
export const cardStatus = pgEnum('card_status', ['free', 'issued', 'lost']);
export const camera = pgEnum('camera', ['entry', 'exit']);
export const photoKind = pgEnum('photo_kind', ['plate', 'ic', 'document', 'load']);
export const sdoLinkSource = pgEnum('sdo_link_source', ['pre_registration', 'clerk']);
export const doLinkSource = pgEnum('do_link_source', ['auto', 'clerk']);
export const doLinkState = pgEnum('do_link_state', ['linked', 'unlinked']);
export const checkerDecision = pgEnum('checker_decision', ['approve', 'reject']);
export const rejectReason = pgEnum('reject_reason', [
  'wrong_item',
  'wrong_quantity',
  'damaged',
  'other',
]);
export const alertLevel = pgEnum('alert_level', ['amber', 'red', 'logged']);
export const watchKind = pgEnum('watch_kind', ['plate', 'transporter']);
/** superseded = replaced by a newer write for the same DO before it was sent. */
export const outboxStatus = pgEnum('outbox_status', ['pending', 'done', 'failed', 'superseded']);
export const visitType = pgEnum('visit_type', ['visitor', 'contractor']);

// --- Site, people, vehicles --------------------------------------------------

export const sites = pgTable('sites', {
  id: id(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  timezone: text('timezone').notNull().default('Asia/Kuala_Lumpur'),
});

export const users = pgTable(
  'users',
  {
    id: id(),
    siteId: siteId(),
    username: text('username').notNull(),
    displayName: text('display_name').notNull(),
    role: userRole('role').notNull(),
    /** Guards and checkers sign in with a PIN; clerks and supervisors with a password. */
    pinHash: text('pin_hash'),
    passwordHash: text('password_hash'),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('users_site_username').on(t.siteId, t.username)],
);

export const transporters = pgTable(
  'transporters',
  {
    id: id(),
    siteId: siteId(),
    name: text('name').notNull(),
    sapBpCode: text('sap_bp_code'),
    lostCardCount: integer('lost_card_count').notNull().default(0),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('transporters_site_bp').on(t.siteId, t.sapBpCode)],
);

export const vehicles = pgTable(
  'vehicles',
  {
    id: id(),
    siteId: siteId(),
    /** Normalised plate (letters and digits only). */
    plate: text('plate').notNull(),
    transporterId: uuid('transporter_id').references(() => transporters.id),
    firstSeenAt: ts('first_seen_at').notNull().defaultNow(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('vehicles_site_plate').on(t.siteId, t.plate)],
);

/**
 * Drivers. Screens get only the last 4 IC digits; the full number is kept
 * encrypted when read from the IC photo (decision Q2a). The photo is in `photos`.
 */
export const persons = pgTable('persons', {
  id: id(),
  siteId: siteId(),
  name: text('name'),
  icLast4: text('ic_last4'),
  /** Full IC, encrypted (icCrypto.ts); cleared after the retention period. */
  icEncrypted: text('ic_encrypted'),
  transporterId: uuid('transporter_id').references(() => transporters.id),
  createdAt: createdAt(),
});

// --- Cards and trips ---------------------------------------------------------

export const cards = pgTable(
  'cards',
  {
    id: id(),
    siteId: siteId(),
    /** RFID card serial number. Nothing else is stored on the card. */
    cardNo: text('card_no').notNull(),
    status: cardStatus('status').notNull().default('free'),
    currentTripId: uuid('current_trip_id').references((): AnyPgColumn => trips.id),
    /** Set instead of currentTripId when the card is a visitor group's badge. */
    currentVisitId: uuid('current_visit_id').references((): AnyPgColumn => visits.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('cards_site_card_no').on(t.siteId, t.cardNo)],
);

export const preRegistrations = pgTable(
  'pre_registrations',
  {
    id: id(),
    siteId: siteId(),
    plate: text('plate').notNull(),
    transporterId: uuid('transporter_id').references(() => transporters.id),
    /** Site-local date. Past this date the entry shows as late until cleared. */
    expectedDate: date('expected_date', { mode: 'string' }).notNull(),
    sdoNos: text('sdo_nos').array().notNull(),
    note: text('note'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    arrivedTripId: uuid('arrived_trip_id').references((): AnyPgColumn => trips.id),
    clearedAt: ts('cleared_at'),
    clearedBy: uuid('cleared_by').references(() => users.id),
    clearReason: text('clear_reason'),
  },
  (t) => [index('pre_registrations_site_plate').on(t.siteId, t.plate)],
);

export const trips = pgTable(
  'trips',
  {
    id: id(),
    siteId: siteId(),
    /** Short readable number for screens and CWIS, e.g. T-261021-042. */
    tripNo: text('trip_no').notNull(),
    type: tripType('type').notNull(),
    status: tripStatus('status').notNull().default('on_site'),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id),
    plateIn: text('plate_in').notNull(),
    plateOut: text('plate_out'),
    transporterId: uuid('transporter_id').references(() => transporters.id),
    driverId: uuid('driver_id').references(() => persons.id),
    cardId: uuid('card_id').references(() => cards.id),
    preRegistrationId: uuid('pre_registration_id').references(() => preRegistrations.id),
    gateInAt: ts('gate_in_at').notNull(),
    gateInBy: uuid('gate_in_by')
      .notNull()
      .references(() => users.id),
    gateOutAt: ts('gate_out_at'),
    gateOutBy: uuid('gate_out_by').references(() => users.id),
    exitLevel: exitLevel('exit_level'),
    exitReasons: jsonb('exit_reasons'),
    cardReturned: boolean('card_returned'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('trips_site_trip_no').on(t.siteId, t.tripNo),
    index('trips_site_status').on(t.siteId, t.status),
  ],
);

export const plateReads = pgTable(
  'plate_reads',
  {
    id: id(),
    siteId: siteId(),
    camera: camera('camera').notNull(),
    plateText: text('plate_text').notNull(),
    confidence: real('confidence').notNull(),
    photoId: uuid('photo_id').references((): AnyPgColumn => photos.id),
    readAt: ts('read_at').notNull(),
    tripId: uuid('trip_id').references(() => trips.id),
    confirmedPlate: text('confirmed_plate'),
    corrected: boolean('corrected').notNull().default(false),
    /** Used by a visit or the "Staff" button (trucks set trip_id instead). */
    handledAt: ts('handled_at'),
  },
  (t) => [index('plate_reads_site_read_at').on(t.siteId, t.readAt)],
);

export const photos = pgTable('photos', {
  id: id(),
  siteId: siteId(),
  tripId: uuid('trip_id').references(() => trips.id),
  visitId: uuid('visit_id').references((): AnyPgColumn => visits.id),
  checkerDecisionId: uuid('checker_decision_id').references((): AnyPgColumn => checkerDecisions.id),
  kind: photoKind('kind').notNull(),
  /** Path under FILES_DIR. */
  path: text('path').notNull(),
  contentType: text('content_type').notNull(),
  takenAt: ts('taken_at').notNull().defaultNow(),
  takenBy: uuid('taken_by').references(() => users.id),
  /** PDPA retention: IC photos are deleted after this time. */
  deleteAfter: ts('delete_after'),
  deletedAt: ts('deleted_at'),
  /** What was read from an IC photo (cleared with the photo). */
  icLast4: text('ic_last4'),
  icName: text('ic_name'),
  icEncrypted: text('ic_encrypted'),
  icReadAt: ts('ic_read_at'),
});

// --- SDOs, DOs, tickets (copies of SAP and CWIS data) ------------------------

export const tripSdos = pgTable(
  'trip_sdos',
  {
    siteId: siteId(),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id),
    sdoNo: text('sdo_no').notNull(),
    source: sdoLinkSource('source').notNull(),
    linkedBy: uuid('linked_by').references(() => users.id),
    linkedAt: ts('linked_at').notNull().defaultNow(),
    /** sdoVersion() of the lines when linked; differs later → "SDO changed". */
    sdoVersionAtLink: text('sdo_version_at_link'),
    /** The lines as they were when linked, so the checker sees which line changed. */
    linesAtLink: jsonb('lines_at_link').$type<SdoLineSnapshot[]>(),
  },
  (t) => [primaryKey({ columns: [t.tripId, t.sdoNo] })],
);

export const sdoCache = pgTable(
  'sdo_cache',
  {
    siteId: siteId(),
    sdoNo: text('sdo_no').notNull(),
    customerCode: text('customer_code').notNull(),
    customerName: text('customer_name').notNull(),
    status: text('status').notNull(),
    docDate: ts('doc_date').notNull(),
    sapUpdatedAt: ts('sap_updated_at').notNull(),
    version: text('version').notNull(),
    fetchedAt: ts('fetched_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.siteId, t.sdoNo] })],
);

export const sdoLines = pgTable(
  'sdo_lines',
  {
    siteId: siteId(),
    sdoNo: text('sdo_no').notNull(),
    lineNo: integer('line_no').notNull(),
    itemCode: text('item_code').notNull(),
    description: text('description').notNull(),
    size: text('size').notNull(),
    spec: text('spec').notNull(),
    length: text('length').notNull(),
    pieces: integer('pieces').notNull(),
  },
  (t) => [primaryKey({ columns: [t.siteId, t.sdoNo, t.lineNo] })],
);

export const doCache = pgTable(
  'do_cache',
  {
    siteId: siteId(),
    doNo: text('do_no').notNull(),
    customerCode: text('customer_code').notNull(),
    sapCreatedAt: ts('sap_created_at').notNull(),
    fetchedAt: ts('fetched_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.siteId, t.doNo] })],
);

export const doLines = pgTable(
  'do_lines',
  {
    siteId: siteId(),
    doNo: text('do_no').notNull(),
    lineNo: integer('line_no').notNull(),
    itemCode: text('item_code').notNull(),
    pieces: integer('pieces').notNull(),
    /** "Copy To" base document: the SDO this line came from. */
    baseSdoNo: text('base_sdo_no'),
    baseLineNo: integer('base_line_no'),
  },
  (t) => [
    primaryKey({ columns: [t.siteId, t.doNo, t.lineNo] }),
    index('do_lines_site_base_sdo').on(t.siteId, t.baseSdoNo),
  ],
);

export const tripDos = pgTable(
  'trip_dos',
  {
    id: id(),
    siteId: siteId(),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id),
    doNo: text('do_no').notNull(),
    source: doLinkSource('source').notNull(),
    /** "unlinked" records a clerk's manual unlink so the auto rule does not re-add it. */
    state: doLinkState('state').notNull().default('linked'),
    changedBy: uuid('changed_by').references(() => users.id),
    changedAt: ts('changed_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('trip_dos_trip_do').on(t.tripId, t.doNo),
    // A DO belongs to at most one trip.
    uniqueIndex('trip_dos_one_claim')
      .on(t.siteId, t.doNo)
      .where(sql`${t.state} = 'linked'`),
  ],
);

export const weighTickets = pgTable(
  'weigh_tickets',
  {
    siteId: siteId(),
    ticketNo: text('ticket_no').notNull(),
    tripId: uuid('trip_id').references(() => trips.id),
    plate: text('plate').notNull(),
    /** One ticket can carry several SDOs; empty for inbound coil. */
    sdoNos: text('sdo_nos')
      .array()
      .notNull()
      .default(sql`'{}'`),
    transporterName: text('transporter_name'),
    vmsTripNo: text('vms_trip_no'),
    weighInAt: ts('weigh_in_at'),
    weighOutAt: ts('weigh_out_at'),
    cwisUpdatedAt: ts('cwis_updated_at').notNull(),
    fetchedAt: ts('fetched_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.siteId, t.ticketNo] }),
    index('weigh_tickets_trip').on(t.tripId),
  ],
);

// --- Checker -----------------------------------------------------------------

export interface SdoLineSnapshot {
  lineNo: number;
  itemCode: string;
  size: string;
  spec: string;
  length: string;
  pieces: number;
}

export interface LineCheck {
  sdoNo: string;
  lineNo: number;
  expectedPieces: number;
  actualPieces: number;
  ok: boolean;
}

export const checkerDecisions = pgTable(
  'checker_decisions',
  {
    id: id(),
    siteId: siteId(),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id),
    checkerId: uuid('checker_id')
      .notNull()
      .references(() => users.id),
    decidedAt: ts('decided_at').notNull().defaultNow(),
    decision: checkerDecision('decision').notNull(),
    reason: rejectReason('reason'),
    note: text('note'),
    lineChecks: jsonb('line_checks').$type<LineCheck[]>().notNull(),
    /** SDO lines as the checker saw them. */
    sdoSnapshot: jsonb('sdo_snapshot').notNull(),
  },
  (t) => [index('checker_decisions_trip').on(t.tripId, t.decidedAt)],
);

// --- Watchlist, alerts, audit ------------------------------------------------

export const watchlist = pgTable('watchlist', {
  id: id(),
  siteId: siteId(),
  kind: watchKind('kind').notNull(),
  /** Normalised plate, or transporter ID. */
  value: text('value').notNull(),
  reason: text('reason').notNull(),
  addedBy: uuid('added_by')
    .notNull()
    .references(() => users.id),
  addedAt: createdAt(),
  removedAt: ts('removed_at'),
  removedBy: uuid('removed_by').references(() => users.id),
});

export const alerts = pgTable(
  'alerts',
  {
    id: id(),
    siteId: siteId(),
    tripId: uuid('trip_id').references(() => trips.id),
    visitId: uuid('visit_id').references((): AnyPgColumn => visits.id),
    type: text('type').notNull(),
    level: alertLevel('level').notNull(),
    detail: jsonb('detail'),
    notify: text('notify').array().notNull(),
    raisedAt: ts('raised_at').notNull().defaultNow(),
    notifiedAt: ts('notified_at'),
    clearedAt: ts('cleared_at'),
    clearedBy: uuid('cleared_by').references(() => users.id),
    clearReason: text('clear_reason'),
  },
  (t) => [index('alerts_site_open').on(t.siteId, t.clearedAt)],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    siteId: siteId(),
    /** Null for system actions (jobs, adapters). */
    userId: uuid('user_id').references(() => users.id),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    at: ts('at').notNull().defaultNow(),
  },
  (t) => [index('audit_log_entity').on(t.entity, t.entityId)],
);

// --- Outboxes for SAP and CWIS (the gate never waits on either) ---------------

export const sapWrites = pgTable(
  'sap_writes',
  {
    id: id(),
    siteId: siteId(),
    tripId: uuid('trip_id').references(() => trips.id),
    doNo: text('do_no').notNull(),
    /** Built from the CWIS ticket number, so a retry cannot duplicate. */
    idempotencyKey: text('idempotency_key').notNull(),
    udfs: jsonb('udfs').notNull(),
    status: outboxStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    nextAttemptAt: ts('next_attempt_at').notNull().defaultNow(),
    createdAt: createdAt(),
    doneAt: ts('done_at'),
  },
  (t) => [
    uniqueIndex('sap_writes_site_key').on(t.siteId, t.idempotencyKey),
    index('sap_writes_due').on(t.status, t.nextAttemptAt),
  ],
);

export const cwisPushes = pgTable(
  'cwis_pushes',
  {
    id: id(),
    siteId: siteId(),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id),
    payload: jsonb('payload').notNull(),
    status: outboxStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    nextAttemptAt: ts('next_attempt_at').notNull().defaultNow(),
    createdAt: createdAt(),
    doneAt: ts('done_at'),
  },
  (t) => [index('cwis_pushes_due').on(t.status, t.nextAttemptAt)],
);

// --- Visitors, contractors, staff, muster (decisions V1–V10) -----------------------

/** Alpine employees visitors come to see. Not users: hosts do not sign in. */
export const hosts = pgTable('hosts', {
  id: id(),
  siteId: siteId(),
  name: text('name').notNull(),
  department: text('department'),
  /** Extension or mobile, for the guard to phone a walk-in's host. */
  phone: text('phone'),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
});

export const invites = pgTable(
  'invites',
  {
    id: id(),
    siteId: siteId(),
    /** In the QR code and readable aloud; see parseInviteCode. */
    code: text('code').notNull(),
    type: visitType('type').notNull(),
    /** The person who registers for the group. */
    name: text('name').notNull(),
    company: text('company'),
    phone: text('phone'),
    groupSize: integer('group_size').notNull().default(1),
    hostId: uuid('host_id')
      .notNull()
      .references(() => hosts.id),
    purpose: text('purpose'),
    /** Site-local dates; a contractor job can span days. */
    validFrom: date('valid_from', { mode: 'string' }).notNull(),
    validTo: date('valid_to', { mode: 'string' }).notNull(),
    /** Site-local HH:MM; leaving later than this (plus grace) shows amber. */
    untilTime: text('until_time'),
    plate: text('plate'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    cancelledAt: ts('cancelled_at'),
    cancelledBy: uuid('cancelled_by').references(() => users.id),
  },
  (t) => [uniqueIndex('invites_site_code').on(t.siteId, t.code)],
);

/** One visit per group per arrival: gate in to gate out. */
export const visits = pgTable(
  'visits',
  {
    id: id(),
    siteId: siteId(),
    /** Short readable number, e.g. V-261102-007. */
    visitNo: text('visit_no').notNull(),
    type: visitType('type').notNull(),
    status: tripStatus('status').notNull().default('on_site'),
    inviteId: uuid('invite_id').references(() => invites.id),
    name: text('name').notNull(),
    company: text('company'),
    phone: text('phone'),
    groupSize: integer('group_size').notNull(),
    /** Last 4 IC digits for screens; full number encrypted (decision Q2a). */
    icLast4: text('ic_last4'),
    icEncrypted: text('ic_encrypted'),
    /** Name read from the IC (the registered name can differ). */
    icName: text('ic_name'),
    hostId: uuid('host_id').references(() => hosts.id),
    /** Invited, or the guard phoned the host and tapped "Host OK". */
    hostConfirmed: boolean('host_confirmed').notNull(),
    plate: text('plate'),
    cardId: uuid('card_id').references(() => cards.id),
    expectedUntil: ts('expected_until'),
    gateInAt: ts('gate_in_at').notNull(),
    gateInBy: uuid('gate_in_by')
      .notNull()
      .references(() => users.id),
    gateOutAt: ts('gate_out_at'),
    gateOutBy: uuid('gate_out_by').references(() => users.id),
    exitLevel: exitLevel('exit_level'),
    exitReasons: jsonb('exit_reasons'),
    cardReturned: boolean('card_returned'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('visits_site_visit_no').on(t.siteId, t.visitNo),
    index('visits_site_status').on(t.siteId, t.status),
  ],
);

/** Staff cars: the guard taps "Staff" and the plate is logged. Nothing else yet (V9). */
export const staffEntries = pgTable(
  'staff_entries',
  {
    id: id(),
    siteId: siteId(),
    camera: camera('camera').notNull(),
    plate: text('plate').notNull(),
    plateReadId: uuid('plate_read_id').references(() => plateReads.id),
    at: ts('at').notNull(),
    loggedBy: uuid('logged_by')
      .notNull()
      .references(() => users.id),
  },
  (t) => [index('staff_entries_site_at').on(t.siteId, t.at)],
);

export interface MusterRollEntry {
  id: string;
  kind: 'truck' | 'visitor' | 'contractor';
  people: number;
  /** Plate, or the name of the person who registered the group. */
  label: string;
  company: string | null;
  host: string | null;
  cardNo: string | null;
}

/** An emergency roll call. The roll is fixed when it starts. */
export const musters = pgTable(
  'musters',
  {
    id: id(),
    siteId: siteId(),
    startedAt: ts('started_at').notNull(),
    startedBy: uuid('started_by')
      .notNull()
      .references(() => users.id),
    roll: jsonb('roll').$type<MusterRollEntry[]>().notNull(),
    endedAt: ts('ended_at'),
    endedBy: uuid('ended_by').references(() => users.id),
  },
  (t) => [index('musters_site_started').on(t.siteId, t.startedAt)],
);

export const musterMarks = pgTable(
  'muster_marks',
  {
    siteId: siteId(),
    musterId: uuid('muster_id')
      .notNull()
      .references(() => musters.id),
    /** Trip or visit ID from the roll. */
    entryId: text('entry_id').notNull(),
    markedAt: ts('marked_at').notNull(),
    markedBy: uuid('marked_by')
      .notNull()
      .references(() => users.id),
  },
  (t) => [primaryKey({ columns: [t.musterId, t.entryId] })],
);
