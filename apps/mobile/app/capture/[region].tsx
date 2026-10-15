import { useCallback, useEffect, useRef, useState } from "react";
import { useFaceDetection } from "@infinitered/react-native-mlkit-face-detection";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { CameraView, useCameraPermissions, type CameraType } from "expo-camera";
import { useVideoPlayer } from "expo-video";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { Accelerometer } from "expo-sensors";
import * as Crypto from "expo-crypto";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import * as Speech from "expo-speech";
import { AppState, Image, Linking, StyleSheet, Text, View } from "react-native";
import {
  MOUTH_REGION_DETAILS,
  captureAngleSchema,
  mouthRegionSchema,
  type CaptureAngle,
  type MouthRegion,
  type QualityResult,
} from "@stoma3d/contracts";

import { CaptureGuideOverlay } from "@/components/CaptureGuideOverlay";
import { CaptureGuidanceMetrics } from "@/components/CaptureGuidanceMetrics";
import { Screen } from "@/components/Screen";
import { StabilityIndicator } from "@/components/StabilityIndicator";
import {
  createCaptureGuidanceSnapshot,
  type CaptureGuidanceSnapshot,
  type CaptureGuidanceSource,
  type MotionSample,
} from "@/components/captureGuidance";
import { Button, Card, ChoiceChip } from "@/components/Ui";
import {
  captureAnalysisRetryDisposition,
  captureRegionCorrection,
  captureStorageRejectionReasons,
} from "@/lib/analysisPolicy";
import { analyzeCapture } from "@/lib/api";
import { captureGuideSpec } from "@/lib/captureGuide";
import {
  captureBackgroundCleanup,
  capturePendingCommits,
  createCaptureLifecycle,
  shouldPurgeBackgroundTemporaryFiles,
  type CaptureReviewToken,
} from "@/lib/captureLifecycle";
import {
  qualityForSanitizedCapture,
  sanitizeCameraCapture,
  sanitizeSelectedImage,
  sanitizeVideoFrame,
  editSanitizedCapture,
  type SanitizedCapture,
} from "@/lib/imagePipeline";
import {
  checkCapturePrivacy,
  canSendForServerPrivacyCheck,
  retryDraftQuality,
} from "@/lib/privacyPolicy";
import { latestPriorAcceptedCapture } from "@/lib/longitudinalPolicy";
import { humanizeResultReason } from "@/lib/resultCopy";
import { pickSelectedPhoto } from "@/lib/photoPicker";
import {
  decryptToTemporaryFile,
  encryptFile,
  removeProtectedFile,
  removeTemporaryFile,
} from "@/lib/secureFiles";
import {
  beginPickerTemporaryLease,
  removePickerTemporaryCopy,
  type PickerTemporaryLease,
} from "@/lib/tempFiles";
import {
  selectBestSweepFrames,
  sweepFrameRequests,
  sweepInstruction,
  type SweepAngle,
} from "@/lib/videoSweep";
import { useStoma3DStore } from "@/store/useStoma3DStore";
import { useAppTheme } from "@/theme";
import type { CaptureRecord } from "@/types";
import { PhotoCropEditor } from "@/components/PhotoCropEditor";
import { scanProgress } from "@/lib/scanLogic";

const cameraForSession = new Map<string, CameraType>();

interface CandidateState {
  capture: SanitizedCapture;
  quality: QualityResult;
  angle: CaptureAngle;
  mediaKind: "image" | "video_frame";
  sourceVideoDurationMs?: number;
  frameTimeMs?: number;
  guidance: CaptureGuidanceSnapshot;
  draftId?: string;
  encryptedDraftUri?: string;
  capturedAt?: string;
}

interface SweepCandidateState extends CandidateState {
  angle: SweepAngle;
  mediaKind: "video_frame";
  sourceVideoDurationMs: number;
  frameTimeMs: number;
}

