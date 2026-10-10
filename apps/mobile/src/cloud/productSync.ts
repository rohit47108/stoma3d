import { cloudMetadata, updateCloudMetadata } from "@/lib/storage";
import type { PersistedAppState } from "@/types";

import {
  clearPreparedAsset,
  prepareCaptureAsset,
  uploadPreparedAsset,
} from "./assetTransfer";
import { PlatformClient } from "./client";
import type { AnalysisRun, JobResponse } from "./contracts";
import {
  localCaptureSetId,
  localComparisonId,
  syncMetadataComponent,
} from "./syncModel";

export type CloudResourceKind =
  | "scan_session"
  | "capture_set"
  | "capture_view"
  | "analysis_job"
  | "lesion"
  | "match_proposal"
  | "match_decision"
  | "comparison_job";

export interface CloudResourceMapping {
  kind: CloudResourceKind;
  localId: string;
  remoteId: string;
  assetId?: string;
  sha256?: string;
  byteSize?: number;
  mimeType?: string;
  uploaded?: boolean;
  updatedAt: string;
}

export interface ProductSyncResult {
  sessionsCreated: number;
  captureSetsCreated: number;
  capturesUploaded: number;
  analysisJobsCreated: number;
  lesionsCreated: number;
  matchProposalsCreated: number;
  matchDecisionsRecorded: number;
  comparisonJobsCreated: number;
}

function retainedAssetProtocol(
  protocol: PersistedAppState["sessions"][number]["protocol"],
): PersistedAppState["sessions"][number]["protocol"] {
  // A guided sweep is transient. Only its three sanitized still frames are
  // retained and uploaded; the E2EE timeline preserves their sweep provenance.
  return protocol;
}

export function cloudMappingKey(
  kind: CloudResourceKind,
  localId: string,
): string {
  return `cloud.map.${kind}.${syncMetadataComponent(localId)}`;
}

function parseMapping(value: string | null): CloudResourceMapping | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<CloudResourceMapping>;
    if (
      typeof parsed.kind !== "string" ||
      typeof parsed.localId !== "string" ||
      typeof parsed.remoteId !== "string" ||
      typeof parsed.updatedAt !== "string"
    ) {
      return null;
    }
    return parsed as CloudResourceMapping;
  } catch {
    return null;
  }
}

async function persistMapping(mapping: CloudResourceMapping): Promise<void> {
  await updateCloudMetadata({
    [cloudMappingKey(mapping.kind, mapping.localId)]: JSON.stringify(mapping),
  });
}

function deterministicKey(kind: string, localId: string): string {
  const safe = localId.replace(/[^A-Za-z0-9._:-]/g, "_");
  return `${kind}:${safe}`.slice(0, 128).padEnd(16, "0");
}

function mappedAssetPointer(mapping: CloudResourceMapping) {
  if (
    !mapping.uploaded ||
    !mapping.assetId ||
    !mapping.sha256 ||
    !mapping.byteSize ||
    !mapping.mimeType
  ) {
    throw new Error("Finish syncing both comparison images first.");
  }
  return {
    assetId: mapping.assetId,
    sha256: mapping.sha256,
    mediaType: mapping.mimeType,
    sizeBytes: mapping.byteSize,
  };
}

function priorAnalysisMetadata(
  state: PersistedAppState,
  localCaptureId: string,
  remoteCaptureId: string,
) {
  const analysis = state.analyses[localCaptureId];
  if (!analysis || analysis.analysisOrigin !== "live_model") return null;
  return {
    captureId: remoteCaptureId,
    region: analysis.region,
    status: analysis.status,
    analysisOrigin: "live_model" as const,
    qualityAccepted: analysis.quality.accepted,
    candidateNormalizedArea: analysis.descriptors?.normalizedArea ?? null,
    modelVersions: analysis.modelVersions,
  };
}

