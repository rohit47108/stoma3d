import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as SQLite from "expo-sqlite";

import {
  CREATE_NORMALIZED_STORAGE_SCHEMA_SQL,
  NORMALIZED_STORAGE_CLEAR_ORDER,
  NORMALIZED_STORAGE_SCHEMA_VERSION,
  UPGRADE_NORMALIZED_STORAGE_V3_TO_V4_SQL,
  UPGRADE_NORMALIZED_STORAGE_V4_TO_V5_SQL,
  UPGRADE_NORMALIZED_STORAGE_V5_TO_V6_SQL,
  type CaptureSetRow,
  type CaptureViewRow,
  type ExistingEntityIdentity,
  type NormalizedStorageRows,
  type TombstoneRecord,
  type TombstonedEntityType,
  planStorageInitialization,
  reconcileNormalizedRows,
  restorePersistedState,
} from "@/lib/normalizedStorageSchema";
import { deleteProtectedFilesAndRotateKey } from "@/lib/secureFiles";
import { parsePersistedAppState } from "@/lib/persistedStateSchema";
import {
  parseCaptureDrafts,
  upsertCaptureDraft,
  type CaptureDraft,
} from "@/lib/captureDrafts";
import { assertSqlCipherRuntime } from "@/lib/sqlCipherRuntime";
import type {
  AccessibilitySettings,
  CaptureRecord,
  IntakeProfile,
  ObservationPin,
  PersistedAppState,
  ReportRecord,
  ScanSession,
} from "@/types";
import type {
  AnalysisResult,
  CaptureAngle,
  CaptureProtocol,
  ComparisonResult,
  MediaKind,
  MouthRegion,
} from "@stoma3d/contracts";

const DATABASE_NAME = "stoma3d.db";
const DATABASE_KEY_NAME = "stoma3d.database-key.v1";
const HEX_DATABASE_KEY = /^[a-f0-9]{64}$/;

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;
let writeQueue: Promise<void> = Promise.resolve();

type DatabaseConnection = Pick<
  SQLite.SQLiteDatabase,
  "execAsync" | "getAllAsync" | "getFirstAsync" | "prepareAsync" | "runAsync"
>;

interface MetadataRow {
  key: string;
  value: string | null;
}

interface SettingsRow {
  high_contrast: number;
  large_text: number;
  reduced_motion: number;
  animation_speed: "slow" | "standard";
  haptics: number;
  voice_instructions: number;
  caregiver_mode: number;
  analytics_opt_in: number;
}

interface SessionRow {
  id: string;
  created_at: string;
  demo: number;
  label: string;
  protocol: string;
  intake_profile_state: "missing" | "null" | "value";
  intake_profile_payload: string | null;
  consented_at_present: number;
  consented_at: string | null;
}

interface CaptureSetDatabaseRow {
  id: string;
  session_id: string;
  region: string;
  protocol: string;
  ordinal: number;
  created_at: string;
}

interface CaptureViewDatabaseRow {
  id: string;
  capture_set_id: string;
  ordinal: number;
  session_id: string;
  region: string;
  angle: string;
  media_kind: string;
  captured_at: string;
  encrypted_uri: string | null;
  mime_type: string;
  input_origin: string;
  fixture_sha256: string | null;
  capture_source: string | null;
  source_video_duration_ms: number | null;
  frame_time_ms: number | null;
  calibration_requested: number | null;
  calibration_plane_confirmed: number | null;
  calibration_card_version: string | null;
  calibration_payload: string | null;
  privacy_confirmed: number | null;
  region_confirmed: number | null;
  guidance_payload: string | null;
  quality_payload: string;
  sample_placeholder: number | null;
}

interface ObservationDatabaseRow {
  id: string;
  region: string;
  mesh_id: string;
  uv_x: number;
  uv_y: number;
  asset_version: string;
  user_confirmed: number;
  first_observed_at: string;
  status: string;
  capture_ids_payload: string;
}

interface ReportDatabaseRow {
  id: string;
  created_at: string;
  encrypted_uri: string;
  session_id: string;
}

