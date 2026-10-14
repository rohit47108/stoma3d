import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";
import { fromByteArray, toByteArray } from "base64-js";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import {
  MOUTH_REGION_DETAILS,
  type AnalysisResult,
  type ComparisonResult,
} from "@stoma3d/contracts";

import { DISCLAIMER, ORAL_MAP_ASSET_VERSION } from "@/constants";
import { isReleasedModelOutput } from "@/lib/analysisPresentation";
import { evaluateBundledGuidance } from "@/lib/guidanceRules";
import {
  decryptToTemporaryFile,
  encryptFile,
  removeTemporaryFile,
} from "@/lib/secureFiles";
import { reportContainsSyntheticData } from "@/lib/reportPolicy";
import { calibrationForReport } from "@/lib/reportCalibration";
import {
  observationImageMarkup,
  oralObservationMapMarkup,
} from "@/lib/reportMarkup";
import {
  captureInputLabel,
  humanizeResultReason,
  observationStatusLabel,
} from "@/lib/resultCopy";
import { addReportPageFooters } from "@/lib/reportPdf";
import {
  beginReportTemporaryLease,
  removeReportTemporaryFile,
} from "@/lib/tempFiles";
import type {
  CaptureRecord,
  IntakeProfile,
  ObservationPin,
  ReportRecord,
  ScanSession,
} from "@/types";

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

// The report displays each photo at 170 CSS pixels. A 360-pixel copy stays
// sharp at print scale while keeping Android's PDF WebView within memory when
// all eight regions are present.
const REPORT_IMAGE_WIDTH = 360;
const REPORT_PRINT_TIMEOUT_MS = 60_000;
const SHARE_TEMPORARY_FILE_RETENTION_MS = 5 * 60_000;

interface ReportInput {
  session: ScanSession;
  captures: CaptureRecord[];
  comparisonCaptures?: CaptureRecord[];
  analyses: Record<string, AnalysisResult>;
  comparisons: ComparisonResult[];
  pins: ObservationPin[];
  profile: IntakeProfile | null;
  consentedAt: string | null;
}

async function reportImageBase64(capture: CaptureRecord): Promise<string> {
  if (!capture.encryptedUri) {
    throw new Error("The protected capture is unavailable.");
  }
  let decryptedUri: string | null = null;
  let resizedUri: string | null = null;
  try {
    decryptedUri = await decryptToTemporaryFile(
      capture.encryptedUri,
      capture.mimeType === "image/png" ? "png" : "jpg",
      `capture:${capture.id}`,
    );
    const resized = await manipulateAsync(
      decryptedUri,
      [{ resize: { width: REPORT_IMAGE_WIDTH } }],
      {
        compress: 0.55,
        format: SaveFormat.JPEG,
        base64: true,
      },
    );
    resizedUri = resized.uri;
    if (!resized.base64) {
      throw new Error("The report image could not be prepared.");
    }
    return resized.base64;
  } finally {
    await removeTemporaryFile(resizedUri);
    await removeTemporaryFile(decryptedUri);
  }
}