function comparisonJobPayload(options: {
  state: PersistedAppState;
  comparison: PersistedAppState["comparisons"][number];
  baselineMapping: CloudResourceMapping;
  currentMapping: CloudResourceMapping;
}) {
  const baseline = priorAnalysisMetadata(
    options.state,
    options.comparison.baselineCaptureId,
    options.baselineMapping.remoteId,
  );
  const current = priorAnalysisMetadata(
    options.state,
    options.comparison.currentCaptureId,
    options.currentMapping.remoteId,
  );
  if (!baseline || !current) return null;
  return {
    kind: "comparison",
    contractVersion: "1.1.0",
    baselineCaptureId: options.baselineMapping.remoteId,
    currentCaptureId: options.currentMapping.remoteId,
    baselineImage: mappedAssetPointer(options.baselineMapping),
    currentImage: mappedAssetPointer(options.currentMapping),
    region: options.comparison.region,
    userConfirmedMatch: true,
    inputOrigin: "live_capture",
    baselineAnalysis: baseline,
    currentAnalysis: current,
  };
}

async function remoteObservationForCapture(options: {
  client: PlatformClient;
  localCaptureId: string;
  region: PersistedAppState["captures"][number]["region"];
  mappings: Map<string, CloudResourceMapping>;
  jobs: Map<string, Promise<JobResponse>>;
  runs: Map<string, Promise<AnalysisRun>>;
  assertCurrent: () => void;
}): Promise<AnalysisRun["observations"][number] | null> {
  const jobMapping = options.mappings.get(
    `analysis_job:${options.localCaptureId}`,
  );
  const captureMapping = options.mappings.get(
    `capture_view:${options.localCaptureId}`,
  );
  if (!jobMapping || !captureMapping) return null;
  let jobPromise = options.jobs.get(jobMapping.remoteId);
  if (!jobPromise) {
    options.assertCurrent();
    jobPromise = options.client.job(jobMapping.remoteId);
    options.jobs.set(jobMapping.remoteId, jobPromise);
  }
  const job = await jobPromise;
  options.assertCurrent();
  if (job.status !== "succeeded" || job.outcome !== "complete") return null;
  for (const outputId of job.outputRefs) {
    let runPromise = options.runs.get(outputId);
    if (!runPromise) {
      options.assertCurrent();
      runPromise = options.client.analysisRun(outputId);
      options.runs.set(outputId, runPromise);
    }
    let run: AnalysisRun;
    try {
      run = await runPromise;
    } catch {
      // Analysis jobs may also name non-analysis artifacts in outputRefs.
      options.assertCurrent();
      continue;
    }
    options.assertCurrent();
    const observation = run.observations.find(
      (value) =>
        value.captureViewId === captureMapping.remoteId &&
        value.region === options.region,
    );
    if (observation) return observation;
  }
  return null;
}

export async function readCloudResourceMappings(): Promise<
  CloudResourceMapping[]
> {
  const metadata = await cloudMetadata("cloud.map.");
  return Object.values(metadata).flatMap((value) => {
    const parsed = parseMapping(value);
    return parsed ? [parsed] : [];
  });
}