async function databaseKey(): Promise<string> {
  const stored = await SecureStore.getItemAsync(DATABASE_KEY_NAME);
  if (stored) {
    if (!HEX_DATABASE_KEY.test(stored)) {
      throw new Error("The protected database key is invalid.");
    }
    return stored;
  }
  const bytes = await Crypto.getRandomBytesAsync(32);
  const key = [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  await SecureStore.setItemAsync(DATABASE_KEY_NAME, key, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return key;
}

async function metadataMap(
  database: DatabaseConnection,
): Promise<Map<string, string | null>> {
  const rows = await database.getAllAsync<MetadataRow>(
    "SELECT key, value FROM metadata",
  );
  return new Map(rows.map((row) => [row.key, row.value]));
}

async function setMetadata(
  database: DatabaseConnection,
  key: string,
  value: string | null,
): Promise<void> {
  await database.runAsync(
    `INSERT INTO metadata (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    key,
    value,
  );
}

async function executeMany(
  database: DatabaseConnection,
  sql: string,
  values: SQLite.SQLiteBindParams[],
): Promise<void> {
  if (values.length === 0) return;
  const statement = await database.prepareAsync(sql);
  try {
    for (const params of values) {
      await statement.executeAsync(params);
    }
  } finally {
    await statement.finalizeAsync();
  }
}

function optionalBoolean(value: boolean | undefined): number | null {
  return value === undefined ? null : Number(value);
}

function sessionIntakeState(
  session: ScanSession,
): "missing" | "null" | "value" {
  if (!Object.prototype.hasOwnProperty.call(session, "intakeProfile")) {
    return "missing";
  }
  return session.intakeProfile === null ? "null" : "value";
}

async function replaceNormalizedRows(
  database: DatabaseConnection,
  rows: NormalizedStorageRows,
): Promise<void> {
  await database.execAsync(`
    DELETE FROM analyses;
    DELETE FROM comparisons;
    DELETE FROM capture_views;
    DELETE FROM capture_sets;
    DELETE FROM observations;
    DELETE FROM reports;
    DELETE FROM sessions;
    DELETE FROM profile;
    DELETE FROM settings;
  `);

  await database.runAsync(
    `INSERT INTO settings (
       id, high_contrast, large_text, reduced_motion, animation_speed, haptics,
       voice_instructions, caregiver_mode, analytics_opt_in
     ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)`,
    Number(rows.settings.highContrast),
    Number(rows.settings.largeText),
    Number(rows.settings.reducedMotion),
    rows.settings.animationSpeed,
    Number(rows.settings.haptics),
    Number(rows.settings.voiceInstructions),
    Number(rows.settings.caregiverMode),
    Number(rows.settings.analyticsOptIn),
  );

  if (rows.profile) {
    await database.runAsync(
      "INSERT INTO profile (id, payload) VALUES (1, ?)",
      JSON.stringify(rows.profile),
    );
  }

  await executeMany(
    database,
    `INSERT INTO sessions (
       id, ordinal, created_at, demo, label, protocol, intake_profile_state,
       intake_profile_payload, consented_at_present, consented_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    rows.sessions.map((session, ordinal) => {
      const intakeState = sessionIntakeState(session);
      const hasConsentedAt = Object.prototype.hasOwnProperty.call(
        session,
        "consentedAt",
      );
      return [
        session.id,
        ordinal,
        session.createdAt,
        Number(session.demo),
        session.label,
        session.protocol,
        intakeState,
        intakeState === "value" ? JSON.stringify(session.intakeProfile) : null,
        Number(hasConsentedAt),
        hasConsentedAt ? (session.consentedAt ?? null) : null,
      ];
    }),
  );

  await executeMany(
    database,
    `INSERT INTO capture_sets (
       id, session_id, region, protocol, ordinal, created_at
     ) VALUES (?, ?, ?, ?, ?, ?)`,
    rows.captureSets.map((row) => [
      row.id,
      row.sessionId,
      row.region,
      row.protocol,
      row.ordinal,
      row.createdAt,
    ]),
  );

  await executeMany(
    database,
    `INSERT INTO capture_views (
       id, capture_set_id, ordinal, angle, media_kind, captured_at,
       encrypted_uri, mime_type, input_origin, fixture_sha256, capture_source,
       source_video_duration_ms, frame_time_ms, privacy_confirmed,
       calibration_requested, calibration_plane_confirmed,
       calibration_card_version, calibration_payload, region_confirmed,
       guidance_payload, quality_payload, sample_placeholder
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    rows.captureViews.map(({ captureSetId, ordinal, capture }) => [
      capture.id,
      captureSetId,
      ordinal,
      capture.angle,
      capture.mediaKind,
      capture.capturedAt,
      capture.encryptedUri,
      capture.mimeType,
      capture.inputOrigin,
      capture.fixtureSha256 ?? null,
      capture.captureSource ?? null,
      capture.sourceVideoDurationMs ?? null,
      capture.frameTimeMs ?? null,
      optionalBoolean(capture.privacyConfirmedByUser),
      optionalBoolean(capture.calibrationRequested),
      optionalBoolean(capture.calibrationPlaneConfirmed),
      capture.calibrationCardVersion ?? null,
      capture.calibration ? JSON.stringify(capture.calibration) : null,
      optionalBoolean(capture.regionConfirmedByUser),
      capture.captureGuidance ? JSON.stringify(capture.captureGuidance) : null,
      JSON.stringify(capture.quality),
      optionalBoolean(capture.samplePlaceholder),
    ]),
  );

  await executeMany(
    database,
    "INSERT INTO analyses (capture_view_id, payload) VALUES (?, ?)",
    rows.analyses.map(({ captureId, analysis }) => [
      captureId,
      JSON.stringify(analysis),
    ]),
  );

  await executeMany(
    database,
    `INSERT INTO observations (
       id, ordinal, region, mesh_id, uv_x, uv_y, asset_version,
       user_confirmed, first_observed_at, status, capture_ids_payload
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    rows.observations.map((observation, ordinal) => [
      observation.id,
      ordinal,
      observation.region,
      observation.meshId,
      observation.uvX,
      observation.uvY,
      observation.assetVersion,
      Number(observation.userConfirmed),
      observation.firstObservedAt,
      observation.status,
      JSON.stringify(observation.captureIds),
    ]),
  );

  await executeMany(
    database,
    `INSERT INTO comparisons (
       id, ordinal, baseline_capture_id, current_capture_id, payload
     ) VALUES (?, ?, ?, ?, ?)`,
    rows.comparisons.map(({ id, comparison }, ordinal) => [
      id,
      ordinal,
      comparison.baselineCaptureId,
      comparison.currentCaptureId,
      JSON.stringify(comparison),
    ]),
  );

  await executeMany(
    database,
    `INSERT INTO reports (
       id, ordinal, session_id, created_at, encrypted_uri
     ) VALUES (?, ?, ?, ?, ?)`,
    rows.reports.map((report, ordinal) => [
      report.id,
      ordinal,
      report.sessionId,
      report.createdAt,
      report.encryptedUri,
    ]),
  );

  await executeMany(
    database,
    `INSERT INTO tombstones (entity_type, entity_id, deleted_at)
       VALUES (?, ?, ?)
       ON CONFLICT(entity_type, entity_id) DO NOTHING`,
    rows.tombstones.map((tombstone) => [
      tombstone.entityType,
      tombstone.entityId,
      tombstone.deletedAt,
    ]),
  );

  await setMetadata(
    database,
    "storage_schema_version",
    String(NORMALIZED_STORAGE_SCHEMA_VERSION),
  );
  await setMetadata(database, "app_schema_version", "4");
  await setMetadata(database, "state_present", "1");
  await setMetadata(database, "consented_at", rows.consentedAt);
  await setMetadata(database, "active_session_id", rows.activeSessionId);
  await setMetadata(database, "updated_at", rows.updatedAt);
}

async function readEntityIdentities(
  database: DatabaseConnection,
): Promise<ExistingEntityIdentity[]> {
  const rows = await database.getAllAsync<{
    entity_type: TombstonedEntityType;
    entity_id: string;
  }>(`
    SELECT 'sessions' AS entity_type, id AS entity_id FROM sessions
    UNION ALL SELECT 'capture_views', id FROM capture_views
    UNION ALL SELECT 'analyses', capture_view_id FROM analyses
    UNION ALL SELECT 'observations', id FROM observations
    UNION ALL SELECT 'comparisons', id FROM comparisons
    UNION ALL SELECT 'reports', id FROM reports
  `);
  return rows.map((row) => ({
    entityType: row.entity_type,
    entityId: row.entity_id,
  }));
}

async function readTombstones(
  database: DatabaseConnection,
): Promise<TombstoneRecord[]> {
  const rows = await database.getAllAsync<{
    entity_type: TombstonedEntityType;
    entity_id: string;
    deleted_at: string;
  }>(
    "SELECT entity_type, entity_id, deleted_at FROM tombstones ORDER BY deleted_at, entity_type, entity_id",
  );
  return rows.map((row) => ({
    entityType: row.entity_type,
    entityId: row.entity_id,
    deletedAt: row.deleted_at,
  }));
}

async function initializeDatabase(
  database: SQLite.SQLiteDatabase,
): Promise<void> {
  // SQLCipher keys are connection-local, so migration stays on the keyed
  // connection instead of Expo's separate exclusive-transaction connection.
  await database.withTransactionAsync(async () => {
    await database.execAsync(CREATE_NORMALIZED_STORAGE_SCHEMA_SQL);
    const metadata = await metadataMap(database);
    const rawVersion = metadata.get("storage_schema_version") ?? null;
    const storedVersion = rawVersion === null ? null : Number(rawVersion);
    if (rawVersion !== null && !Number.isInteger(storedVersion)) {
      throw new Error("The protected storage version is invalid.");
    }

    const legacyTable = await database.getFirstAsync<{ present: number }>(
      `SELECT 1 AS present FROM sqlite_master
         WHERE type = 'table' AND name = 'app_state'`,
    );
    const legacyRow = legacyTable
      ? await database.getFirstAsync<{ payload: string }>(
          "SELECT payload FROM app_state WHERE id = 1",
        )
      : null;
    const updatedAt = new Date().toISOString();
    const plan = planStorageInitialization(
      storedVersion,
      legacyRow?.payload ?? null,
      updatedAt,
    );

    if (plan.kind === "ready") return;
    if (plan.kind === "upgrade") {
      if (storedVersion === 3) {
        await database.execAsync(UPGRADE_NORMALIZED_STORAGE_V3_TO_V4_SQL);
      }
      if (storedVersion !== null && storedVersion <= 4) {
        await database.execAsync(UPGRADE_NORMALIZED_STORAGE_V4_TO_V5_SQL);
      }
      if (storedVersion !== null && storedVersion <= 5) {
        await database.execAsync(UPGRADE_NORMALIZED_STORAGE_V5_TO_V6_SQL);
      }
      await setMetadata(
        database,
        "storage_schema_version",
        String(NORMALIZED_STORAGE_SCHEMA_VERSION),
      );
      await setMetadata(database, "app_schema_version", "4");
      return;
    }
    if (plan.kind === "migrate") {
      await replaceNormalizedRows(database, plan.rows);
    } else {
      await setMetadata(
        database,
        "storage_schema_version",
        String(NORMALIZED_STORAGE_SCHEMA_VERSION),
      );
      await setMetadata(database, "app_schema_version", "4");
      await setMetadata(database, "state_present", "0");
      await setMetadata(database, "consented_at", null);
      await setMetadata(database, "active_session_id", null);
      await setMetadata(database, "updated_at", updatedAt);
    }
    await database.execAsync("DROP TABLE IF EXISTS app_state;");
  });
}

async function openDatabase(): Promise<SQLite.SQLiteDatabase> {
  const key = await databaseKey();
  const database = await SQLite.openDatabaseAsync(DATABASE_NAME);
  try {
    await database.execAsync(`PRAGMA key = "x'${key}'";`);
    // Plain SQLite silently ignores SQLCipher pragmas. Verify the native codec
    // before reading or writing any health data so Expo Go/misbuilt clients fail closed.
    await assertSqlCipherRuntime(database);
    await database.execAsync("PRAGMA journal_mode = WAL;");
    await database.execAsync("PRAGMA foreign_keys = ON;");
    await initializeDatabase(database);
    return database;
  } catch (error) {
    await database.closeAsync().catch(() => undefined);
    throw error;
  }
}

async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  databasePromise ??= openDatabase();
  return databasePromise;
}

function booleanFromInteger(value: number): boolean {
  return value === 1;
}

function optionalBooleanFromInteger(value: number | null): boolean | undefined {
  return value === null ? undefined : booleanFromInteger(value);
}

async function readNormalizedRows(
  database: DatabaseConnection,
): Promise<NormalizedStorageRows | null> {
  const metadata = await metadataMap(database);
  if (metadata.get("state_present") !== "1") return null;

  const settingsRow = await database.getFirstAsync<SettingsRow>(
    `SELECT high_contrast, large_text, reduced_motion, animation_speed, haptics,
            voice_instructions, caregiver_mode, analytics_opt_in
       FROM settings WHERE id = 1`,
  );
  if (!settingsRow) throw new Error("Protected settings are missing.");
  const settings: AccessibilitySettings = {
    highContrast: booleanFromInteger(settingsRow.high_contrast),
    largeText: booleanFromInteger(settingsRow.large_text),
    reducedMotion: booleanFromInteger(settingsRow.reduced_motion),
    animationSpeed: settingsRow.animation_speed,
    haptics: booleanFromInteger(settingsRow.haptics),
    voiceInstructions: booleanFromInteger(settingsRow.voice_instructions),
    caregiverMode: booleanFromInteger(settingsRow.caregiver_mode),
    analyticsOptIn: booleanFromInteger(settingsRow.analytics_opt_in),
  };

  const profileRow = await database.getFirstAsync<{ payload: string }>(
    "SELECT payload FROM profile WHERE id = 1",
  );
  const profile = profileRow
    ? (JSON.parse(profileRow.payload) as IntakeProfile)
    : null;

  const sessionRows = await database.getAllAsync<SessionRow>(
    `SELECT id, created_at, demo, label, protocol, intake_profile_state,
            intake_profile_payload, consented_at_present, consented_at
       FROM sessions ORDER BY ordinal`,
  );
  const sessions: ScanSession[] = sessionRows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    demo: booleanFromInteger(row.demo),
    label: row.label,
    protocol: row.protocol as CaptureProtocol,
    ...(row.intake_profile_state === "missing"
      ? {}
      : {
          intakeProfile:
            row.intake_profile_state === "null"
              ? null
              : (JSON.parse(
                  row.intake_profile_payload ?? "null",
                ) as IntakeProfile),
        }),
    ...(booleanFromInteger(row.consented_at_present)
      ? { consentedAt: row.consented_at }
      : {}),
  }));

  const captureSetRows = await database.getAllAsync<CaptureSetDatabaseRow>(
    `SELECT id, session_id, region, protocol, ordinal, created_at
       FROM capture_sets ORDER BY ordinal`,
  );
  const captureSets: CaptureSetRow[] = captureSetRows.map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    region: row.region as MouthRegion,
    protocol: row.protocol as CaptureProtocol,
    ordinal: row.ordinal,
    createdAt: row.created_at,
  }));

  const captureRows = await database.getAllAsync<CaptureViewDatabaseRow>(`
    SELECT capture_views.id, capture_views.capture_set_id,
           capture_views.ordinal, capture_sets.session_id, capture_sets.region,
           capture_views.angle, capture_views.media_kind,
           capture_views.captured_at, capture_views.encrypted_uri,
           capture_views.mime_type, capture_views.input_origin,
           capture_views.fixture_sha256, capture_views.capture_source,
           capture_views.source_video_duration_ms, capture_views.frame_time_ms,
           capture_views.calibration_requested,
           capture_views.calibration_plane_confirmed,
           capture_views.calibration_card_version,
           capture_views.calibration_payload,
           capture_views.privacy_confirmed, capture_views.region_confirmed,
           capture_views.guidance_payload,
           capture_views.quality_payload, capture_views.sample_placeholder
      FROM capture_views
      JOIN capture_sets ON capture_sets.id = capture_views.capture_set_id
     ORDER BY capture_views.ordinal
  `);
  const captureViews: CaptureViewRow[] = captureRows.map((row) => ({
    captureSetId: row.capture_set_id,
    ordinal: row.ordinal,
    capture: {
      id: row.id,
      sessionId: row.session_id,
      region: row.region as CaptureRecord["region"],
      angle: row.angle as CaptureAngle,
      mediaKind: row.media_kind as Extract<MediaKind, "image" | "video_frame">,
      capturedAt: row.captured_at,
      encryptedUri: row.encrypted_uri,
      mimeType: row.mime_type as CaptureRecord["mimeType"],
      inputOrigin: row.input_origin as CaptureRecord["inputOrigin"],
      ...(row.fixture_sha256 ? { fixtureSha256: row.fixture_sha256 } : {}),
      ...(row.capture_source
        ? {
            captureSource: row.capture_source as CaptureRecord["captureSource"],
          }
        : {}),
      ...(row.source_video_duration_ms === null
        ? {}
        : { sourceVideoDurationMs: row.source_video_duration_ms }),
      ...(row.frame_time_ms === null ? {} : { frameTimeMs: row.frame_time_ms }),
      ...(row.calibration_requested === null
        ? {}
        : {
            calibrationRequested: optionalBooleanFromInteger(
              row.calibration_requested,
            ),
          }),
      ...(row.calibration_plane_confirmed === null
        ? {}
        : {
            calibrationPlaneConfirmed: optionalBooleanFromInteger(
              row.calibration_plane_confirmed,
            ),
          }),
      ...(row.calibration_card_version === null
        ? {}
        : {
            calibrationCardVersion:
              row.calibration_card_version as CaptureRecord["calibrationCardVersion"],
          }),
      ...(row.calibration_payload === null
        ? {}
        : {
            calibration: JSON.parse(
              row.calibration_payload,
            ) as CaptureRecord["calibration"],
          }),
      ...(row.privacy_confirmed === null
        ? {}
        : {
            privacyConfirmedByUser: optionalBooleanFromInteger(
              row.privacy_confirmed,
            ),
          }),
      ...(row.region_confirmed === null
        ? {}
        : {
            regionConfirmedByUser: optionalBooleanFromInteger(
              row.region_confirmed,
            ),
          }),
      ...(row.guidance_payload === null
        ? {}
        : {
            captureGuidance: JSON.parse(
              row.guidance_payload,
            ) as CaptureRecord["captureGuidance"],
          }),
      quality: JSON.parse(row.quality_payload) as CaptureRecord["quality"],
      ...(row.sample_placeholder === null
        ? {}
        : {
            samplePlaceholder: optionalBooleanFromInteger(
              row.sample_placeholder,
            ),
          }),
    },
  }));

  const analysisRows = await database.getAllAsync<{
    capture_view_id: string;
    payload: string;
  }>("SELECT capture_view_id, payload FROM analyses ORDER BY capture_view_id");
  const analyses = analysisRows.map((row) => ({
    captureId: row.capture_view_id,
    analysis: JSON.parse(row.payload) as AnalysisResult,
  }));

  const observationRows = await database.getAllAsync<ObservationDatabaseRow>(
    `SELECT id, region, mesh_id, uv_x, uv_y, asset_version, user_confirmed,
            first_observed_at, status, capture_ids_payload
       FROM observations ORDER BY ordinal`,
  );
  const observations: ObservationPin[] = observationRows.map((row) => ({
    id: row.id,
    region: row.region as ObservationPin["region"],
    meshId: row.mesh_id,
    uvX: row.uv_x,
    uvY: row.uv_y,
    assetVersion: row.asset_version,
    userConfirmed: booleanFromInteger(row.user_confirmed),
    firstObservedAt: row.first_observed_at,
    status: row.status as ObservationPin["status"],
    captureIds: JSON.parse(row.capture_ids_payload) as string[],
  }));

  const comparisonRows = await database.getAllAsync<{
    id: string;
    payload: string;
  }>("SELECT id, payload FROM comparisons ORDER BY ordinal");
  const comparisons = comparisonRows.map((row) => ({
    id: row.id,
    comparison: JSON.parse(row.payload) as ComparisonResult,
  }));

  const reportRows = await database.getAllAsync<ReportDatabaseRow>(
    `SELECT id, created_at, encrypted_uri, session_id
       FROM reports ORDER BY ordinal`,
  );
  const reports: ReportRecord[] = reportRows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    encryptedUri: row.encrypted_uri,
    sessionId: row.session_id,
  }));

  return {
    statePresent: true,
    consentedAt: metadata.get("consented_at") ?? null,
    activeSessionId: metadata.get("active_session_id") ?? null,
    updatedAt: metadata.get("updated_at") ?? new Date(0).toISOString(),
    settings,
    profile,
    sessions,
    captureSets,
    captureViews,
    analyses,
    observations,
    comparisons,
    reports,
    tombstones: await readTombstones(database),
  };
}