export default function CaptureRoute() {
  const theme = useAppTheme();
  const params = useLocalSearchParams<{ region?: string; angle?: string }>();
  const parsedRegion = mouthRegionSchema.safeParse(params.region);
  const activeSessionId = useStoma3DStore((state) => state.activeSessionId);
  const routeIdentity = `${activeSessionId}\u0000${params.region}\u0000${params.angle}`;
  const [correctedRegion, setCorrectedRegion] = useState<{
    region: MouthRegion;
    routeIdentity: string;
  } | null>(null);
  const region =
    correctedRegion?.routeIdentity === routeIdentity
      ? correctedRegion.region
      : parsedRegion.success
        ? parsedRegion.data
        : null;
  const detail = MOUTH_REGION_DETAILS.find((item) => item.id === region);
  const sessions = useStoma3DStore((state) => state.sessions);
  const settings = useStoma3DStore((state) => state.settings);
  const captures = useStoma3DStore((state) => state.captures);
  const addCaptures = useStoma3DStore((state) => state.addCaptures);
  const captureDrafts = useStoma3DStore((state) => state.captureDrafts);
  const saveCaptureDraft = useStoma3DStore((state) => state.saveCaptureDraft);
  const removeCaptureDraft = useStoma3DStore(
    (state) => state.removeCaptureDraft,
  );
  const faceDetector = useFaceDetection();
  const cameraRef = useRef<CameraView>(null);
  const temporaryUris = useRef(new Set<string>());
  const mounted = useRef(true);
  const lifecycle = useRef(createCaptureLifecycle(AppState.currentState));
  const priorRouteIdentity = useRef(routeIdentity);
  const actionBusy = useRef(false);
  const pickerInFlight = useRef(false);
  const waitingForPicker = useRef(false);
  const pickerTemporaryLease = useRef<PickerTemporaryLease | null>(null);
  const draftRestoreStarted = useRef(false);
  const videoPlayer = useVideoPlayer(null);
  const recordingStartedAt = useRef<number | null>(null);
  const previousMotion = useRef({ x: 0, y: 0, z: 1 });
  const latestMotion = useRef<MotionSample | null>(null);
  const stableSamples = useRef(0);
  const autoCaptureAction = useRef<() => void>(() => undefined);
  const autoCaptureTriggered = useRef(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [stability, setStability] = useState(0);
  const [motionReading, setMotionReading] = useState<MotionSample | null>(null);
  const [sensorAvailable, setSensorAvailable] = useState<boolean | null>(null);
  const [candidate, setCandidate] = useState<CandidateState | null>(null);
  const [facing, setFacing] = useState<CameraType>(
    () => cameraForSession.get(activeSessionId ?? "") ?? "front",
  );
  const [cameraMounted, setCameraMounted] = useState(true);
  const [cameraReady, setCameraReady] = useState(false);
  const [screenFocused, setScreenFocused] = useState(true);
  const [appActive, setAppActive] = useState(
    AppState.currentState === "active",
  );
  const [moreOptions, setMoreOptions] = useState(false);
  const [cropOpen, setCropOpen] = useState(false);
  const [serverPrivacyConsent, setServerPrivacyConsent] = useState(false);
  const [suggestedRegion, setSuggestedRegion] = useState<MouthRegion | null>(
    null,
  );
  const [sweepCandidates, setSweepCandidates] = useState<SweepCandidateState[]>(
    [],
  );
  const [recording, setRecording] = useState(false);
  const [sweepElapsedMs, setSweepElapsedMs] = useState(0);
  const [rejectedQuality, setRejectedQuality] = useState<QualityResult | null>(
    null,
  );
  const [rejectedGuidance, setRejectedGuidance] =
    useState<CaptureGuidanceSnapshot | null>(null);
  const [mouthOnlyConfirmed, setMouthOnlyConfirmed] = useState(false);
  const [regionConfirmed, setRegionConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pickerPending, setPickerPending] = useState(false);
  const [commitPending, setCommitPending] = useState(() =>
    capturePendingCommits.hasPending(),
  );
  const [busyLabel, setBusyLabel] = useState("Working...");
  const [error, setError] = useState<string | null>(null);
  const [ghostEnabled, setGhostEnabled] = useState(false);
  const [mirrorGuide, setMirrorGuide] = useState(false);
  const [autoCaptureEnabled, setAutoCaptureEnabled] = useState(false);
  const [ghostUri, setGhostUri] = useState<string | null>(null);
  const [ghostError, setGhostError] = useState<string | null>(null);
  const [restoreRevision, setRestoreRevision] = useState(0);
  const session = sessions.find((item) => item.id === activeSessionId) ?? null;
  const parsedAngle = captureAngleSchema.safeParse(params.angle);
  const requestedAngle = parsedAngle.success ? parsedAngle.data : null;
  const captureAngle: CaptureAngle | null =
    session?.protocol === "standard_eight_region"
      ? "primary"
      : session?.protocol === "guided_video_sweep"
        ? "straight"
        : requestedAngle && requestedAngle !== "primary"
          ? requestedAngle
          : null;
  const isSweep = session?.protocol === "guided_video_sweep";
  const preparedCandidates =
    sweepCandidates.length > 0 ? sweepCandidates : candidate ? [candidate] : [];
  const hasReview = useRef(false);
  hasReview.current = preparedCandidates.length > 0;
  const priorCapture =
    region === null
      ? null
      : latestPriorAcceptedCapture(
          captures.filter((capture) => capture.angle === captureAngle),
          activeSessionId,
          region,
        );

  const releasePickerLease = useCallback(() => {
    const lease = pickerTemporaryLease.current;
    pickerTemporaryLease.current = null;
    void lease?.release().catch(() => {
      console.warn("[STOMA3D_PICKER_TEMP_CLEANUP_FAILED]");
    });
  }, []);

  const clearTemporaryReview = useCallback(() => {
    // Android's selected-photo picker is a temporary background Activity, not
    // an existing photo review being lost. Cleanup still runs in either case.
    // https://reactnative.dev/docs/0.86/appstate#app-states
    const reviewCleared =
      hasReview.current || (actionBusy.current && !waitingForPicker.current);
    setCandidate(null);
    setSweepCandidates([]);
    setCropOpen(false);
    setMouthOnlyConfirmed(false);
    setRegionConfirmed(false);
    setServerPrivacyConsent(false);
    setSuggestedRegion(null);
    setRejectedQuality(null);
    setRejectedGuidance(null);
    actionBusy.current = false;
    draftRestoreStarted.current = false;
    setBusy(false);
    setRecording(false);
    setSweepElapsedMs(0);
    setCameraMounted(true);
    setCameraReady(false);
    recordingStartedAt.current = null;
    if (reviewCleared && !capturePendingCommits.hasPending()) {
      setError(
        "Photo cleared when you left the app. Choose another photo or retake it.",
      );
    }
  }, []);

  useEffect(() => {
    const refresh = () => setCommitPending(capturePendingCommits.hasPending());
    const unsubscribe = capturePendingCommits.subscribe(refresh);
    refresh();
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (priorRouteIdentity.current === routeIdentity) return;
    priorRouteIdentity.current = routeIdentity;
    lifecycle.current.invalidateContext();
    releasePickerLease();
    cameraRef.current?.stopRecording();
    for (const uri of temporaryUris.current) void removeTemporaryFile(uri);
    temporaryUris.current.clear();
    setCorrectedRegion(null);
    clearTemporaryReview();
  }, [clearTemporaryReview, releasePickerLease, routeIdentity]);

  useEffect(() => {
    let active = true;
    let subscription: { remove: () => void } | null = null;
    void Accelerometer.isAvailableAsync()
      .then((available) => {
        if (!active) return;
        setSensorAvailable(available);
        if (!available) {
          setStability(1);
          latestMotion.current = null;
          setMotionReading(null);
          return;
        }
        Accelerometer.setUpdateInterval(100);
        subscription = Accelerometer.addListener((motion) => {
          const prior = previousMotion.current;
          const delta =
            Math.abs(motion.x - prior.x) +
            Math.abs(motion.y - prior.y) +
            Math.abs(motion.z - prior.z);
          const gravityError = Math.abs(
            Math.sqrt(motion.x ** 2 + motion.y ** 2 + motion.z ** 2) - 1,
          );
          stableSamples.current =
            delta < 0.055 && gravityError < 0.12
              ? Math.min(12, stableSamples.current + 1)
              : Math.max(0, stableSamples.current - 3);
          setStability(stableSamples.current / 12);
          latestMotion.current = motion;
          setMotionReading(motion);
          previousMotion.current = motion;
        });
      })
      .catch(() => {
        if (!active) return;
        setSensorAvailable(false);
        setStability(1);
        latestMotion.current = null;
        setMotionReading(null);
      });
    return () => {
      active = false;
      subscription?.remove();
    };
  }, []);

  useEffect(() => {
    if (
      !region ||
      !captureAngle ||
      !appActive ||
      !screenFocused ||
      pickerInFlight.current ||
      capturePendingCommits.hasPending() ||
      candidate ||
      busy ||
      draftRestoreStarted.current
    )
      return;
    const draft = captureDrafts.find(
      (item) =>
        item.sessionId === activeSessionId &&
        item.region === region &&
        item.angle === captureAngle &&
        !capturePendingCommits.has(item.id) &&
        !captures.some((capture) => capture.id === item.id),
    );
    if (!draft) return;
    draftRestoreStarted.current = true;
    const token = lifecycle.current.beginReviewAction();
    actionBusy.current = true;
    let active = true;
    let openedUri: string | null = null;
    setBusy(true);
    setBusyLabel("Opening saved photo...");
    void (async () => {
      try {
        await captureBackgroundCleanup.wait();
        if (!active || !lifecycle.current.isReviewCurrent(token)) return;
        openedUri = await decryptToTemporaryFile(
          draft.encryptedUri,
          draft.mimeType === "image/png" ? "png" : "jpg",
          `capture:${draft.id}`,
        );
        if (!active || !lifecycle.current.isReviewCurrent(token)) return;
        const restored = await sanitizeSelectedImage(openedUri);
        if (!active || !lifecycle.current.isReviewCurrent(token)) {
          await removeTemporaryFile(restored.uri);
          return;
        }
        temporaryUris.current.add(restored.uri);
        setMouthOnlyConfirmed(false);
        setRegionConfirmed(false);
        setServerPrivacyConsent(false);
        setError(null);
        setCandidate({
          capture: {
            ...restored,
            source: draft.source,
            privacyStatus: "passed",
          },
          quality: draft.quality,
          angle: draft.angle,
          mediaKind: "image",
          guidance: createCaptureGuidanceSnapshot({
            motion: null,
            stability: 1,
            sensorAvailable: false,
            targetWidthPercent: captureGuideSpec(draft.region)
              .targetWidthPercent,
            source: "imported_photo",
          }),
          draftId: draft.id,
          encryptedDraftUri: draft.encryptedUri,
          capturedAt: draft.capturedAt,
        });
      } catch {
        if (active && lifecycle.current.isReviewCurrent(token))
          setError(
            "The saved photo could not open. Choose a new photo or try the camera.",
          );
      } finally {
        await removeTemporaryFile(openedUri);
        if (active && lifecycle.current.isReviewCurrent(token)) {
          setBusy(false);
          actionBusy.current = false;
        }
      }
    })();
    return () => {
      active = false;
      if (lifecycle.current.isReviewCurrent(token)) {
        lifecycle.current.invalidateReview();
        draftRestoreStarted.current = false;
        actionBusy.current = false;
        setBusy(false);
      }
    };
  }, [
    activeSessionId,
    appActive,
    captureAngle,
    captureDrafts,
    captures,
    commitPending,
    region,
    restoreRevision,
    screenFocused,
  ]);

  useEffect(() => {
    if (!settings.voiceInstructions || !detail) return;
    Speech.speak(detail.captureInstruction, { rate: 0.9 });
    return () => {
      void Speech.stop();
    };
  }, [detail, settings.voiceInstructions]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      lifecycle.current.dispose();
      releasePickerLease();
      for (const uri of temporaryUris.current) void removeTemporaryFile(uri);
      temporaryUris.current.clear();
    };
  }, [releasePickerLease]);

  useFocusEffect(
    useCallback(() => {
      lifecycle.current.focus();
      setScreenFocused(true);
      return () => {
        lifecycle.current.blur();
        releasePickerLease();
        cameraRef.current?.stopRecording();
        void videoPlayer.replaceAsync(null).catch(() => undefined);
        for (const uri of temporaryUris.current) void removeTemporaryFile(uri);
        temporaryUris.current.clear();
        if (mounted.current) {
          clearTemporaryReview();
          setScreenFocused(false);
        }
      };
    }, [clearTemporaryReview, releasePickerLease, videoPlayer]),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      lifecycle.current.setAppState(state);
      setAppActive(state === "active");
      if (state !== "active") {
        cameraRef.current?.stopRecording();
        setCameraReady(false);
      }
      if (shouldPurgeBackgroundTemporaryFiles(state)) {
        void videoPlayer.replaceAsync(null).catch(() => undefined);
        clearTemporaryReview();
      }
    });
    return () => subscription.remove();
  }, [clearTemporaryReview, videoPlayer]);

  useEffect(() => {
    if (!recording) return undefined;
    const interval = setInterval(() => {
      const startedAt = recordingStartedAt.current;
      setSweepElapsedMs(
        startedAt ? Math.min(6_000, Date.now() - startedAt) : 0,
      );
    }, 100);
    return () => clearInterval(interval);
  }, [recording]);

  useEffect(() => {
    if (stability < 0.75) autoCaptureTriggered.current = false;
    if (
      !autoCaptureEnabled ||
      isSweep ||
      !permission?.granted ||
      !screenFocused ||
      !appActive ||
      !cameraReady ||
      pickerPending ||
      commitPending ||
      busy ||
      candidate ||
      sweepCandidates.length > 0 ||
      stability < 0.98 ||
      autoCaptureTriggered.current
    ) {
      return undefined;
    }
    autoCaptureTriggered.current = true;
    const timeout = setTimeout(() => autoCaptureAction.current(), 350);
    return () => clearTimeout(timeout);
  }, [
    autoCaptureEnabled,
    appActive,
    busy,
    candidate,
    isSweep,
    permission?.granted,
    screenFocused,
    cameraReady,
    pickerPending,
    commitPending,
    stability,
    sweepCandidates.length,
  ]);

  useEffect(() => {
    setGhostUri(null);
    setGhostError(null);
    if (
      !ghostEnabled ||
      !appActive ||
      !screenFocused ||
      !priorCapture?.encryptedUri ||
      preparedCandidates.length > 0
    ) {
      return undefined;
    }
    let active = true;
    let temporary: string | null = null;
    const token = lifecycle.current.reviewToken();
    const encryptedUri = priorCapture.encryptedUri;
    const extension = priorCapture.mimeType === "image/png" ? "png" : "jpg";
    // Own each effect's asynchronous output until its cleanup runs.
    // https://react.dev/reference/react/useEffect#fetching-data-with-effects
    void (async () => {
      try {
        await captureBackgroundCleanup.wait();
        if (!active || !lifecycle.current.isReviewCurrent(token)) return;
        const uri = await decryptToTemporaryFile(
          encryptedUri,
          extension,
          `capture:${priorCapture.id}`,
        );
        if (!active || !lifecycle.current.isReviewCurrent(token)) {
          await removeTemporaryFile(uri);
          return;
        }
        temporary = uri;
        temporaryUris.current.add(uri);
        setGhostUri(uri);
      } catch {
        if (active && lifecycle.current.isReviewCurrent(token)) {
          setGhostError(
            "The earlier protected image could not be opened as an alignment guide.",
          );
          setGhostEnabled(false);
        }
      }
    })();
    return () => {
      active = false;
      if (temporary) temporaryUris.current.delete(temporary);
      void removeTemporaryFile(temporary);
    };
  }, [
    preparedCandidates.length,
    appActive,
    routeIdentity,
    screenFocused,
    ghostEnabled,
    priorCapture?.encryptedUri,
    priorCapture?.id,
    priorCapture?.mimeType,
  ]);

  if (!region || !detail || !session || !captureAngle) {
    return (
      <Screen title="Unsupported region">
        <Card accent="coral">
          <Text style={{ color: theme.text }}>
            The requested region, angle, or scan session is not available.
          </Text>
          <Button label="Return" onPress={() => router.back()} />
        </Card>
      </Screen>
    );
  }

  const guidanceSnapshot = (
    source: CaptureGuidanceSource,
  ): CaptureGuidanceSnapshot =>
    createCaptureGuidanceSnapshot({
      motion: source === "imported_photo" ? null : latestMotion.current,
      stability,
      sensorAvailable: source === "imported_photo" ? false : sensorAvailable,
      targetWidthPercent: captureGuideSpec(region).targetWidthPercent,
      source,
    });

  const inspectCapture = async (
    capture: SanitizedCapture,
  ): Promise<{ capture: SanitizedCapture; quality: QualityResult }> => {
    const checkedCapture = await checkCapturePrivacy(capture, faceDetector);
    return {
      capture: checkedCapture,
      quality: qualityForSanitizedCapture(checkedCapture),
    };
  };

  const removeReviewedDraft = async (
    item: CandidateState,
    token: CaptureReviewToken,
  ) => {
    const draftId = item.draftId;
    if (!draftId) return;
    await removeCaptureDraft(draftId);
    if (!lifecycle.current.isReviewCurrent(token)) return;
    setCandidate((current) =>
      current && current.draftId === draftId
        ? { ...current, draftId: undefined, encryptedDraftUri: undefined }
        : current,
    );
    setSweepCandidates((current) =>
      current.map((entry) =>
        entry.draftId === draftId
          ? { ...entry, draftId: undefined, encryptedDraftUri: undefined }
          : entry,
      ),
    );
  };

  const prepareCandidate = async (
    capture: SanitizedCapture,
    guidance: CaptureGuidanceSnapshot,
    token: CaptureReviewToken,
  ) => {
    const discardIfStale = async () => {
      if (lifecycle.current.isReviewCurrent(token)) return false;
      await removeTemporaryFile(capture.uri);
      temporaryUris.current.delete(capture.uri);
      return true;
    };
    temporaryUris.current.add(capture.uri);
    if (await discardIfStale()) return;
    setBusyLabel("Checking photo...");
    const inspected = await inspectCapture(capture);
    if (await discardIfStale()) return;
    const { capture: checkedCapture, quality } = inspected;
    if (settings.haptics) {
      await Haptics.notificationAsync(
        quality.accepted
          ? Haptics.NotificationFeedbackType.Success
          : Haptics.NotificationFeedbackType.Warning,
      ).catch(() => undefined);
    }
    if (await discardIfStale()) return;
    const previousCandidates = preparedCandidates.filter(
      (item) => item.capture.uri !== capture.uri,
    );
    try {
      const draftRemovals = await Promise.allSettled(
        previousCandidates.map((item) => removeReviewedDraft(item, token)),
      );
      if (await discardIfStale()) return;
      if (draftRemovals.some((result) => result.status === "rejected")) {
        throw new Error("The previous photo could not be cleared. Try again.");
      }
      await Promise.all(
        previousCandidates.map(async (item) => {
          await removeTemporaryFile(item.capture.uri);
          temporaryUris.current.delete(item.capture.uri);
        }),
      );
    } catch (cleanupError) {
      await removeTemporaryFile(capture.uri);
      temporaryUris.current.delete(capture.uri);
      throw cleanupError;
    }
    if (await discardIfStale()) return;
    setError(null);
    setRejectedQuality(null);
    setRejectedGuidance(null);
    setSuggestedRegion(null);
    setSweepCandidates([]);
    setCandidate({
      capture: checkedCapture,
      quality,
      angle: captureAngle,
      mediaKind: "image",
      guidance,
      capturedAt: new Date().toISOString(),
    });
    setMouthOnlyConfirmed(false);
    setRegionConfirmed(false);
    setServerPrivacyConsent(false);
    setCropOpen(false);
  };

  const takePhoto = async () => {
    if (
      actionBusy.current ||
      pickerInFlight.current ||
      capturePendingCommits.hasPending()
    )
      return;
    const token = lifecycle.current.beginReviewAction();
    if (!lifecycle.current.isReviewCurrent(token)) return;
    actionBusy.current = true;
    setError(null);
    setBusy(true);
    setBusyLabel("Taking photo...");
    let rawPhotoUri: string | null = null;
    const guidance = guidanceSnapshot("live_camera");
    try {
      const photo = await cameraRef.current?.takePictureAsync({
        quality: 0.9,
        skipProcessing: false,
      });
      if (!photo?.uri) throw new Error("The camera did not return an image.");
      rawPhotoUri = photo.uri;
      await prepareCandidate(
        await sanitizeCameraCapture(
          photo.uri,
          sensorAvailable === false || stability >= 0.9,
          facing === "front",
        ),
        guidance,
        token,
      );
    } catch (captureError) {
      if (lifecycle.current.isReviewCurrent(token))
        setError(
          captureError instanceof Error
            ? captureError.message
            : "Capture failed.",
        );
    } finally {
      await removeTemporaryFile(rawPhotoUri);
      if (lifecycle.current.isReviewCurrent(token)) {
        setBusy(false);
        actionBusy.current = false;
      }
    }
  };
  autoCaptureAction.current = () => {
    void takePhoto();
  };

  const recordSweep = async () => {
    if (
      actionBusy.current ||
      pickerInFlight.current ||
      capturePendingCommits.hasPending()
    )
      return;
    const token = lifecycle.current.beginReviewAction();
    if (!lifecycle.current.isReviewCurrent(token)) return;
    actionBusy.current = true;
    setError(null);
    setRejectedQuality(null);
    setRejectedGuidance(null);
    setSuggestedRegion(null);
    setBusy(true);
    setBusyLabel("Recording guided sweep...");
    setRecording(true);
    setSweepElapsedMs(0);
    recordingStartedAt.current = Date.now();
    let rawVideoUri: string | null = null;
    const renderedFrameUris: string[] = [];
    const inspectedFrames: SweepCandidateState[] = [];
    const sweepGuidance = guidanceSnapshot("sweep_start");
    let selectedUris = new Set<string>();
    try {
      const video = await cameraRef.current?.recordAsync({
        maxDuration: 6,
        maxFileSize: 20_000_000,
      });
      const durationMs = Math.min(
        60_000,
        Date.now() - (recordingStartedAt.current ?? Date.now()),
      );
      if (!video?.uri) throw new Error("The camera did not return a sweep.");
      rawVideoUri = video.uri;
      if (!lifecycle.current.isReviewCurrent(token)) return;
      const requests = sweepFrameRequests(durationMs);
      setBusyLabel("Selecting the clearest frames...");
      await videoPlayer.replaceAsync({ uri: video.uri });
      if (!lifecycle.current.isReviewCurrent(token)) return;
      const thumbnails = await videoPlayer.generateThumbnailsAsync(
        requests.map((request) => request.timeMs / 1_000),
        { maxWidth: 2_048, maxHeight: 2_048 },
      );
      if (!lifecycle.current.isReviewCurrent(token)) return;
      if (thumbnails.length !== requests.length) {
        throw new Error(
          "The recorded sweep did not produce every needed frame.",
        );
      }
      for (const [index, thumbnail] of thumbnails.entries()) {
        const request = requests[index];
        if (!request) continue;
        const context = ImageManipulator.manipulate(thumbnail);
        const rendered = await context.renderAsync();
        if (!lifecycle.current.isReviewCurrent(token)) return;
        const saved = await rendered.saveAsync({
          compress: 0.92,
          format: SaveFormat.JPEG,
        });
        renderedFrameUris.push(saved.uri);
        if (!lifecycle.current.isReviewCurrent(token)) return;
        const sanitized = await sanitizeVideoFrame(
          saved.uri,
          facing === "front",
        );
        temporaryUris.current.add(sanitized.uri);
        if (!lifecycle.current.isReviewCurrent(token)) {
          await removeTemporaryFile(sanitized.uri);
          temporaryUris.current.delete(sanitized.uri);
          return;
        }
        try {
          const inspected = await inspectCapture(sanitized);
          inspectedFrames.push({
            ...inspected,
            angle: request.angle,
            mediaKind: "video_frame",
            sourceVideoDurationMs: durationMs,
            frameTimeMs: request.timeMs,
            guidance: sweepGuidance,
          });
          if (!lifecycle.current.isReviewCurrent(token)) return;
        } catch (privacyError) {
          await removeTemporaryFile(sanitized.uri);
          throw new Error(
            privacyError instanceof Error
              ? `${privacyError.message} The sweep was deleted and was not saved or uploaded.`
              : "The on-device privacy check could not inspect the sweep.",
          );
        }
      }
      const best = selectBestSweepFrames(inspectedFrames);
      if (best.length !== 3) {
        const firstRejected = inspectedFrames.find(
          (frame) => !frame.quality.accepted,
        );
        setRejectedQuality(firstRejected?.quality ?? null);
        setRejectedGuidance(firstRejected?.guidance ?? sweepGuidance);
        throw new Error(
          "The sweep did not contain a clear straight, left, and right frame. Record it again more slowly.",
        );
      }
      selectedUris = new Set(best.map((frame) => frame.capture.uri));
      await Promise.all(
        inspectedFrames
          .filter((frame) => !selectedUris.has(frame.capture.uri))
          .map((frame) => removeTemporaryFile(frame.capture.uri)),
      );
      if (!lifecycle.current.isReviewCurrent(token)) return;
      setCandidate(best[0] ?? null);
      setSweepCandidates(best);
      setMouthOnlyConfirmed(false);
      setRegionConfirmed(false);
      if (settings.haptics) {
        await Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success,
        ).catch(() => undefined);
      }
    } catch (sweepError) {
      if (lifecycle.current.isReviewCurrent(token)) {
        setCandidate(null);
        setSweepCandidates([]);
        setMouthOnlyConfirmed(false);
        setRegionConfirmed(false);
        setError(
          sweepError instanceof Error
            ? sweepError.message
            : "The guided sweep could not be prepared.",
        );
      }
    } finally {
      if (lifecycle.current.isReviewCurrent(token)) {
        await videoPlayer.replaceAsync(null).catch(() => undefined);
      } else selectedUris.clear();
      await Promise.all([
        removeTemporaryFile(rawVideoUri),
        ...renderedFrameUris.map((uri) => removeTemporaryFile(uri)),
        ...inspectedFrames
          .filter((frame) => !selectedUris.has(frame.capture.uri))
          .map((frame) => removeTemporaryFile(frame.capture.uri)),
      ]);
      if (lifecycle.current.isReviewCurrent(token)) {
        recordingStartedAt.current = null;
        setRecording(false);
        setBusy(false);
        actionBusy.current = false;
      }
    }
  };

  const askForCamera = async () => {
    setError(null);
    try {
      await requestPermission();
    } catch {
      setError(
        "Camera permission could not be requested. Use a saved photo or open device settings.",
      );
    }
  };

  const choosePhoto = async () => {
    if (
      actionBusy.current ||
      pickerInFlight.current ||
      capturePendingCommits.hasPending()
    )
      return;
    const routeToken = lifecycle.current.routeToken();
    if (!lifecycle.current.isRouteCurrent(routeToken)) return;
    pickerInFlight.current = true;
    waitingForPicker.current = true;
    setPickerPending(true);
    actionBusy.current = true;
    setBusy(true);
    setBusyLabel("Opening photo library...");
    setError(null);
    let pickerTemporaryUri: string | null = null;
    let lease: PickerTemporaryLease | null = null;
    let token: CaptureReviewToken | null = null;
    try {
      await captureBackgroundCleanup.wait();
      if (!lifecycle.current.isRouteCurrent(routeToken)) return;
      lease = await beginPickerTemporaryLease();
      if (!lifecycle.current.isRouteCurrent(routeToken)) return;
      pickerTemporaryLease.current = lease;
      const asset = await pickSelectedPhoto(ImagePicker);
      if (!asset) return;
      pickerTemporaryUri = asset.uri;
      // Android's system picker may background this app. Its new selection is
      // safe to prepare only after foregrounding and the older purge finishes.
      await lifecycle.current.waitForForeground();
      if (!lifecycle.current.isRouteCurrent(routeToken)) return;
      await captureBackgroundCleanup.wait();
      if (!lifecycle.current.isRouteCurrent(routeToken)) return;
      token = lifecycle.current.beginReviewAction();
      if (!lifecycle.current.isReviewCurrent(token)) return;
      waitingForPicker.current = false;
      actionBusy.current = true;
      setBusy(true);
      setBusyLabel("Checking selected image...");
      await prepareCandidate(
        await sanitizeSelectedImage(asset.uri),
        guidanceSnapshot("imported_photo"),
        token,
      );
    } catch (selectionError) {
      if (
        token
          ? lifecycle.current.isReviewCurrent(token)
          : lifecycle.current.isRouteCurrent(routeToken)
      )
        setError(
          selectionError instanceof Error
            ? selectionError.message
            : "The selected image could not be prepared.",
        );
    } finally {
      try {
        try {
          await removePickerTemporaryCopy(pickerTemporaryUri);
        } finally {
          await lease?.release();
        }
      } catch {
        if (lifecycle.current.isRouteCurrent(routeToken)) {
          setError(
            "Temporary photo cleanup failed. Close and reopen the app before choosing another photo.",
          );
        }
      } finally {
        if (pickerTemporaryLease.current === lease)
          pickerTemporaryLease.current = null;
        pickerInFlight.current = false;
        waitingForPicker.current = false;
        if (mounted.current) setPickerPending(false);
        if (
          token
            ? lifecycle.current.isReviewCurrent(token)
            : lifecycle.current.isRouteCurrent(routeToken)
        ) {
          setBusy(false);
          actionBusy.current = false;
          setRestoreRevision((value) => value + 1);
        }
      }
    }
  };

  const retake = async () => {
    if (actionBusy.current) return;
    const token = lifecycle.current.beginReviewAction();
    if (!lifecycle.current.isReviewCurrent(token)) return;
    actionBusy.current = true;
    setBusy(true);
    try {
      const draftRemovals = await Promise.allSettled(
        preparedCandidates.map((item) => removeReviewedDraft(item, token)),
      );
      if (!lifecycle.current.isReviewCurrent(token)) return;
      if (draftRemovals.some((result) => result.status === "rejected")) {
        throw new Error("Draft removal failed.");
      }
      await Promise.all(
        preparedCandidates.map(async (item) => {
          await removeTemporaryFile(item.capture.uri);
          temporaryUris.current.delete(item.capture.uri);
        }),
      );
      if (!lifecycle.current.isReviewCurrent(token)) return;
      setCandidate(null);
      setSweepCandidates([]);
      setRejectedQuality(null);
      setRejectedGuidance(null);
      setSuggestedRegion(null);
      setMouthOnlyConfirmed(false);
      setRegionConfirmed(false);
      setCropOpen(false);
      setServerPrivacyConsent(false);
      setError(null);
    } catch {
      if (lifecycle.current.isReviewCurrent(token))
        setError("The photo could not be cleared. Try again.");
    } finally {
      if (lifecycle.current.isReviewCurrent(token)) {
        setBusy(false);
        actionBusy.current = false;
      }
    }
  };

  const acceptAndAnalyze = async () => {
    if (
      preparedCandidates.length === 0 ||
      !activeSessionId ||
      preparedCandidates.some((item) => !item.quality.accepted) ||
      !mouthOnlyConfirmed ||
      !regionConfirmed ||
      preparedCandidates.some(
        (item) =>
          item.capture.privacyStatus === "unavailable" &&
          !canSendForServerPrivacyCheck(item.capture, serverPrivacyConsent),
      ) ||
      actionBusy.current ||
      capturePendingCommits.hasPending()
    )
      return;
    const token = lifecycle.current.beginReviewAction();
    if (!lifecycle.current.isReviewCurrent(token)) return;
    actionBusy.current = true;
    setBusy(true);
    setBusyLabel("Analyzing photo...");
    setError(null);
    const protectedUris: string[] = [];
    const committedDraftIds: string[] = [];
    let releaseCommit: (() => void) | null = null;
    let captureCommitted = false;
    try {
      const entries: Array<{
        capture: CaptureRecord;
        analysis: Awaited<ReturnType<typeof analyzeCapture>>;
      }> = [];
      for (const [index, prepared] of preparedCandidates.entries()) {
        setBusyLabel(
          preparedCandidates.length === 1
            ? "Analyzing photo..."
            : `Analyzing view ${index + 1} of ${preparedCandidates.length}...`,
        );
        const captureId = prepared.draftId ?? Crypto.randomUUID();
        const capturedAt = prepared.capturedAt ?? new Date().toISOString();
        let draftEncryptedUri = prepared.encryptedDraftUri;
        const draftQuality = retryDraftQuality(prepared.capture);
        if (preparedCandidates.length === 1 && draftQuality) {
          const createdDraft = !draftEncryptedUri;
          draftEncryptedUri ??= await encryptFile(
            prepared.capture.uri,
            `capture:${captureId}`,
          );
          if (createdDraft) protectedUris.push(draftEncryptedUri);
          if (!lifecycle.current.isReviewCurrent(token)) return;
          await saveCaptureDraft({
            id: captureId,
            sessionId: activeSessionId,
            region,
            angle: prepared.angle,
            encryptedUri: draftEncryptedUri,
            mimeType: prepared.capture.mimeType,
            source: prepared.capture.source as "camera" | "photo_library",
            width: prepared.capture.width,
            height: prepared.capture.height,
            byteSize: prepared.capture.byteSize,
            quality: draftQuality,
            capturedAt,
            privacyPassed: true,
          });
          if (createdDraft)
            protectedUris.splice(protectedUris.indexOf(draftEncryptedUri), 1);
          if (!lifecycle.current.isReviewCurrent(token)) return;
          setCandidate({
            ...prepared,
            draftId: captureId,
            encryptedDraftUri: draftEncryptedUri,
            capturedAt,
          });
        }
        const analysis = await analyzeCapture({
          captureId,
          selectedRegion: region,
          imageUri: prepared.capture.uri,
          mimeType: prepared.capture.mimeType,
          inputOrigin: "live_capture",
          localQuality: prepared.quality,
        });
        if (!lifecycle.current.isReviewCurrent(token)) return;
        const serverRejectionReasons = captureStorageRejectionReasons(
          analysis,
          region,
        );
        if (captureAnalysisRetryDisposition(analysis, region) === "reject") {
          if (draftEncryptedUri) {
            await removeCaptureDraft(captureId);
            if (!lifecycle.current.isReviewCurrent(token)) return;
            setCandidate({
              ...prepared,
              draftId: undefined,
              encryptedDraftUri: undefined,
            });
          }
          setRejectedQuality({
            ...analysis.quality,
            accepted: false,
            reasons: serverRejectionReasons,
          });
          setSuggestedRegion(
            captureRegionCorrection(analysis, region, {
              protocol: session.protocol,
              candidateCount: preparedCandidates.length,
            }),
          );
          setRejectedGuidance(prepared.guidance);
          return;
        }
        if (analysis.analysisOrigin === "unavailable") {
          throw new Error(
            humanizeResultReason(
              analysis.abstentionReasons[0] ??
                "Analysis could not finish. Your photo is still here. Try again.",
            ),
          );
        }
        if (analysis.status === "failed")
          throw new Error(
            humanizeResultReason(
              analysis.abstentionReasons[0] ??
                "Analysis could not finish. Your photo is still here. Try again.",
            ),
          );
        // Server privacy, quality, identity and signature checks have passed.
        const encryptedUri =
          draftEncryptedUri ??
          (await encryptFile(prepared.capture.uri, `capture:${captureId}`));
        if (draftEncryptedUri) committedDraftIds.push(captureId);
        else protectedUris.push(encryptedUri);
        if (!lifecycle.current.isReviewCurrent(token)) return;
        entries.push({
          capture: {
            id: captureId,
            sessionId: activeSessionId,
            region,
            angle: prepared.angle,
            mediaKind: prepared.mediaKind,
            capturedAt,
            encryptedUri,
            mimeType: prepared.capture.mimeType,
            inputOrigin: "live_capture",
            captureSource: prepared.capture.source,
            ...(prepared.sourceVideoDurationMs === undefined
              ? {}
              : { sourceVideoDurationMs: prepared.sourceVideoDurationMs }),
            ...(prepared.frameTimeMs === undefined
              ? {}
              : { frameTimeMs: prepared.frameTimeMs }),
            privacyConfirmedByUser: mouthOnlyConfirmed,
            regionConfirmedByUser: regionConfirmed,
            captureGuidance: prepared.guidance,
            quality: analysis.quality,
          },
          analysis,
        });
      }
      if (!lifecycle.current.isReviewCurrent(token)) return;
      releaseCommit = capturePendingCommits.begin(
        entries.map(({ capture }) => capture.id),
      );
      setBusyLabel("Saving photo...");
      await addCaptures(entries);
      captureCommitted = true;
      await Promise.all(committedDraftIds.map((id) => removeCaptureDraft(id)));
      await Promise.all(
        preparedCandidates.map((item) => removeTemporaryFile(item.capture.uri)),
      );
      const primary =
        entries.find(
          ({ capture }) =>
            capture.angle === "primary" || capture.angle === "straight",
        ) ?? entries[0];
      if (!primary) throw new Error("The accepted capture set is empty.");
      if (!lifecycle.current.isReviewCurrent(token)) return;
      router.replace({
        pathname: "/result/[captureId]",
        params: { captureId: primary.capture.id },
      });
    } catch (captureError) {
      if (lifecycle.current.isReviewCurrent(token))
        setError(
          captureError instanceof Error
            ? captureError.message
            : "Could not protect and analyze this capture.",
        );
    } finally {
      try {
        if (!captureCommitted) {
          await Promise.all(
            protectedUris.map((uri) => removeProtectedFile(uri)),
          );
        }
      } finally {
        releaseCommit?.();
        if (lifecycle.current.isReviewCurrent(token)) {
          setBusy(false);
          actionBusy.current = false;
        }
      }
    }
  };

  const switchCamera = async () => {
    if (
      busy ||
      recording ||
      actionBusy.current ||
      pickerInFlight.current ||
      capturePendingCommits.hasPending()
    )
      return;
    const token = lifecycle.current.beginReviewAction();
    if (!lifecycle.current.isReviewCurrent(token)) return;
    actionBusy.current = true;
    setError(null);
    setCameraReady(false);
    await cameraRef.current?.pausePreview().catch(() => undefined);
    if (!lifecycle.current.isReviewCurrent(token)) return;
    setCameraMounted(false);
    requestAnimationFrame(() => {
      if (!lifecycle.current.isReviewCurrent(token)) return;
      const next = facing === "front" ? "back" : "front";
      cameraForSession.set(session.id, next);
      setFacing(next);
      requestAnimationFrame(() => {
        if (!lifecycle.current.isReviewCurrent(token)) return;
        setCameraMounted(true);
        actionBusy.current = false;
      });
    });
  };

  const editPhoto = async (
    edit: Parameters<typeof editSanitizedCapture>[1],
  ) => {
    if (!candidate || actionBusy.current) return;
    const token = lifecycle.current.beginReviewAction();
    if (!lifecycle.current.isReviewCurrent(token)) return;
    actionBusy.current = true;
    setBusy(true);
    setBusyLabel("Checking photo...");
    setError(null);
    try {
      const edited = await editSanitizedCapture(candidate.capture, edit);
      await prepareCandidate(edited, candidate.guidance, token);
    } catch {
      if (lifecycle.current.isReviewCurrent(token))
        setError(
          "The photo could not be edited. Your original photo is still here.",
        );
    } finally {
      if (lifecycle.current.isReviewCurrent(token)) {
        setBusy(false);
        actionBusy.current = false;
      }
    }
  };

  const progress = scanProgress(captures, session.id);
  const suggestedDetail = MOUTH_REGION_DETAILS.find(
    (item) => item.id === suggestedRegion,
  );
  const privacyUnavailable = candidate?.capture.privacyStatus === "unavailable";
  const needsCrop = candidate?.capture.privacyStatus === "face_detected";
  const serverPrivacyReady = candidate
    ? canSendForServerPrivacyCheck(candidate.capture, serverPrivacyConsent)
    : false;

  return (
    <Screen
      title={candidate ? "Review photo" : detail.shortLabel}
      eyebrow={`Region ${Math.min(8, progress.completed + 1)} of 8`}
      action={
        <Button
          label="Back"
          variant="ghost"
          disabled={busy || commitPending}
          onPress={() => router.back()}
        />
      }
    >
      {!candidate ? (
        <>
          <View style={[styles.cameraShell, { backgroundColor: theme.navy }]}>
            {permission?.granted &&
            cameraMounted &&
            screenFocused &&
            appActive ? (
              <CameraView
                key={facing}
                ref={cameraRef}
                style={StyleSheet.absoluteFill}
                facing={facing}
                mirror={facing === "front"}
                mode={isSweep ? "video" : "picture"}
                mute
                videoQuality="720p"
                onCameraReady={() => setCameraReady(true)}
                onMountError={() => {
                  setCameraReady(false);
                  setError(
                    "The camera could not open. Try switching cameras or choose a photo.",
                  );
                }}
              />
            ) : !permission?.granted ? (
              <View style={styles.permission}>
                <Text style={styles.permissionText}>
                  Use the camera or choose a mouth photo.
                </Text>
                <Button
                  label={
                    permission?.canAskAgain === false
                      ? "Open device settings"
                      : "Allow camera"
                  }
                  onPress={() => {
                    if (permission?.canAskAgain === false)
                      void Linking.openSettings();
                    else void askForCamera();
                  }}
                />
              </View>
            ) : null}
            {permission?.granted && ghostUri ? (
              <View pointerEvents="none" style={styles.ghostLayer}>
                <Image
                  accessible={false}
                  source={{ uri: ghostUri }}
                  resizeMode="cover"
                  style={[
                    StyleSheet.absoluteFill,
                    facing === "front" ? styles.mirroredOverlay : undefined,
                  ]}
                />
              </View>
            ) : null}
            {permission?.granted ? (
              <View pointerEvents="none" style={styles.guide}>
                <CaptureGuideOverlay
                  region={region}
                  mirrored={mirrorGuide !== (facing === "front")}
                />
                <Text style={styles.instruction}>
                  {recording
                    ? sweepInstruction(sweepElapsedMs / 6000)
                    : detail.captureInstruction}
                </Text>
                {recording ? (
                  <Text style={styles.recordingLabel}>
                    Recording · {(sweepElapsedMs / 1000).toFixed(1)} of 6
                    seconds
                  </Text>
                ) : null}
                <StabilityIndicator
                  progress={stability}
                  available={sensorAvailable}
                />
                <CaptureGuidanceMetrics
                  snapshot={createCaptureGuidanceSnapshot({
                    motion: motionReading,
                    stability,
                    sensorAvailable,
                    targetWidthPercent:
                      captureGuideSpec(region).targetWidthPercent,
                    source: "live_camera",
                  })}
                  tone="camera"
                />
              </View>
            ) : null}
          </View>
          <Button
            label={
              recording
                ? "Stop recording"
                : isSweep
                  ? "Record sweep"
                  : "Take photo"
            }
            icon={recording ? "stop-circle-outline" : "camera"}
            loading={(busy && !recording) || commitPending}
            loadingLabel={commitPending ? "Saving photo..." : busyLabel}
            disabled={
              !permission?.granted ||
              !cameraReady ||
              pickerPending ||
              commitPending ||
              (busy && !recording)
            }
            onPress={() => {
              if (recording) cameraRef.current?.stopRecording();
              else if (isSweep) void recordSweep();
              else void takePhoto();
            }}
          />
          <View style={styles.secondaryActions}>
            {!isSweep ? (
              <Button
                label="Choose photo"
                icon="images-outline"
                variant="ghost"
                disabled={busy || pickerPending || commitPending}
                onPress={() => void choosePhoto()}
                style={styles.secondaryAction}
              />
            ) : null}
            <Button
              label="Switch camera"
              icon="camera-reverse-outline"
              variant="ghost"
              disabled={
                busy || pickerPending || commitPending || !permission?.granted
              }
              onPress={() => void switchCamera()}
              style={styles.secondaryAction}
            />
          </View>
          <Button
            label={moreOptions ? "Hide options" : "More options"}
            icon="options-outline"
            variant="ghost"
            disabled={busy || commitPending}
            onPress={() => setMoreOptions((value) => !value)}
          />
          {moreOptions ? (
            <View style={styles.captureOptions}>
              {!isSweep ? (
                <ChoiceChip
                  label="Take photo automatically when still"
                  selected={autoCaptureEnabled}
                  onPress={() => setAutoCaptureEnabled((value) => !value)}
                  accessibilityRole="checkbox"
                />
              ) : null}
              <ChoiceChip
                label="Flip guide"
                selected={mirrorGuide}
                onPress={() => setMirrorGuide((value) => !value)}
                accessibilityRole="checkbox"
              />
              {priorCapture ? (
                <Button
                  label={
                    ghostEnabled ? "Hide earlier photo" : "Show earlier photo"
                  }
                  icon="layers-outline"
                  variant="ghost"
                  onPress={() => setGhostEnabled((value) => !value)}
                />
              ) : null}
              {ghostError ? (
                <Text style={[styles.error, { color: theme.danger }]}>
                  {ghostError}
                </Text>
              ) : null}
            </View>
          ) : null}
          {settings.caregiverMode ? (
            <Text style={[styles.sensorNote, { color: theme.secondaryText }]}>
              Make sure the person is comfortable and has agreed to each photo.
            </Text>
          ) : null}
          {rejectedQuality ? (
            <Text style={[styles.reason, { color: theme.danger }]}>
              {rejectedQuality.reasons.map(humanizeResultReason).join(" ")}
            </Text>
          ) : null}
        </>
      ) : cropOpen ? (
        <PhotoCropEditor
          uri={candidate.capture.uri}
          width={candidate.capture.width}
          height={candidate.capture.height}
          busy={busy}
          onCrop={(crop) => void editPhoto({ crop })}
          onCancel={() => setCropOpen(false)}
        />
      ) : (
        <>
          {sweepCandidates.length > 0 ? (
            <View style={styles.sweepPreviewList}>
              {sweepCandidates.map((item) => (
                <View key={item.angle} style={styles.sweepPreviewItem}>
                  <Image
                    accessibilityLabel={`${item.angle.replaceAll("_", " ")} photo`}
                    source={{ uri: item.capture.uri }}
                    resizeMode="contain"
                    style={[
                      styles.sweepPreview,
                      { backgroundColor: theme.navy },
                    ]}
                  />
                  <Text
                    style={[styles.sweepPreviewLabel, { color: theme.text }]}
                  >
                    {item.angle.replaceAll("_", " ")}
                  </Text>
                </View>
              ))}
            </View>
          ) : (
            <Image
              accessibilityLabel={`Photo of ${detail.label}`}
              source={{ uri: candidate.capture.uri }}
              resizeMode="contain"
              style={[styles.preview, { backgroundColor: theme.navy }]}
            />
          )}
          <Text style={[styles.reviewInstruction, { color: theme.text }]}>
            {needsCrop
              ? "Crop out the face. Keep only the mouth area."
              : privacyUnavailable
                ? "Crop to the mouth area so the service can check this photo."
                : "Check that the mouth area is clear and fully visible."}
          </Text>
          {candidate.quality.reasons.map((reason) => (
            <Text key={reason} style={[styles.reason, { color: theme.danger }]}>
              {humanizeResultReason(reason)}
            </Text>
          ))}
          {rejectedQuality ? (
            <Text
              accessibilityRole="alert"
              style={[styles.reason, { color: theme.danger }]}
            >
              {rejectedQuality.reasons.map(humanizeResultReason).join(" ")}
            </Text>
          ) : null}
          {suggestedDetail ? (
            <Button
              label={`Change to ${suggestedDetail.shortLabel.toLowerCase()}`}
              variant="secondary"
              disabled={busy}
              onPress={() => {
                lifecycle.current.invalidateReview();
                setCorrectedRegion({
                  region: suggestedDetail.id,
                  routeIdentity,
                });
                setSuggestedRegion(null);
                setMouthOnlyConfirmed(false);
                setRegionConfirmed(false);
                setServerPrivacyConsent(false);
                setRejectedQuality(null);
                setRejectedGuidance(null);
                setError(null);
              }}
            />
          ) : null}
          {!isSweep ? (
            <View style={styles.secondaryActions}>
              <Button
                label="Crop"
                icon="crop-outline"
                variant="ghost"
                disabled={busy}
                onPress={() => setCropOpen(true)}
                style={styles.secondaryAction}
              />
              <Button
                label="Rotate"
                icon="refresh-outline"
                variant="ghost"
                disabled={busy}
                onPress={() => void editPhoto({ rotate: 90 })}
                style={styles.secondaryAction}
              />
            </View>
          ) : null}
          {!needsCrop && candidate.quality.accepted ? (
            <>
              <ChoiceChip
                label={`This shows ${detail.label} only, and I have permission to use it.`}
                selected={mouthOnlyConfirmed && regionConfirmed}
                onPress={() => {
                  const confirmed = !(mouthOnlyConfirmed && regionConfirmed);
                  setMouthOnlyConfirmed(confirmed);
                  setRegionConfirmed(confirmed);
                }}
                accessibilityRole="checkbox"
              />
              {privacyUnavailable && candidate.capture.cropped ? (
                <ChoiceChip
                  label="Send this cropped photo for a private service check."
                  selected={serverPrivacyConsent}
                  onPress={() => setServerPrivacyConsent((value) => !value)}
                  accessibilityRole="checkbox"
                />
              ) : null}
              <Button
                label="Use photo"
                icon="checkmark"
                loading={busy}
                loadingLabel={busyLabel}
                disabled={
                  !mouthOnlyConfirmed ||
                  !regionConfirmed ||
                  (privacyUnavailable && !serverPrivacyReady)
                }
                onPress={() => void acceptAndAnalyze()}
              />
            </>
          ) : needsCrop ? (
            <Button
              label="Crop mouth area"
              icon="crop-outline"
              disabled={busy}
              onPress={() => setCropOpen(true)}
            />
          ) : null}
          <Button
            label={
              candidate.capture.source === "photo_library"
                ? "Choose another"
                : "Retake"
            }
            icon="refresh"
            variant="ghost"
            disabled={busy}
            onPress={() => {
              if (candidate.capture.source === "photo_library")
                void choosePhoto();
              else void retake();
            }}
          />
        </>
      )}
      {error ? (
        <View style={styles.errorGroup}>
          <Text
            accessibilityRole="alert"
            style={[styles.error, { color: theme.danger }]}
          >
            {error}
          </Text>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  cameraShell: {
    flex: 1,
    minHeight: 420,
    borderRadius: 16,
    overflow: "hidden",
  },
  permission: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 30,
    gap: 16,
  },
  permissionText: { color: "#FFFFFF", textAlign: "center", lineHeight: 20 },
  guide: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
    gap: 8,
  },
  ghostLayer: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    opacity: 0.32,
  },
  ghostLabel: {
    color: "#FFFFFF",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "900",
    textAlign: "center",
    backgroundColor: "rgba(11,122,117,0.82)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  instruction: {
    color: "#FFFFFF",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    textAlign: "center",
    backgroundColor: "rgba(0,0,0,0.52)",
    padding: 9,
    borderRadius: 10,
  },
  recordingLabel: {
    color: "#FFFFFF",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "800",
    backgroundColor: "rgba(166,52,42,0.88)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  privacy: { fontSize: 11, lineHeight: 16, textAlign: "center" },
  sensorNote: { fontSize: 12, lineHeight: 18, textAlign: "center" },
  preview: { width: "100%", height: 290, borderRadius: 16 },
  sweepPreviewList: { flexDirection: "row", gap: 8 },
  sweepPreviewItem: { flex: 1, gap: 6 },
  sweepPreview: { width: "100%", height: 150, borderRadius: 13 },
  sweepPreviewLabel: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "800",
    textAlign: "center",
    textTransform: "capitalize",
  },
  captureOptions: { gap: 8 },
  secondaryActions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  secondaryAction: { flexGrow: 1, minWidth: 120 },
  reviewInstruction: { fontSize: 16, lineHeight: 23 },
  mirroredOverlay: { transform: [{ scaleX: -1 }] },
  reason: { fontSize: 13, lineHeight: 19, fontWeight: "700" },
  error: { textAlign: "center", fontSize: 13, fontWeight: "700" },
  errorGroup: { gap: 8 },
});