export async function syncProductResources(options: {
  client: PlatformClient;
  state: PersistedAppState;
  deviceId: string;
  consentRecordId: string;
  assertCurrent: () => void;
}): Promise<ProductSyncResult> {
  const checked = async <Value>(work: () => Promise<Value>): Promise<Value> => {
    options.assertCurrent();
    const value = await work();
    options.assertCurrent();
    return value;
  };
  const saveMapping = (mapping: CloudResourceMapping) =>
    checked(() => persistMapping(mapping));
  options.assertCurrent();
  const mappings = new Map(
    (await readCloudResourceMappings()).map((value) => [
      `${value.kind}:${value.localId}`,
      value,
    ]),
  );
  options.assertCurrent();
  const result: ProductSyncResult = {
    sessionsCreated: 0,
    captureSetsCreated: 0,
    capturesUploaded: 0,
    analysisJobsCreated: 0,
    lesionsCreated: 0,
    matchProposalsCreated: 0,
    matchDecisionsRecorded: 0,
    comparisonJobsCreated: 0,
  };

  for (const session of options.state.sessions) {
    const key = `scan_session:${session.id}`;
    if (mappings.has(key)) continue;
    const remote = await checked(() =>
      options.client.createScanSession(
        {
          protocol: retainedAssetProtocol(session.protocol),
          deviceId: options.deviceId,
          consentRecordId: options.consentRecordId,
        },
        deterministicKey("scan-session", session.id),
      ),
    );
    const mapping: CloudResourceMapping = {
      kind: "scan_session",
      localId: session.id,
      remoteId: remote.scanSessionId,
      updatedAt: new Date().toISOString(),
    };
    await saveMapping(mapping);
    mappings.set(key, mapping);
    result.sessionsCreated += 1;
  }

  const captureGroups = new Map<string, PersistedAppState["captures"]>();
  for (const capture of options.state.captures) {
    const id = localCaptureSetId(capture.sessionId, capture.region);
    captureGroups.set(id, [...(captureGroups.get(id) ?? []), capture]);
  }

  for (const [localSetId, captures] of captureGroups) {
    const first = captures[0];
    if (!first) continue;
    const session = options.state.sessions.find(
      (value) => value.id === first.sessionId,
    );
    const remoteSession = mappings.get(`scan_session:${first.sessionId}`);
    if (!session || !remoteSession) continue;
    const key = `capture_set:${localSetId}`;
    if (!mappings.has(key)) {
      const remote = await checked(() =>
        options.client.createCaptureSet(
          remoteSession.remoteId,
          {
            region: first.region,
            protocol: retainedAssetProtocol(session.protocol),
          },
          deterministicKey("capture-set", localSetId),
        ),
      );
      const mapping: CloudResourceMapping = {
        kind: "capture_set",
        localId: localSetId,
        remoteId: remote.captureSetId,
        updatedAt: new Date().toISOString(),
      };
      await saveMapping(mapping);
      mappings.set(key, mapping);
      result.captureSetsCreated += 1;
    }
    const remoteSet = mappings.get(key);
    if (!remoteSet) continue;
    const ordered = [...captures].sort(
      (left, right) =>
        left.capturedAt.localeCompare(right.capturedAt) ||
        left.angle.localeCompare(right.angle),
    );
    for (const [ordinal, capture] of ordered.entries()) {
      const captureKey = `capture_view:${capture.id}`;
      let mapping = mappings.get(captureKey);
      if (mapping?.uploaded) continue;
      if (!capture.encryptedUri && !mapping) continue;
      options.assertCurrent();
      const asset = await prepareCaptureAsset(capture);
      try {
        options.assertCurrent();
        if (!mapping) {
          const response = await checked(() =>
            options.client.createCaptureView(
              remoteSet.remoteId,
              {
                angle: capture.angle,
                anatomicalSite: null,
                asset: {
                  mediaKind: "image",
                  mimeType: asset.mimeType,
                  byteSize: asset.byteSize,
                  sha256: asset.sha256,
                  widthPx: asset.widthPx,
                  heightPx: asset.heightPx,
                  durationMs: null,
                  inputOrigin: capture.inputOrigin,
                  encrypted: true,
                  retentionExpiresAt: null,
                },
                sourceVideoAssetId: null,
                qualityAccepted: true,
                qualityReasons: capture.quality.reasons,
                ordinal,
                capturedAt: capture.capturedAt,
                makePrimary:
                  capture.angle === "primary" || capture.angle === "straight",
              },
              deterministicKey("capture-view", capture.id),
            ),
          );
          const remoteView = response.views.find(
            (view) =>
              view.ordinal === ordinal && view.asset.sha256 === asset.sha256,
          );
          if (!remoteView) {
            throw new Error(
              "The cloud capture response omitted the uploaded view.",
            );
          }
          mapping = {
            kind: "capture_view",
            localId: capture.id,
            remoteId: remoteView.captureViewId,
            assetId: remoteView.asset.assetId,
            sha256: asset.sha256,
            byteSize: asset.byteSize,
            mimeType: asset.mimeType,
            uploaded: remoteView.asset.uploadStatus === "available",
            updatedAt: new Date().toISOString(),
          };
          await saveMapping(mapping);
          mappings.set(captureKey, mapping);
        }
        if (!mapping.assetId) {
          throw new Error("The cloud asset reference is missing.");
        }
        if (
          mapping.sha256 !== asset.sha256 ||
          mapping.byteSize !== asset.byteSize
        ) {
          throw new Error(
            "The local capture no longer matches its cloud record.",
          );
        }
        if (!mapping.uploaded) {
          const assetId = mapping.assetId;
          const ticket = await checked(() =>
            options.client.requestAssetUpload(assetId),
          );
          await checked(() => uploadPreparedAsset({ ticket, asset }));
          const finalized = await checked(() =>
            options.client.finalizeAssetUpload(assetId),
          );
          if (
            !finalized.checksumVerified ||
            finalized.asset.sha256 !== asset.sha256 ||
            finalized.asset.uploadStatus !== "available"
          ) {
            throw new Error("The cloud asset checksum was not verified.");
          }
          mapping = {
            ...mapping,
            uploaded: true,
            updatedAt: new Date().toISOString(),
          };
          await saveMapping(mapping);
          mappings.set(captureKey, mapping);
          result.capturesUploaded += 1;
        }
      } finally {
        clearPreparedAsset(asset);
      }
    }

    const allUploaded = ordered.every(
      (capture) =>
        mappings.get(`capture_view:${capture.id}`)?.uploaded === true,
    );
    const acceptedAngles = new Set(ordered.map((capture) => capture.angle));
    const captureSetComplete =
      session.protocol === "standard_eight_region"
        ? acceptedAngles.has("primary") || acceptedAngles.has("straight")
        : ["straight", "left_oblique", "right_oblique"].every((angle) =>
            acceptedAngles.has(angle as (typeof ordered)[number]["angle"]),
          );
    const primary = ordered.find(
      (capture) => capture.angle === "primary" || capture.angle === "straight",
    );
    const primaryMapping = primary
      ? mappings.get(`capture_view:${primary.id}`)
      : undefined;
    const jobKey = primary ? `analysis_job:${primary.id}` : "";
    if (
      allUploaded &&
      captureSetComplete &&
      primary &&
      primary.inputOrigin === "live_capture" &&
      primaryMapping?.assetId &&
      primaryMapping.sha256 &&
      primaryMapping.mimeType &&
      primaryMapping.byteSize &&
      primaryMapping.byteSize <= 1_750_000 &&
      !mappings.has(jobKey)
    ) {
      const job = await checked(() =>
        options.client.createJob(
          "analysis",
          {
            kind: "analysis",
            contractVersion: "1.1.0",
            captureId: primaryMapping.remoteId,
            image: {
              assetId: primaryMapping.assetId,
              sha256: primaryMapping.sha256,
              mediaType: primaryMapping.mimeType,
              sizeBytes: primaryMapping.byteSize,
            },
            selectedRegion: primary.region,
            requestedHeads: [
              "segmentation",
              "anatomy",
              "appearance",
              "disease_research",
              "lesion_reidentification",
              "quality_control",
              "oral_tissue_segmentation",
              "out_of_distribution",
              "secondary_segmentation",
            ],
            inputOrigin: "live_capture",
            ...(primary.calibrationRequested
              ? {
                  calibration: {
                    cardVersion: "stoma3d-calibration-v1",
                    markerId: 17,
                    markerSideMm: 20,
                    planeConfirmed: primary.calibrationPlaneConfirmed === true,
                  },
                }
              : {}),
          },
          deterministicKey("analysis-job", localSetId),
        ),
      );
      const mapping: CloudResourceMapping = {
        kind: "analysis_job",
        localId: primary.id,
        remoteId: job.jobId,
        updatedAt: new Date().toISOString(),
      };
      await saveMapping(mapping);
      mappings.set(jobKey, mapping);
      result.analysisJobsCreated += 1;
    }
  }

  const jobCache = new Map<string, Promise<JobResponse>>();
  const runCache = new Map<string, Promise<AnalysisRun>>();
  const capturesById = new Map(
    options.state.captures.map((capture) => [capture.id, capture]),
  );
  for (const pin of [...options.state.pins].sort((left, right) =>
    left.firstObservedAt.localeCompare(right.firstObservedAt),
  )) {
    if (!pin.userConfirmed || mappings.has(`lesion:${pin.id}`)) continue;
    const pinCaptures = pin.captureIds
      .map((captureId) => capturesById.get(captureId))
      .filter((capture) => capture !== undefined)
      .filter(
        (capture) =>
          capture.region === pin.region &&
          capture.inputOrigin === "live_capture",
      )
      .sort((left, right) => left.capturedAt.localeCompare(right.capturedAt));
    let firstObservation: AnalysisRun["observations"][number] | null = null;
    for (const capture of pinCaptures) {
      firstObservation = await remoteObservationForCapture({
        client: options.client,
        localCaptureId: capture.id,
        region: capture.region,
        mappings,
        jobs: jobCache,
        runs: runCache,
        assertCurrent: options.assertCurrent,
      });
      if (firstObservation) break;
    }
    if (!firstObservation) continue;
    const lesion = await checked(() =>
      options.client.createLesion(
        {
          firstObservationId: firstObservation.observationId,
          label: null,
        },
        deterministicKey("lesion", pin.id),
      ),
    );
    const lesionMapping: CloudResourceMapping = {
      kind: "lesion",
      localId: pin.id,
      remoteId: lesion.lesionId,
      updatedAt: new Date().toISOString(),
    };
    await saveMapping(lesionMapping);
    mappings.set(`lesion:${pin.id}`, lesionMapping);
    result.lesionsCreated += 1;
  }
  const orderedComparisons = [...options.state.comparisons].sort(
    (left, right) =>
      left.currentCaptureId.localeCompare(right.currentCaptureId),
  );
  for (const comparison of orderedComparisons) {
    if (
      comparison.userConfirmedMatch !== true ||
      comparison.inputOrigin !== "live_capture" ||
      comparison.analysisOrigin !== "live_model"
    ) {
      continue;
    }
    const comparisonId = localComparisonId(comparison);
    const baselineMapping = mappings.get(
      `capture_view:${comparison.baselineCaptureId}`,
    );
    const currentMapping = mappings.get(
      `capture_view:${comparison.currentCaptureId}`,
    );
    if (
      !baselineMapping?.uploaded ||
      !currentMapping?.uploaded ||
      !baselineMapping.assetId ||
      !currentMapping.assetId
    ) {
      continue;
    }
    const [baselineObservation, currentObservation] = await Promise.all([
      remoteObservationForCapture({
        client: options.client,
        localCaptureId: comparison.baselineCaptureId,
        region: comparison.region,
        mappings,
        jobs: jobCache,
        runs: runCache,
        assertCurrent: options.assertCurrent,
      }),
      remoteObservationForCapture({
        client: options.client,
        localCaptureId: comparison.currentCaptureId,
        region: comparison.region,
        mappings,
        jobs: jobCache,
        runs: runCache,
        assertCurrent: options.assertCurrent,
      }),
    ]);
    if (!baselineObservation || !currentObservation) continue;

    const proposalKey = `match_proposal:${comparisonId}`;
    let proposalMapping = mappings.get(proposalKey);
    const relatedPin = options.state.pins.find(
      (pin) =>
        pin.userConfirmed &&
        pin.captureIds.includes(comparison.baselineCaptureId) &&
        pin.captureIds.includes(comparison.currentCaptureId),
    );
    const candidateLesionId = relatedPin
      ? (mappings.get(`lesion:${relatedPin.id}`)?.remoteId ?? null)
      : null;
    if (!proposalMapping) {
      const hasAutomaticEvidence =
        comparison.candidateMatchScore !== null &&
        Object.keys(comparison.modelVersions).length > 0;
      const proposal = await checked(() =>
        options.client.createMatchProposal(
          {
            currentObservationId: currentObservation.observationId,
            candidatePriorObservationId: baselineObservation.observationId,
            candidateLesionId,
            proposalOrigin: hasAutomaticEvidence
              ? "automatic_model"
              : "user_selected",
            score: hasAutomaticEvidence ? comparison.candidateMatchScore : null,
            rank: hasAutomaticEvidence ? 1 : null,
            modelVersions: hasAutomaticEvidence ? comparison.modelVersions : {},
            expiresAt: null,
          },
          deterministicKey("match-proposal", comparisonId),
        ),
      );
      proposalMapping = {
        kind: "match_proposal",
        localId: comparisonId,
        remoteId: proposal.proposalId,
        updatedAt: new Date().toISOString(),
      };
      await saveMapping(proposalMapping);
      mappings.set(proposalKey, proposalMapping);
      result.matchProposalsCreated += 1;
    }

    const decisionKey = `match_decision:${comparisonId}`;
    if (!mappings.has(decisionKey)) {
      // This transmits the person's prior, explicit in-app confirmation. It is
      // never called for an automated suggestion or an unconfirmed pair.
      const decision = await checked(() =>
        options.client.decideMatchProposal(
          proposalMapping.remoteId,
          {
            decision: "confirmed",
            rationale: "Confirmed by the user after reviewing both images.",
          },
          deterministicKey("match-decision", comparisonId),
        ),
      );
      const decisionMapping: CloudResourceMapping = {
        kind: "match_decision",
        localId: comparisonId,
        remoteId: decision.decisionId,
        updatedAt: new Date().toISOString(),
      };
      await saveMapping(decisionMapping);
      mappings.set(decisionKey, decisionMapping);
      result.matchDecisionsRecorded += 1;
      if (relatedPin && decision.lesionId) {
        const lesionMapping: CloudResourceMapping = {
          kind: "lesion",
          localId: relatedPin.id,
          remoteId: decision.lesionId,
          updatedAt: new Date().toISOString(),
        };
        await saveMapping(lesionMapping);
        mappings.set(`lesion:${relatedPin.id}`, lesionMapping);
      }
    }

    const comparisonJobKey = `comparison_job:${comparisonId}`;
    if (
      mappings.has(comparisonJobKey) ||
      (baselineMapping.byteSize ?? Number.POSITIVE_INFINITY) > 1_750_000 ||
      (currentMapping.byteSize ?? Number.POSITIVE_INFINITY) > 1_750_000
    ) {
      continue;
    }
    const payload = comparisonJobPayload({
      state: options.state,
      comparison,
      baselineMapping,
      currentMapping,
    });
    if (!payload) continue;
    const job = await checked(() =>
      options.client.createJob(
        "comparison",
        payload,
        deterministicKey("comparison-job", comparisonId),
      ),
    );
    const jobMapping: CloudResourceMapping = {
      kind: "comparison_job",
      localId: comparisonId,
      remoteId: job.jobId,
      updatedAt: new Date().toISOString(),
    };
    await saveMapping(jobMapping);
    mappings.set(comparisonJobKey, jobMapping);
    result.comparisonJobsCreated += 1;
  }
  options.assertCurrent();
  return result;
}

export async function shareableCloudResources(
  jobs: readonly JobResponse[] = [],
): Promise<
  Array<{
    localId: string;
    resourceType: "scan_session" | "report";
    resourceId: string;
    createdAt: string | null;
  }>
> {
  const mappings = await readCloudResourceMappings();
  const scans = mappings.flatMap((mapping) => {
    if (mapping.kind === "scan_session") {
      return [
        {
          localId: mapping.localId,
          resourceType: "scan_session" as const,
          resourceId: mapping.remoteId,
          createdAt: mapping.updatedAt,
        },
      ];
    }
    return [];
  });
  const reports = jobs.flatMap((job) =>
    job.type === "report" &&
    job.status === "succeeded" &&
    job.outcome === "complete"
      ? job.outputRefs.map((reportId) => ({
          localId: `report:${reportId}`,
          resourceType: "report" as const,
          resourceId: reportId,
          createdAt: job.completedAt ?? job.createdAt,
        }))
      : [],
  );
  return [...scans, ...reports].sort(
    (left, right) =>
      (left.createdAt ?? "").localeCompare(right.createdAt ?? "") ||
      left.localId.localeCompare(right.localId),
  );
}