async function printReportToFile(html: string): Promise<{ uri: string }> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let expired = false;
  const releaseRenderer = beginReportTemporaryLease();
  try {
    return await Promise.race([
      Promise.resolve()
        .then(() => Print.printToFileAsync({ html, base64: false }))
        .then(async (printed) => {
          // Timing out does not cancel the native renderer. Discard its late
          // plaintext output instead of leaving it outside the encrypted vault.
          if (expired) {
            await removeReportTemporaryFile(printed.uri).catch(() => {
              console.warn("[STOMA3D_LATE_REPORT_CLEANUP_FAILED]");
            });
          }
          return printed;
        })
        .finally(releaseRenderer),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          expired = true;
          reject(new Error("Report creation took too long. Try again."));
        }, REPORT_PRINT_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function observationRows(input: ReportInput): Promise<string> {
  const rows: string[] = [];
  for (const capture of input.captures) {
    const analysis = input.analyses[capture.id];
    const label =
      MOUTH_REGION_DETAILS.find((region) => region.id === capture.region)
        ?.label ?? capture.region;
    let image = "";
    if (capture.encryptedUri) {
      try {
        const base64 = await reportImageBase64(capture);
        image = observationImageMarkup({
          base64,
          mimeType: "image/jpeg",
          label,
          candidateMask: analysis?.candidateMask,
        });
      } catch {
        image = '<div class="image-missing">Protected image unavailable</div>';
      }
    } else {
      image =
        '<div class="image-missing">Sample coverage marker - no image stored</div>';
    }
    const analysisStatus =
      analysis?.status === "complete" && !analysis.candidateMask
        ? "completed; no candidate outline returned"
        : (analysis?.status ?? "not analyzed");
    const qualityAcceptance = analysis
      ? analysis.quality.accepted
        ? "Accepted"
        : `Rejected${analysis.quality.reasons.length ? `: ${analysis.quality.reasons.map(humanizeResultReason).join(" ")}` : ""}`
      : capture.quality.accepted
        ? "Accepted locally; analysis unavailable"
        : `Rejected locally${capture.quality.reasons.length ? `: ${capture.quality.reasons.map(humanizeResultReason).join(" ")}` : ""}`;
    const anatomyAcceptance = analysis?.anatomyPrediction.supported
      ? analysis.anatomyPrediction.selectedRegionMatches
        ? `Accepted (${Math.round(analysis.anatomyPrediction.confidence * 100)}% confidence)`
        : "The supported anatomy check did not match the selected region"
      : "Unavailable; no released anatomy model ran";
    const limitations = analysis?.uncertainty.limitations.length
      ? analysis.uncertainty.limitations
          .map((limitation) => escapeHtml(limitation))
          .join("<br />")
      : "Unavailable";
    const modelVersions = analysis
      ? Object.entries(analysis.modelVersions)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(
            ([model, version]) =>
              `${escapeHtml(model)}: ${escapeHtml(version)}`,
          )
          .join("<br />") || "None recorded"
      : "Unavailable";
    const boundingBox = analysis?.candidateMask
      ? analysis.candidateMask.boundingBox
          .map((value) => value.toFixed(3))
          .join(", ")
      : "Unavailable";
    const appearance =
      isReleasedModelOutput(analysis?.appearanceOutput) &&
      analysis.appearanceOutput.topLabel
        ? `${analysis.appearanceOutput.topLabel.replaceAll("_", " ")} (${Math.round((analysis.appearanceOutput.confidence ?? 0) * 100)}% confidence)`
        : null;
    const additionalAnalysis =
      isReleasedModelOutput(analysis?.diseaseResearchOutput) &&
      analysis.diseaseResearchOutput.topLabel
        ? `${analysis.diseaseResearchOutput.topLabel.replaceAll("_", " ")} (${Math.round((analysis.diseaseResearchOutput.confidence ?? 0) * 100)}% confidence)`
        : null;
    const optionalAnalysisMarkup = [
      appearance
        ? `<p><strong>Appearance pattern:</strong> ${escapeHtml(appearance)}</p>`
        : "",
      additionalAnalysis
        ? `<p><strong>Additional image pattern analysis:</strong> ${escapeHtml(additionalAnalysis)}</p>`
        : "",
    ].join("");
    const calibration = calibrationForReport(capture);
    const calibrationMarkup =
      calibration.status === "valid"
        ? `<p><strong>Physical size (${calibration.measurementLabel}):</strong> width ${calibration.estimatedWidthMm === null ? "unavailable" : `${calibration.estimatedWidthMm.toFixed(2)} mm`}; height ${calibration.estimatedHeightMm === null ? "unavailable" : `${calibration.estimatedHeightMm.toFixed(2)} mm`}; area ${calibration.estimatedAreaMm2 === null ? "unavailable" : `${calibration.estimatedAreaMm2.toFixed(2)} mm²`}</p>
          <p><strong>Calibration evidence:</strong> card ${escapeHtml(calibration.cardVersion)}; marker ${escapeHtml(calibration.markerId)}; reference width ${calibration.referenceWidthMm.toFixed(1)} mm; scale ${calibration.millimetersPerPixel.toFixed(5)} mm/pixel; confidence ${Math.round(calibration.confidence * 100)}%; calibrated ${escapeHtml(new Date(calibration.calibratedAt).toLocaleString())}</p>
          <p><strong>Calibration versions:</strong><br />${Object.entries(
            calibration.modelVersions,
          )
            .sort(([left], [right]) => left.localeCompare(right))
            .map(
              ([name, version]) =>
                `${escapeHtml(name)}: ${escapeHtml(version)}`,
            )
            .join("<br />")}</p>`
        : calibration.status === "invalid" ||
            calibration.status === "unavailable"
          ? `<p><strong>Physical calibration:</strong> Millimeter estimates suppressed. ${calibration.gateReasons.length ? `Gate reasons: ${calibration.gateReasons.map(humanizeResultReason).map(escapeHtml).join(" ")}` : "Required calibration evidence was unavailable."}</p>`
          : "<p><strong>Physical calibration:</strong> Not attempted; millimeter estimates unavailable.</p>";
    rows.push(`
      <section class="observation">
        <div>${image}</div>
        <div>
          <h3>${escapeHtml(label)}</h3>
          <p><strong>Captured:</strong> ${escapeHtml(new Date(capture.capturedAt).toLocaleString())}</p>
          <p><strong>Input:</strong> ${escapeHtml(captureInputLabel(capture))}</p>
          <p><strong>Analysis:</strong> ${escapeHtml(analysis?.analysisOrigin ?? "Not analyzed")}</p>
          <p><strong>Analysis status:</strong> ${escapeHtml(analysisStatus)}</p>
          <p><strong>Quality acceptance:</strong> ${escapeHtml(qualityAcceptance)}</p>
          <p><strong>Anatomy acceptance:</strong> ${escapeHtml(anatomyAcceptance)}</p>
          <p><strong>Approximate normalized area:</strong> ${analysis?.descriptors ? `${(analysis.descriptors.normalizedArea * 100).toFixed(1)}%` : "Unavailable"}</p>
          ${calibrationMarkup}
          <p><strong>Approximate normalized mask box (x, y, width, height):</strong> ${escapeHtml(boundingBox)}</p>
          <p><strong>Shape descriptors:</strong> ${analysis?.descriptors ? `perimeter ${analysis.descriptors.perimeter.toFixed(3)}; border irregularity ${analysis.descriptors.borderIrregularity.toFixed(3)}` : "Unavailable"}</p>
          <p><strong>Color descriptors:</strong> ${analysis?.descriptors ? `redness ${analysis.descriptors.meanRedness.toFixed(3)}; brightness ${analysis.descriptors.meanBrightness.toFixed(3)}` : "Unavailable"}</p>
          <p><strong>Texture contrast:</strong> ${analysis?.descriptors ? analysis.descriptors.textureContrast.toFixed(3) : "Unavailable"}</p>
          ${optionalAnalysisMarkup}
          <p><strong>Model confidence:</strong> ${analysis?.status === "complete" ? `${Math.round(analysis.uncertainty.overallConfidence * 100)}%` : "Unavailable; no completed learned analysis"}</p>
          <p><strong>Dataset similarity:</strong> ${analysis?.uncertainty.datasetSimilarity === null || analysis?.uncertainty.datasetSimilarity === undefined ? "Not assessed; no released out-of-distribution model" : `${Math.round(analysis.uncertainty.datasetSimilarity * 100)}%`}</p>
          <p><strong>Model agreement:</strong> ${analysis?.uncertainty.modelAgreement === null || analysis?.uncertainty.modelAgreement === undefined ? "Not assessed; no released independent ensemble" : `${Math.round(analysis.uncertainty.modelAgreement * 100)}%`}</p>
          <p><strong>Uncertainty and limitations:</strong><br />${limitations}</p>
          <p><strong>Model versions:</strong><br />${modelVersions}</p>
        </div>
      </section>`);
  }
  return rows.join("\n");
}

function displayValue(value: string | undefined): string {
  return escapeHtml(value?.trim() || "Not provided");
}

function comparisonRows(input: ReportInput): string {
  if (input.comparisons.length === 0) {
    return "<p>No user-confirmed comparisons are recorded for this session.</p>";
  }
  const capturesById = new Map(
    (input.comparisonCaptures ?? input.captures).map((capture) => [
      capture.id,
      capture,
    ]),
  );
  return input.comparisons
    .map((comparison) => {
      const label =
        MOUTH_REGION_DETAILS.find((region) => region.id === comparison.region)
          ?.label ?? comparison.region;
      const baseline = capturesById.get(comparison.baselineCaptureId);
      const current = capturesById.get(comparison.currentCaptureId);
      const change =
        comparison.comparable && comparison.normalizedChange !== null
          ? `${(comparison.normalizedChange * 100).toFixed(1)}%`
          : "Suppressed - insufficient comparable data";
      const reasons = comparison.suppressionReasons.length
        ? comparison.suppressionReasons
            .map(humanizeResultReason)
            .map(escapeHtml)
            .join("<br />")
        : "None";
      const versions =
        Object.entries(comparison.modelVersions)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(
            ([name, version]) => `${escapeHtml(name)}: ${escapeHtml(version)}`,
          )
          .join("<br />") || "None recorded";
      return `<tr>
        <td>${escapeHtml(label)}</td>
        <td>${baseline ? escapeHtml(new Date(baseline.capturedAt).toLocaleString()) : "Time unavailable"}<br />${escapeHtml(comparison.baselineCaptureId)}</td>
        <td>${current ? escapeHtml(new Date(current.capturedAt).toLocaleString()) : "Time unavailable"}<br />${escapeHtml(comparison.currentCaptureId)}</td>
        <td>${comparison.userConfirmedMatch ? "Yes" : "No"}</td>
        <td>${escapeHtml(change)}</td>
        <td>${Math.round(comparison.registrationConfidence * 100)}% confidence<br />${Math.round(comparison.inlierRatio * 100)}% inliers<br />${(comparison.reprojectionErrorRatio * 100).toFixed(1)}% reprojection error<br />candidate match ${comparison.candidateMatchScore === null ? "unavailable" : `${Math.round(comparison.candidateMatchScore * 100)}%`}</td>
        <td>${reasons}</td>
        <td>${escapeHtml(comparison.analysisOrigin)}<br />${versions}</td>
      </tr>`;
    })
    .join("\n");
}

function pinRows(input: ReportInput): string {
  if (input.pins.length === 0) {
    return "<p>No user-confirmed observation pins are recorded for this session.</p>";
  }
  return `<table><thead><tr><th>Region</th><th>Named mesh</th><th>Region-relative UV</th><th>Asset version</th><th>Status</th><th>Linked captures</th></tr></thead><tbody>${input.pins
    .map((pin) => {
      const label =
        MOUTH_REGION_DETAILS.find((region) => region.id === pin.region)
          ?.label ?? pin.region;
      return `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(pin.meshId)}</td><td>${pin.uvX.toFixed(3)}, ${pin.uvY.toFixed(3)}</td><td>${escapeHtml(pin.assetVersion)}</td><td>${escapeHtml(observationStatusLabel(pin.status))}</td><td>${pin.captureIds.length}</td></tr>`;
    })
    .join("\n")}</tbody></table>`;
}

export async function generateEncryptedObservationReport(
  input: ReportInput,
): Promise<ReportRecord> {
  const syntheticReport = reportContainsSyntheticData(
    input.session,
    input.captures,
  );
  const symptomText = input.profile?.symptoms.length
    ? input.profile.symptoms.join(", ")
    : "None reported";
  const sessionCaptureIds = new Set(
    input.captures.map((capture) => capture.id),
  );
  const guidance = evaluateBundledGuidance(
    input.profile,
    Object.entries(input.analyses)
      .filter(([captureId]) => sessionCaptureIds.has(captureId))
      .map(([, analysis]) => analysis),
  );
  const hasValidCalibration = input.captures.some(
    (capture) => calibrationForReport(capture).status === "valid",
  );
  const acceptedRegions = [
    ...new Set(
      input.captures
        .filter((capture) => capture.quality.accepted)
        .map((capture) => capture.region),
    ),
  ];
  const html = `<!doctype html>
  <html><head><meta charset="utf-8" /><style>
    /* Expo Print uses WebView pagination on Android. Reserve bottom space for
       PDF page notices added after rendering, avoiding fixed-footer overlap.
       https://docs.expo.dev/versions/v57.0.0/sdk/print/#page-margins */
    @page { margin: 34px 28px; }
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size:13px; color:#17324D; margin:0; padding:0; line-height:1.4; }
    p { margin:6px 0; }
    h1 { color:#0B7A75; margin-bottom:2px; } h2 { border-bottom:2px solid #DDF5EE; padding-bottom:6px; }
    .warning { background:#FFF4DF; border:1px solid #D28B16; padding:12px; border-radius:8px; font-weight:700; }
    .demo-watermark { margin:0 0 18px; border:4px solid #B42318; color:#B42318; padding:14px; text-align:center; font-size:20px; font-weight:900; letter-spacing:1px; }
    .meta { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
    .observation { display:grid; grid-template-columns:180px minmax(0, 1fr); gap:18px; margin:16px 0; break-inside:avoid; page-break-inside:avoid; }
    .observation > div { min-width:0; overflow-wrap:anywhere; }
    .capture, .image-missing { width:170px; height:130px; object-fit:cover; border-radius:10px; border:1px solid #DCE6EC; }
    .capture-figure { margin:0; width:170px; }
    .capture-figure figcaption { color:#5D7286; font-size:10px; margin-top:4px; text-align:center; }
    .oral-map-figure { margin:14px auto 18px; max-width:520px; page-break-inside:avoid; }
    .oral-map { display:block; width:100%; max-height:390px; background:#FBFDFC; border:1px solid #DCE6EC; border-radius:14px; }
    .oral-map-figure figcaption { color:#5D7286; font-size:10px; line-height:1.4; margin-top:6px; text-align:center; }
    .map-label { fill:#17324D; font-size:8px; font-weight:700; }
    .map-state { fill:#536A7C; font-size:6px; font-weight:600; }
    .map-pin { fill:#FFD166; stroke:#7A4D00; stroke-width:2; }
    .image-missing { display:flex; align-items:center; justify-content:center; padding:8px; box-sizing:border-box; color:#5D7286; background:#F5FAF9; }
    table { width:100%; border-collapse:collapse; font-size:11px; margin:12px 0; }
    th, td { border:1px solid #DCE6EC; padding:7px; text-align:left; vertical-align:top; overflow-wrap:anywhere; }
    th { background:#F5FAF9; color:#17324D; }
    .report-footer { margin-top:32px; color:#5D7286; font-size:11px; }
  </style></head><body>
    ${syntheticReport ? '<div class="demo-watermark">SYNTHETIC DEMONSTRATION - NOT PATIENT DATA</div>' : ""}
    <h1>${syntheticReport ? "Stoma3D synthetic demonstration report" : "Stoma3D observation report"}</h1>
    <p>Structured visual observations for discussion with a dental or medical professional.</p>
    <div class="warning">${DISCLAIMER}</div>
    <h2>Session</h2><div class="meta">
      <p><strong>Session ID:</strong> ${escapeHtml(input.session.id)}</p>
      <p><strong>Created:</strong> ${escapeHtml(new Date(input.session.createdAt).toLocaleString())}</p>
      <p><strong>Consent recorded:</strong> ${input.consentedAt ? escapeHtml(new Date(input.consentedAt).toLocaleString()) : "No"}</p>
      <p><strong>Age range:</strong> ${escapeHtml(input.profile?.ageRange.replaceAll("_", " ") ?? "Not provided")}</p>
      <p><strong>Assisted intake:</strong> ${input.profile ? (input.profile.assisted ? "Yes" : "No") : "Not provided"}</p>
      <p><strong>First noticed:</strong> ${escapeHtml(input.profile?.firstNoticed || "Not provided")}</p>
      <p><strong>Approximate duration in days:</strong> ${input.profile?.durationDays ?? "Not provided"}</p>
      <p><strong>Reported symptoms:</strong> ${escapeHtml(symptomText)}</p>
      <p><strong>Bleeding frequency:</strong> ${displayValue(input.profile?.bleedingFrequency?.replaceAll("_", " "))}</p>
      <p><strong>Bleeding duration:</strong> ${displayValue(input.profile?.bleedingDuration)}</p>
      <p><strong>Reported change:</strong> ${displayValue(input.profile?.change.replaceAll("_", " "))}</p>
      <p><strong>Tobacco exposure:</strong> ${displayValue(input.profile?.tobaccoExposure.replaceAll("_", " "))}</p>
      <p><strong>Alcohol exposure:</strong> ${displayValue(input.profile?.alcoholExposure.replaceAll("_", " "))}</p>
      <p><strong>Previous conditions:</strong> ${displayValue(input.profile?.previousConditions)}</p>
      <p><strong>Professionally examined:</strong> ${input.profile ? (input.profile.professionallyExamined ? "Yes" : "No") : "Not provided"}</p>
    </div>
    <h2>Oral observation map</h2><p>Eight-region coverage: ${acceptedRegions.length} of 8 accepted. Pin positions are region-relative coordinates on the versioned generic asset, not a personalized anatomical model.</p>
    ${oralObservationMapMarkup({
      acceptedRegions,
      pins: input.pins,
      assetVersion: ORAL_MAP_ASSET_VERSION,
    })}
    ${pinRows(input)}
    <h2>Observations</h2>${await observationRows(input)}
    <h2>User-confirmed longitudinal comparisons</h2>
    <p>Comparisons are approximate, image-normalized visual observations. A reported change is shown only after user confirmation and registration gates; it is not a physical or diagnostic measurement.</p>
    ${input.comparisons.length ? `<table><thead><tr><th>Region</th><th>Baseline</th><th>Current</th><th>User confirmed</th><th>Approx. change</th><th>Registration</th><th>Suppression</th><th>Provenance / models</th></tr></thead><tbody>${comparisonRows(input)}</tbody></table>` : comparisonRows(input)}
    <h2>Review guidance and limitations</h2>
    <p><strong>Rule status:</strong> ${escapeHtml(guidance.statusMessage)}</p>
    <p><strong>Rule version:</strong> ${escapeHtml(guidance.rulesVersion ?? "disabled / unavailable")}</p>
    <p><strong>Review priority:</strong> ${escapeHtml(guidance.reviewPriority?.replaceAll("_", " ") ?? "disabled / unavailable")}</p>
    <p>${escapeHtml(guidance.message)}</p>
    <p>${hasValidCalibration ? "Image-normalized measurements remain approximate. Values explicitly labeled calibrated estimate are shown in millimeters only when a versioned reference-card gate passed; perspective, tissue curvature, camera angle, and card placement can still affect them." : "Measurements are approximate and normalized to each image. Millimeter estimates are unavailable because no capture passed the physical-calibration gate."} Appearance outputs describe visible image patterns and cannot determine a cause.</p>
    <h2>Questions for professional discussion</h2>
    <p>These are conversation prompts, not clinical recommendations.</p>
    <ul>
      <li>What does this visible area look like during an in-person examination?</li>
      <li>Would a professional photograph or another form of evaluation be useful?</li>
      <li>Which visible changes, if any, should prompt an earlier follow-up?</li>
      <li>When, if at all, should this area be checked again?</li>
    </ul>
    <footer class="report-footer">${syntheticReport ? "SYNTHETIC DEMONSTRATION - NOT PATIENT DATA. " : ""}${DISCLAIMER} Generated locally by Stoma3D. Images and report files are encrypted at rest. Model versions are recorded with each observation.</footer>
  </body></html>`;

  let plaintextPdfUri: string | null = null;
  const reportId = Crypto.randomUUID();
  const releaseReport = beginReportTemporaryLease();
  try {
    const printed = await printReportToFile(html);
    plaintextPdfUri = printed.uri;
    const bytes = toByteArray(
      await FileSystem.readAsStringAsync(printed.uri, {
        encoding: FileSystem.EncodingType.Base64,
      }),
    );
    const completedPdf = await addReportPageFooters(bytes);
    // Reuse the owned Print file rather than creating another plaintext copy.
    // The report lease and finally cleanup cover reading, stamping and writing.
    await FileSystem.writeAsStringAsync(
      printed.uri,
      fromByteArray(completedPdf),
      { encoding: FileSystem.EncodingType.Base64 },
    );
    const encryptedUri = await encryptFile(printed.uri, `report:${reportId}`);
    return {
      id: reportId,
      createdAt: new Date().toISOString(),
      encryptedUri,
      sessionId: input.session.id,
    };
  } finally {
    try {
      if (plaintextPdfUri) {
        await removeReportTemporaryFile(plaintextPdfUri);
      }
    } finally {
      releaseReport();
    }
  }
}

export async function shareEncryptedReport(
  report: ReportRecord,
): Promise<void> {
  if (!(await Sharing.isAvailableAsync()))
    throw new Error("Sharing is not available on this device.");
  const temporary = await decryptToTemporaryFile(
    report.encryptedUri,
    "pdf",
    `report:${report.id}`,
  );
  let shareSheetOpened = false;
  try {
    await Sharing.shareAsync(temporary, {
      mimeType: "application/pdf",
      dialogTitle: "Share Stoma3D observation report",
      UTI: "com.adobe.pdf",
    });
    shareSheetOpened = true;
    setTimeout(() => {
      void removeTemporaryFile(temporary);
    }, SHARE_TEMPORARY_FILE_RETENTION_MS);
  } finally {
    if (!shareSheetOpened) {
      await removeTemporaryFile(temporary);
    }
  }
}
