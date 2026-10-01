"use client";

import Image from "next/image";
import { useState } from "react";
import {
  decodePhoto,
  prepareCanvasPhoto,
  type PreparedPhoto,
} from "@/lib/scan-image";

interface Props {
  photo: PreparedPhoto;
  busy: boolean;
  problem: string | null;
  onChange: (photo: PreparedPhoto) => void;
  onUse: () => void;
  onReplace: () => void;
}

export function ScanPhotoReview({
  photo,
  busy,
  problem,
  onChange,
  onUse,
  onReplace,
}: Props) {
  const [confirmed, setConfirmed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [insetX, setInsetX] = useState(0);
  const [insetY, setInsetY] = useState(0);
  const [offsetX, setOffsetX] = useState(50);
  const [offsetY, setOffsetY] = useState(50);
  const [localProblem, setLocalProblem] = useState<string | null>(null);
  const left = (insetX * 2 * offsetX) / 100;
  const top = (insetY * 2 * offsetY) / 100;

  async function edit(turns: number, crop: boolean) {
    if (editing || busy) return;
    setEditing(true);
    setLocalProblem(null);
    try {
      const image = await decodePhoto(photo.blob);
      const next = await prepareCanvasPhoto(
        image,
        image.naturalWidth,
        image.naturalHeight,
        crop
          ? {
              left: left / 100,
              top: top / 100,
              width: 1 - (insetX * 2) / 100,
              height: 1 - (insetY * 2) / 100,
            }
          : undefined,
        turns,
      );
      onChange(next);
      setInsetX(0);
      setInsetY(0);
      setOffsetX(50);
      setOffsetY(50);
      setConfirmed(false);
    } catch (error) {
      setLocalProblem(
        error instanceof Error
          ? error.message
          : "The edit could not be applied. Try again.",
      );
    } finally {
      setEditing(false);
    }
  }

  return (
    <div className="scan-review">
      <div className="scan-photo-frame">
        <Image
          src={photo.image}
          width={photo.width}
          height={photo.height}
          unoptimized
          alt="Mouth photo ready for review"
        />
        {(insetX > 0 || insetY > 0) && (
          <div
            className="scan-crop-frame"
            style={{
              left: `${left}%`,
              top: `${top}%`,
              width: `${100 - insetX * 2}%`,
              height: `${100 - insetY * 2}%`,
            }}
            aria-hidden="true"
          />
        )}
      </div>
      <details className="scan-photo-tools">
        <summary>Crop or rotate</summary>
        <div className="scan-crop-sliders">
          <label>
            Crop sides
            <input
              type="range"
              min="0"
              max="40"
              value={insetX}
              onChange={(event) => setInsetX(Number(event.target.value))}
              disabled={busy || editing}
            />
          </label>
          <label>
            Crop top and bottom
            <input
              type="range"
              min="0"
              max="40"
              value={insetY}
              onChange={(event) => setInsetY(Number(event.target.value))}
              disabled={busy || editing}
            />
          </label>
          {insetX > 0 && (
            <label>
              Move crop horizontally
              <input
                type="range"
                min="0"
                max="100"
                value={offsetX}
                onChange={(event) => setOffsetX(Number(event.target.value))}
                disabled={busy || editing}
              />
            </label>
          )}
          {insetY > 0 && (
            <label>
              Move crop vertically
              <input
                type="range"
                min="0"
                max="100"
                value={offsetY}
                onChange={(event) => setOffsetY(Number(event.target.value))}
                disabled={busy || editing}
              />
            </label>
          )}
        </div>
        <div className="scan-actions">
          <button
            type="button"
            className="scan-button"
            onClick={() => void edit(0, true)}
            disabled={busy || editing || (insetX === 0 && insetY === 0)}
          >
            Apply crop
          </button>
          <button
            type="button"
            className="scan-button"
            onClick={() => void edit(1, false)}
            disabled={busy || editing}
          >
            Rotate 90°
          </button>
        </div>
      </details>
      <label className="scan-check">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          disabled={busy || editing}
        />
        <span>
          This photo shows only the mouth. Send it for a privacy check and
          analysis.
        </span>
      </label>
      {(problem || localProblem) && (
        <p role="alert" className="scan-error">
          {problem || localProblem}
        </p>
      )}
      <div className="scan-actions">
        <button
          type="button"
          className="scan-button scan-button-primary"
          disabled={!confirmed || busy || editing}
          onClick={onUse}
        >
          {busy
            ? "Checking photo…"
            : problem
              ? "Try this photo again"
              : "Use photo"}
        </button>
        <button
          type="button"
          className="scan-button"
          disabled={busy || editing}
          onClick={onReplace}
        >
          Choose another
        </button>
      </div>
      {busy && (
        <p role="status" className="scan-help">
          Checking privacy, image quality, and the selected region. Your photo
          stays here if you need to retry.
        </p>
      )}
    </div>
  );
}
