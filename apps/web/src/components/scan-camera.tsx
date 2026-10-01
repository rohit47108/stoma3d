"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  prepareCanvasPhoto,
  preparePhotoFile,
  type PreparedPhoto,
} from "@/lib/scan-image";

interface Props {
  onPhoto: (photo: PreparedPhoto) => void;
  onProblem: (message: string) => void;
  initialFacing: "user" | "environment";
  onFacingChange: (facing: "user" | "environment") => void;
}

export function ScanCamera({
  onPhoto,
  onProblem,
  initialFacing,
  onFacingChange,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const requestRef = useRef({ sequence: 0 });
  const uploadRef = useRef<HTMLInputElement>(null);
  const [facing, setFacing] = useState<"user" | "environment">(initialFacing);
  const [cameraState, setCameraState] = useState<
    "closed" | "opening" | "open" | "error"
  >("closed");
  const [busy, setBusy] = useState(false);
  const [cameraMessage, setCameraMessage] = useState("");
  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => {
    const requests = requestRef.current;
    const interrupted = () => {
      if (document.hidden) {
        requests.sequence++;
        stop();
        setCameraState("closed");
      }
    };
    document.addEventListener("visibilitychange", interrupted);
    return () => {
      requests.sequence++;
      stop();
      document.removeEventListener("visibilitychange", interrupted);
    };
  }, [stop]);

  async function openCamera(nextFacing = facing) {
    const requestId = ++requestRef.current.sequence;
    stop();
    setCameraState("opening");
    setCameraMessage("");
    setFacing(nextFacing);
    onFacingChange(nextFacing);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState("error");
      setCameraMessage(
        "Camera access is unavailable here. Choose a photo instead.",
      );
      return;
    }
    try {
      // Release the previous camera before changing facingMode.
      // https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: nextFacing },
          width: { ideal: 1600 },
          height: { ideal: 1200 },
        },
      });
      if (requestId !== requestRef.current.sequence) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const actualFacing = stream.getVideoTracks()[0]?.getSettings().facingMode;
      if (actualFacing === "user" || actualFacing === "environment") {
        setFacing(actualFacing);
        onFacingChange(actualFacing);
        if (actualFacing !== nextFacing)
          setCameraMessage(
            "The other camera is unavailable. You can use this camera or choose a photo.",
          );
      }
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraState("open");
    } catch (error) {
      if (requestId !== requestRef.current.sequence) return;
      stop();
      setCameraState("error");
      const name = error instanceof DOMException ? error.name : "";
      setCameraMessage(
        name === "NotAllowedError"
          ? "Allow camera access in your browser settings, or choose a photo."
          : "The camera could not open. Try again or choose a photo.",
      );
    }
  }

  async function takePhoto() {
    const video = videoRef.current;
    if (!video || busy) return;
    setBusy(true);
    try {
      const photo = await prepareCanvasPhoto(
        video,
        video.videoWidth,
        video.videoHeight,
      );
      stop();
      onPhoto(photo);
    } catch (error) {
      onProblem(
        error instanceof Error
          ? error.message
          : "The photo could not be read. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File | undefined) {
    if (!file || busy) return;
    setBusy(true);
    requestRef.current.sequence++;
    stop();
    setCameraState("closed");
    try {
      const photo = await preparePhotoFile(file);
      onPhoto(photo);
    } catch (error) {
      onProblem(
        error instanceof Error ? error.message : "Choose another photo.",
      );
    } finally {
      setBusy(false);
      if (uploadRef.current) uploadRef.current.value = "";
    }
  }

  return (
    <div className="scan-camera">
      <div className="scan-camera-preview">
        <video
          ref={videoRef}
          playsInline
          muted
          className={facing === "user" ? "scan-camera-mirrored" : undefined}
          aria-label="Live camera preview"
          hidden={cameraState !== "open"}
        />
        {cameraState !== "open" && (
          <div className="scan-camera-empty">
            <span aria-hidden="true" className="scan-camera-symbol">
              ◎
            </span>
            <p>
              {cameraState === "opening"
                ? "Opening camera…"
                : "Frame just the mouth"}
            </p>
            <small>
              {cameraMessage ||
                "Use even lighting and keep the tissue in focus."}
            </small>
          </div>
        )}
        {cameraState === "open" && (
          <div className="scan-camera-guide" aria-hidden="true">
            <span>Keep the mouth inside the frame</span>
            <div />
          </div>
        )}
      </div>
      {cameraMessage && (
        <p role="status" className="scan-inline-note">
          {cameraMessage}
        </p>
      )}
      <div className="scan-camera-actions">
        {cameraState === "open" ? (
          <button
            type="button"
            className="scan-button scan-button-primary scan-shutter"
            disabled={busy}
            onClick={() => void takePhoto()}
          >
            {busy ? "Preparing photo…" : "Take photo"}
          </button>
        ) : (
          <button
            type="button"
            className="scan-button scan-button-primary"
            disabled={cameraState === "opening" || busy}
            onClick={() => void openCamera()}
          >
            {cameraState === "opening" ? "Opening camera…" : "Open camera"}
          </button>
        )}
        <button
          type="button"
          className="scan-button"
          disabled={busy}
          onClick={() => uploadRef.current?.click()}
        >
          Choose a photo
        </button>
        {cameraState === "open" && (
          <button
            type="button"
            className="scan-button scan-icon-button"
            aria-label={`Switch to ${facing === "user" ? "back" : "front"} camera`}
            disabled={busy}
            onClick={() =>
              void openCamera(facing === "user" ? "environment" : "user")
            }
          >
            ⇄<span className="sr-only">Switch camera</span>
          </button>
        )}
        <input
          ref={uploadRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/avif,.heic,.heif"
          className="sr-only"
          aria-label="Choose a mouth photo"
          onChange={(event) => void upload(event.target.files?.[0])}
        />
      </div>
    </div>
  );
}