export async function loadPersistedState(): Promise<PersistedAppState | null> {
  const database = await getDatabase();
  const rows = await readNormalizedRows(database);
  return rows ? restorePersistedState(rows) : null;
}

export function queuePersistedState(state: PersistedAppState): Promise<void> {
  // Freeze the queued snapshot so later Zustand mutations cannot change it.
  const payload = JSON.stringify(state);
  const operation = writeQueue.then(async () => {
    const snapshot = parsePersistedAppState(JSON.parse(payload) as unknown);
    const database = await getDatabase();
    await database.withTransactionAsync(async () => {
      const rows = reconcileNormalizedRows(
        await readEntityIdentities(database),
        await readTombstones(database),
        snapshot,
        new Date().toISOString(),
      );
      await replaceNormalizedRows(database, rows);
    });
  });
  writeQueue = operation.catch(() => {
    console.warn("[STOMA3D_STORAGE_WRITE_FAILED]");
  });
  return operation;
}

export interface CloudOutboxRecord {
  id: string;
  entityType: string;
  entityId: string;
  operation: "upsert" | "delete";
  payload: string;
  createdAt: string;
  attemptCount: number;
}

export interface CloudOutboxInsert extends Omit<
  CloudOutboxRecord,
  "attemptCount"
> {}

function queueDatabaseWrite(
  task: (database: SQLite.SQLiteDatabase) => Promise<void>,
): Promise<void> {
  const operation = writeQueue.then(async () => task(await getDatabase()));
  writeQueue = operation.catch(() => {
    console.warn("[STOMA3D_CLOUD_STORAGE_WRITE_FAILED]");
  });
  return operation;
}

