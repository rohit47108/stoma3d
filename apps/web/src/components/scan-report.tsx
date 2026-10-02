import Image from "next/image";
import { MOUTH_REGION_DETAILS } from "@stoma3d/contracts";
import {
  analysisOriginLabel,
  inputOriginLabel,
} from "@/lib/analysis-provenance";
import {
  captureSummary,
  regionDetail,
  type GuestSession,
} from "@/lib/guest-scan";
import { visualDescriptorDescriptions } from "@/lib/visual-descriptor-descriptions";

export function ScanReport({ session }: { session: GuestSession | null }) {
  if (!session) return null;
  return (
    <article className="scan-print-report" aria-hidden="true">
      <h1>Stoma3D observation report</h1>
      <p>
        {new Date(session.createdAt).toLocaleString()} ·{" "}
        {session.captures.length} of 8 regions captured
      </p>
      <p>Session: {session.id}</p>
      <p>
        Symptoms:{" "}
        {session.intake.symptoms.join(", ") || "None reported / not sure"}.
        Duration: {session.intake.duration}. Change: {session.intake.change}.
      </p>
      <p>
        This result is not a diagnosis. Measurements are approximate and
        relative to the image, not millimeters.
      </p>
      <h2>Region coverage</h2>
      <ul>
        {MOUTH_REGION_DETAILS.map((region) => (
          <li key={region.id}>
            {region.label}:{" "}
            {session.captures.some((capture) => capture.region === region.id)
              ? "Photo accepted"
              : "Not captured"}
          </li>
        ))}
      </ul>
      {session.captures.map((capture) => (
        <section key={capture.id} className="scan-print-observation">
          <h2>{regionDetail(capture.region).label}</h2>
          <p>
            Capture: {capture.id} ·{" "}
            {new Date(capture.capturedAt).toLocaleString()}
          </p>
          <div className="scan-print-photo">
            <Image
              src={capture.image}
              width={capture.width}
              height={capture.height}
              unoptimized
              alt={`Accepted ${regionDetail(capture.region).shortLabel} photo`}
            />
            {capture.analysis.candidateMask && (
              <svg
                viewBox="0 0 1 1"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <polygon
                  points={capture.analysis.candidateMask.polygon
                    .map(([x, y]) => `${x},${y}`)
                    .join(" ")}
                  fill="rgba(9,109,103,0.28)"
                  stroke="#fff"
                  strokeWidth="0.004"
                />
              </svg>
            )}
          </div>
          <p>
            {capture.analysis.candidateMask
              ? `Candidate area: approximately ${(capture.analysis.candidateMask.normalizedArea * 100).toFixed(1)}% of the image. ${session.pins.some((pin) => pin.captureId === capture.id) ? "Observation confirmed by user." : "Not confirmed by user."}`
              : captureSummary(capture)}
          </p>
          {capture.analysis.descriptors && (
            <p>
              {visualDescriptorDescriptions(capture.analysis.descriptors)
                .map(({ label, description }) => `${label}: ${description}`)
                .join(". ")}
              .
            </p>
          )}
          <p>
            Input: {inputOriginLabel(capture.analysis.inputOrigin)}. Analysis:{" "}
            {analysisOriginLabel(capture.analysis.analysisOrigin)} ·{" "}
            {capture.analysis.status}. Confidence:{" "}
            {Math.round(capture.analysis.uncertainty.overallConfidence * 100)}%.
          </p>
          <ul>
            {[
              ...capture.analysis.abstentionReasons,
              ...capture.analysis.uncertainty.limitations,
            ].map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p>
            Model versions:{" "}
            {Object.entries(capture.analysis.modelVersions)
              .map(([name, version]) => `${name}: ${version}`)
              .join("; ")}
          </p>
        </section>
      ))}
      <p>
        Map asset: procedural-v1. This is a general oral observation map, not a
        reconstructed model of the user’s mouth.
      </p>
    </article>
  );
}
