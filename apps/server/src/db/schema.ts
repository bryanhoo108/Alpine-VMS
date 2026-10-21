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
export const outboxStatus = pgEnum('outbox_status', ['pending', 'done', 'failed']);

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

/** Drivers. Only the last 4 IC digits are stored (decision Q2); the IC photo is in `photos`. */
export const persons = pgTable('persons', {
  id: id(),
  siteId: siteId(),
  name: text('name'),
  icLast4: text('ic_last4'),
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
  },
  (t) => [index('plate_reads_site_read_at').on(t.siteId, t.readAt)],
);

export const photos = pgTable('photos', {
  id: id(),
  siteId: siteId(),
  tripId: uuid('trip_id').references(() => trips.id),
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