const CAPTURE_DRAFTS_METADATA_KEY = "capture_drafts_v1";

async function readCaptureDrafts(
  database: DatabaseConnection,
): Promise<CaptureDraft[]> {
  const row = await database.getFirstAsync<MetadataRow>(
    "SELECT key, value FROM metadata WHERE key = ?",
    CAPTURE_DRAFTS_METADATA_KEY,
  );
  return parseCaptureDrafts(
    row?.value ? (JSON.parse(row.value) as unknown) : null,
  );
}

export async function loadCaptureDrafts(): Promise<CaptureDraft[]> {
  await writeQueue;
  return readCaptureDrafts(await getDatabase());
}

function updateCaptureDrafts(
  change: (drafts: CaptureDraft[]) => CaptureDraft[],
): Promise<CaptureDraft[]> {
  let updated: CaptureDraft[] = [];
  return queueDatabaseWrite(async (database) => {
    await database.withTransactionAsync(async () => {
      updated = parseCaptureDrafts({
        schemaVersion: 1,
        drafts: change(await readCaptureDrafts(database)),
      });
      await setMetadata(
        database,
        CAPTURE_DRAFTS_METADATA_KEY,
        JSON.stringify({ schemaVersion: 1, drafts: updated }),
      );
    });
  }).then(() => updated);
}

