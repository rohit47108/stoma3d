"use client";

import Image from "next/image";
import { useState } from "react";
import type { GuestCapture } from "@/lib/guest-scan";
import {
  analysisOriginLabel,
  inputOriginLabel,
} from "@/lib/analysis-provenance";

interface Props {
  capture: GuestCapture;
  pinConfirmed: boolean;
  onConfirmPin: () => void;
  onRetry: () => void;
  onNext: () => void;
  onMap: () => void;
  complete: boolean;
}

export function ScanResult({
  capture,
  pinConfirmed,
  onConfirmPin,
  onRetry,
  onNext,
  onMap,
  complete,
}: Props) {
  const [overlay, setOverlay] = useState(true);
  const result = capture.analysis;
  const mask = result.candidateMask;
  const analyzed = result.status === "complete";
  return (
    <div className="scan-result">
      <div className="scan-photo-frame scan-result-photo">
        <Image
          src={capture.image}
          width={capture.width}
          height={capture.height}
          unoptimized
          alt="Analyzed mouth photo"
        />
        {mask && overlay && (
          <svg
            viewBox="0 0 1 1"
            preserveAspectRatio="none"
            role="img"
            aria-label="Candidate area highlighted on the photo"
          >
            <polygon
              points={mask.polygon.map(([x, y]) => `${x},${y}`).join(" ")}
              fill="rgba(9,109,103,0.28)"
              stroke="#fff"
              strokeWidth="0.004"
            />
          </svg>
        )}
      </div>
      <div className="scan-result-copy">
        <h2>
          {!analyzed
            ? "Photo saved. Analysis needs another try."
            : mask
              ? "An area to keep track of"
              : "No candidate area detected"}
        </h2>
        <p>
          {!analyzed
            ? "The photo passed privacy, image quality, and region checks, but the model could not complete its analysis. You can retry with the saved photo."
            : mask
              ? "The outline marks a candidate area in this photo. Confirm it if you want to keep it on your map."
              : "The model did not outline a candidate area in this image. The photo is saved with this region."}
        </p>
        {!analyzed && (
          <ul className="scan-help">
            {result.abstentionReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        )}
        {mask && (
          <>
            <button
              type="button"
              className="scan-text-button"
              aria-pressed={overlay}
              onClick={() => setOverlay(!overlay)}
            >
              {overlay ? "Hide outline" : "Show outline"}
            </button>
            <dl className="scan-descriptors">
              <div>
                <dt>Approximate area</dt>
                <dd>{(mask.normalizedArea * 100).toFixed(1)}% of the photo</dd>
              </div>
              {result.descriptors && (
                <>
                  <div>
                    <dt>Color</dt>
                    <dd>
                      {result.descriptors.meanRedness > 0.6
                        ? "Redder tone"
                        : "Mixed tissue tone"}
                    </dd>
                  </div>
                  <div>
                    <dt>Border</dt>
                    <dd>
                      {result.descriptors.borderIrregularity > 1.5
                        ? "Uneven outline"
                        : "Relatively even outline"}
                    </dd>
                  </div>
                  <div>
                    <dt>Texture</dt>
                    <dd>
                      {result.descriptors.textureContrast > 0.3
                        ? "More varied surface texture"
                        : "More even surface texture"}
                    </dd>
                  </div>
                </>
              )}
            </dl>
            <button
              type="button"
              className="scan-button"
              disabled={pinConfirmed}
              onClick={onConfirmPin}
            >
              {pinConfirmed
                ? "✓ Observation saved on map"
                : "Confirm this observation"}
            </button>
          </>
        )}
        <div className="scan-actions">
          {!analyzed && (
            <button
              type="button"
              className="scan-button scan-button-primary"
              onClick={onRetry}
            >
              Try analysis again
            </button>
          )}
          <button
            type="button"
            className={`scan-button${analyzed ? " scan-button-primary" : ""}`}
            onClick={complete ? onMap : onNext}
          >
            {complete ? "View completed scan" : "Next region"}
          </button>
          {!complete && analyzed && (
            <button type="button" className="scan-button" onClick={onMap}>
              View on 3D map
            </button>
          )}
        </div>
        <details className="scan-result-details">
          <summary>Analysis details</summary>
          <p>Captured {new Date(capture.capturedAt).toLocaleString()}</p>
          <p>
            Analysis confidence:{" "}
            {Math.round(result.uncertainty.overallConfidence * 100)}%
          </p>
          <ul>
            {result.uncertainty.limitations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <dl>
            {Object.entries(result.modelVersions).map(([name, version]) => (
              <div key={name}>
                <dt>{name.replaceAll("_", " ")}</dt>
                <dd>{version}</dd>
              </div>
            ))}
          </dl>
          <small>
            Input: {inputOriginLabel(result.inputOrigin)} · Analysis:{" "}
            {analysisOriginLabel(result.analysisOrigin)}
          </small>
        </details>
        <p className="scan-result-footer">
          This result is not a diagnosis. If you have a concern, discuss it with
          a dental or medical professional.
        </p>
      </div>
    </div>
  );
}
