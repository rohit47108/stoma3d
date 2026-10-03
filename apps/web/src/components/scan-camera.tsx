"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CameraStartupTimeoutError,
  prepareCurrentCameraPhoto,
  startCameraPreview,
  stopCameraStream,
} from "@/lib/scan-camera-lifecycle";
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
  const startupRef = useRef<AbortController | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [facing, setFacing] = useState<"user" | "environment">(initialFacing);
  const [cameraState, setCameraState] = useState<
    "closed" | "opening" | "open" | "error"
  >("closed");
  const [busy, setBusy] = useState(false);
  const [cameraMessage, setCameraMessage] = useState("");
  const stop = useCallback(() => {
    requestRef.current.sequence++;
    startupRef.current?.abort();
    startupRef.current = null;
    if (streamRef.current) stopCameraStream(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    if (uploadRef.current) uploadRef.current.value = "";
  }, []);

  useEffect(() => {
    const interrupted = () => {
      if (document.hidden) {
        stop();
        setCameraState("closed");
        setBusy(false);
      }
    };
    document.addEventListener("visibilitychange", interrupted);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", interrupted);
    };
  }, [stop]);

  async function openCamera(nextFacing = facing) {
    stop();
    const requestId = requestRef.current.sequence;
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
    const controller = new AbortController();
    startupRef.current = controller;
    try {
      // Release the previous camera before changing facingMode.
      // https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
      const stream = await startCameraPreview({
        signal: controller.signal,
        requestStream: () =>
          navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              facingMode: { ideal: nextFacing },
              width: { ideal: 1600 },
              height: { ideal: 1200 },
            },
          }),
        playStream: async (received) => {
          const video = videoRef.current;
          if (!video) throw new Error("Camera preview is unavailable.");
          streamRef.current = received;
          video.srcObject = received;
          await video.play();
        },
      });
      if (requestId !== requestRef.current.sequence) {
        stopCameraStream(stream);
        return;
      }
      startupRef.current = null;
      const actualFacing = stream.getVideoTracks()[0]?.getSettings().facingMode;
      if (actualFacing === "user" || actualFacing === "environment") {
        setFacing(actualFacing);
        onFacingChange(actualFacing);
        if (actualFacing !== nextFacing)
          setCameraMessage(
            "The other camera is unavailable. You can use this camera or choose a photo.",
          );
      }
      setCameraState("open");
    } catch (error) {
      if (requestId !== requestRef.current.sequence) return;
      stop();
      setCameraState("error");
      const name = error instanceof DOMException ? error.name : "";
      setCameraMessage(
        error instanceof CameraStartupTimeoutError
          ? "The camera is taking too long to open. Check browser permissions, then try again or choose a photo."
          : name === "NotAllowedError"
            ? "Allow camera access in your browser settings, or choose a photo."
            : "The camera could not open. Try again or choose a photo.",
      );
    }
  }

  async function takePhoto() {
    const video = videoRef.current;
    if (!video || busy) return;
    const requestId = ++requestRef.current.sequence;
    const isCurrent = () => requestId === requestRef.current.sequence;
    setBusy(true);
    try {
      const photo = await prepareCurrentCameraPhoto(
        () => prepareCanvasPhoto(video, video.videoWidth, video.videoHeight),
        isCurrent,
      );
      if (!photo) return;
      setBusy(false);
      stop();
      setCameraState("closed");
      onPhoto(photo);
    } catch (error) {
      if (!isCurrent()) return;
      onProblem(
        error instanceof Error
          ? error.message
          : "The photo could not be read. Try again.",
      );
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }

  async function upload(file: File | undefined) {
    if (!file || busy) return;
    setBusy(true);
    stop();
    const requestId = requestRef.current.sequence;
    const isCurrent = () => requestId === requestRef.current.sequence;
    setCameraState("closed");
    try {
      const photo = await prepareCurrentCameraPhoto(
        () => preparePhotoFile(file),
        isCurrent,
      );
      if (!photo) return;
      setBusy(false);
      stop();
      onPhoto(photo);
    } catch (error) {
      if (!isCurrent()) return;
      onProblem(
        error instanceof Error ? error.message : "Choose another photo.",
      );
    } finally {
      if (isCurrent()) setBusy(false);
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
          onClick={() => {
            stop();
            setCameraState("closed");
            setCameraMessage("");
            uploadRef.current?.click();
          }}
        >
          Choose a photo
        </button>
        {cameraState === "opening" && (
          <button
            type="button"
            className="scan-button"
            onClick={() => {
              stop();
              setCameraState("closed");
              setCameraMessage("");
            }}
          >
            Cancel
          </button>
        )}
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