/** SQLCipher protects draft metadata; photo bytes stay in the existing vault. */
export function storeCaptureDraft(
  draft: CaptureDraft,
): Promise<CaptureDraft[]> {
  return updateCaptureDrafts((drafts) => upsertCaptureDraft(drafts, draft));
}

export function deleteStoredCaptureDraft(id: string): Promise<CaptureDraft[]> {
  return updateCaptureDrafts((drafts) =>
    drafts.filter((draft) => draft.id !== id),
  );
}

/**
 * Adds durable cloud operations and advances their local fingerprints in one
 * SQLCipher transaction. A crash can therefore neither lose a change nor
 * manufacture a partially staged operation.
 */
export function stageCloudOutbox(
  operations: readonly CloudOutboxInsert[],
  metadataUpdates: Readonly<Record<string, string | null>>,
): Promise<void> {
  return queueDatabaseWrite(async (database) => {
    await database.withTransactionAsync(async () => {
      await executeMany(
        database,
        `INSERT INTO outbox (
           id, entity_type, entity_id, operation, payload, created_at, attempt_count
         ) VALUES (?, ?, ?, ?, ?, ?, 0)
         ON CONFLICT(id) DO NOTHING`,
        operations.map((item) => [
          item.id,
          item.entityType,
          item.entityId,
          item.operation,
          item.payload,
          item.createdAt,
        ]),
      );
      for (const [key, value] of Object.entries(metadataUpdates)) {
        await setMetadata(database, key, value);
      }
    });
  });
}

export async function readCloudOutbox(
  limit = 100,
): Promise<CloudOutboxRecord[]> {
  await writeQueue;
  const database = await getDatabase();
  const rows = await database.getAllAsync<{
    id: string;
    entity_type: string;
    entity_id: string;
    operation: string;
    payload: string | null;
    created_at: string;
    attempt_count: number;
  }>(
    `SELECT id, entity_type, entity_id, operation, payload, created_at, attempt_count
       FROM outbox ORDER BY created_at, id LIMIT ?`,
    Math.max(1, Math.min(100, limit)),
  );
  return rows.flatMap((row) =>
    row.payload && (row.operation === "upsert" || row.operation === "delete")
      ? [
          {
            id: row.id,
            entityType: row.entity_type,
            entityId: row.entity_id,
            operation: row.operation,
            payload: row.payload,
            createdAt: row.created_at,
            attemptCount: row.attempt_count,
          },
        ]
      : [],
  );
}

export function acknowledgeCloudOutbox(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return Promise.resolve();
  return queueDatabaseWrite(async (database) => {
    await database.withTransactionAsync(async () => {
      await executeMany(
        database,
        "DELETE FROM outbox WHERE id = ?",
        ids.map((id) => [id]),
      );
    });
  });
}

export function markCloudOutboxAttempt(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return Promise.resolve();
  return queueDatabaseWrite(async (database) => {
    await database.withTransactionAsync(async () => {
      await executeMany(
        database,
        "UPDATE outbox SET attempt_count = attempt_count + 1 WHERE id = ?",
        ids.map((id) => [id]),
      );
    });
  });
}

export async function cloudMetadata(
  prefix: string,
): Promise<Record<string, string | null>> {
  await writeQueue;
  const database = await getDatabase();
  const rows = await database.getAllAsync<MetadataRow>(
    "SELECT key, value FROM metadata WHERE key LIKE ? ORDER BY key",
    `${prefix}%`,
  );
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

export function updateCloudMetadata(
  updates: Readonly<Record<string, string | null>>,
): Promise<void> {
  return queueDatabaseWrite(async (database) => {
    await database.withTransactionAsync(async () => {
      for (const [key, value] of Object.entries(updates)) {
        await setMetadata(database, key, value);
      }
    });
  });
}

export function bindCloudAccount(userId: string): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    let changed = false;
    queueDatabaseWrite(async (database) => {
      await database.withTransactionAsync(async () => {
        const existing = await database.getFirstAsync<{ value: string | null }>(
          "SELECT value FROM metadata WHERE key = 'cloud.account_id'",
        );
        changed = Boolean(existing?.value && existing.value !== userId);
        if (changed) {
          await database.execAsync(`
            DELETE FROM outbox;
            DELETE FROM metadata WHERE key LIKE 'cloud.%';
          `);
          await setMetadata(database, "cloud.account_rebind_pending", "1");
        }
        await setMetadata(database, "cloud.account_id", userId);
      });
    })
      .then(() => resolve(changed))
      .catch(reject);
  });
}

export async function cloudAccountRebindPending(): Promise<boolean> {
  const metadata = await cloudMetadata("cloud.account_rebind_pending");
  return metadata["cloud.account_rebind_pending"] === "1";
}

export function confirmCloudAccountRebind(): Promise<void> {
  return updateCloudMetadata({ "cloud.account_rebind_pending": null });
}

export function clearCloudState(): Promise<void> {
  return queueDatabaseWrite(async (database) => {
    await database.withTransactionAsync(async () => {
      await database.execAsync(`
        DELETE FROM outbox;
        DELETE FROM metadata WHERE key LIKE 'cloud.%';
      `);
    });
  });
}

async function clearEveryStorageTable(
  database: SQLite.SQLiteDatabase,
): Promise<void> {
  await database.withTransactionAsync(async () => {
    await database.execAsync(
      `${NORMALIZED_STORAGE_CLEAR_ORDER.map((table) => `DELETE FROM ${table};`).join("\n")}\nDROP TABLE IF EXISTS app_state;`,
    );
  });
}

export async function deleteAllLocalDataAndRotateKeys(): Promise<void> {
  const failures: string[] = [];
  try {
    await writeQueue;
  } catch {
    failures.push("WRITE_QUEUE");
  }
  if (databasePromise) {
    const pendingDatabase = databasePromise;
    databasePromise = null;
    try {
      const database = await pendingDatabase;
      try {
        await clearEveryStorageTable(database);
      } catch {
        failures.push("DB_CLEAR");
      }
      await database.closeAsync();
    } catch {
      failures.push("DB_CLOSE");
    }
  }
  writeQueue = Promise.resolve();
  try {
    await SQLite.deleteDatabaseAsync(DATABASE_NAME);
  } catch {
    failures.push("DB_DELETE");
  }
  try {
    await SecureStore.deleteItemAsync(DATABASE_KEY_NAME);
  } catch {
    failures.push("DB_KEY_DELETE");
  }
  try {
    await deleteProtectedFilesAndRotateKey();
  } catch {
    failures.push("VAULT_RESET");
  }
  try {
    await databaseKey();
  } catch {
    failures.push("DB_KEY_ROTATE");
  }
  if (failures.length > 0) {
    throw new Error(`STOMA3D_LOCAL_RESET_INCOMPLETE:${failures.join(",")}`);
  }
}
