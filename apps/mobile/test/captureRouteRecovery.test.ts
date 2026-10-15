import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONTRACT_VERSION,
  DISCLAIMER,
  type AnalysisResult,
  type MouthRegion,
} from "@stoma3d/contracts";
import type { SanitizedCapture } from "../src/lib/imagePipeline";
import type { CaptureDraft } from "../src/lib/captureDrafts";
import { captureBackgroundCleanup } from "../src/lib/captureLifecycle";
import {
  beginPickerTemporaryLease,
  purgeStoma3DBackgroundTemporaryFiles,
  purgeStoma3DTemporaryFiles,
  removePickerTemporaryCopy,
} from "../src/lib/tempFiles";

// Lifecycle wiring only: execute the real route and its handlers, with persistent
// hook slots and controlled native boundaries. This is not a native UI mount.
const runtime = vi.hoisted(() => ({
  cursor: 0,
  slots: [] as Array<{
    value?: unknown;
    dependencies?: readonly unknown[];
    cleanup?: () => void;
  }>,
  pendingEffects: [] as Array<() => void>,
  dirty: false,
  renderedTree: null as unknown,
  unmounted: false,
  updatesAfterUnmount: 0,
  focused: true,
  focusSetup: null as (() => (() => void) | void) | null,
  focusCleanup: null as (() => void) | null,
  appState: "active",
  appListeners: new Set<(state: string) => void>(),
  store: {} as Record<string, unknown>,
  params: { region: "dorsal_tongue", angle: "primary" },
  picker: vi.fn(),
  sanitize: vi.fn(),
  edit: vi.fn(),
  analyze: vi.fn(),
  encrypt: vi.fn(),
  decrypt: vi.fn(),
  removeTemporary: vi.fn(),
  removeProtected: vi.fn(),
  removePicker: vi.fn(),
  files: new Set<string>(),
  fileInfo: vi.fn(),
  readDirectory: vi.fn(),
  deleteFile: vi.fn(),
  priorCapture: null as null | {
    id: string;
    encryptedUri: string;
    mimeType: string;
  },
  addCaptures: vi.fn(),
  saveDraft: vi.fn(),
  removeDraft: vi.fn(),
  navigate: vi.fn(),
  faceDetector: {
    status: "ready",
    initialize: vi.fn(),
    detectFaces: vi.fn(),
  },
  cameraRefAssigned: false,
  camera: {
    recordAsync: vi.fn(),
    stopRecording: vi.fn(),
    takePictureAsync: vi.fn(),
    pausePreview: vi.fn(),
  },
  videoPlayer: { replaceAsync: vi.fn(), generateThumbnailsAsync: vi.fn() },
}));

vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  const dependenciesMatch = (
    prior?: readonly unknown[],
    next?: readonly unknown[],
  ) =>
    prior !== undefined &&
    next !== undefined &&
    prior.length === next.length &&
    prior.every((value, index) => Object.is(value, next[index]));
  return {
    ...react,
    useState: (initial: unknown) => {
      const index = runtime.cursor++;
      runtime.slots[index] ??= {
        value: typeof initial === "function" ? initial() : initial,
      };
      return [
        runtime.slots[index].value,
        (change: unknown) => {
          if (runtime.unmounted) runtime.updatesAfterUnmount += 1;
          const prior = runtime.slots[index].value;
          const next = typeof change === "function" ? change(prior) : change;
          if (!Object.is(prior, next)) {
            runtime.slots[index].value = next;
            runtime.dirty = true;
          }
        },
      ];
    },
    useRef: (initial: unknown) => {
      const index = runtime.cursor++;
      if (initial === null && !runtime.cameraRefAssigned) {
        initial = runtime.camera;
        runtime.cameraRefAssigned = true;
      }
      runtime.slots[index] ??= { value: { current: initial } };
      return runtime.slots[index].value;
    },
    useCallback: (callback: unknown, dependencies: readonly unknown[]) => {
      const index = runtime.cursor++;
      const prior = runtime.slots[index];
      if (!prior || !dependenciesMatch(prior.dependencies, dependencies))
        runtime.slots[index] = { value: callback, dependencies };
      return runtime.slots[index].value;
    },
    useEffect: (
      setup: () => (() => void) | void,
      dependencies?: readonly unknown[],
    ) => {
      const index = runtime.cursor++;
      const prior = runtime.slots[index];
      if (prior && dependenciesMatch(prior.dependencies, dependencies)) return;
      const slot = { dependencies, cleanup: prior?.cleanup };
      runtime.slots[index] = slot;
      runtime.pendingEffects.push(() => {
        slot.cleanup?.();
        slot.cleanup = setup() ?? undefined;
      });
    },
  };
});
vi.mock("expo-router", () => ({
  router: { replace: runtime.navigate, back: vi.fn() },
  useLocalSearchParams: () => runtime.params,
  useFocusEffect: (setup: () => (() => void) | void) => {
    if (runtime.focusSetup === setup) return;
    runtime.focusCleanup?.();
    runtime.focusSetup = setup;
    runtime.focusCleanup = runtime.focused ? (setup() ?? null) : null;
  },
}));
vi.mock("react-native", () => ({
  AppState: {
    get currentState() {
      return runtime.appState;
    },
    addEventListener: (_event: string, listener: (state: string) => void) => {
      runtime.appListeners.add(listener);
      return { remove: () => runtime.appListeners.delete(listener) };
    },
  },
  Image: "Image",
  Text: "Text",
  View: "View",
  Linking: { openSettings: vi.fn() },
  StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
}));
vi.mock("@infinitered/react-native-mlkit-face-detection", () => ({
  useFaceDetection: () => runtime.faceDetector,
}));
vi.mock("expo-camera", () => ({
  CameraView: "CameraView",
  useCameraPermissions: () => [{ granted: true }, vi.fn()],
}));
vi.mock("expo-video", () => ({
  useVideoPlayer: () => runtime.videoPlayer,
}));
vi.mock("expo-image-manipulator", () => ({
  ImageManipulator: {},
  SaveFormat: {},
}));
vi.mock("expo-sensors", () => ({
  Accelerometer: { isAvailableAsync: async () => false },
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => "fixture-capture" }));
vi.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///cache/",
  getInfoAsync: runtime.fileInfo,
  readDirectoryAsync: runtime.readDirectory,
  deleteAsync: runtime.deleteFile,
}));
vi.mock("expo-haptics", () => ({
  notificationAsync: async () => undefined,
  NotificationFeedbackType: { Success: "success", Warning: "warning" },
}));
vi.mock("expo-image-picker", () => ({}));
vi.mock("expo-speech", () => ({ speak: vi.fn(), stop: vi.fn() }));
vi.mock("@/components/CaptureGuideOverlay", () => ({
  CaptureGuideOverlay: "CaptureGuideOverlay",
}));
vi.mock("@/components/CaptureGuidanceMetrics", () => ({
  CaptureGuidanceMetrics: "CaptureGuidanceMetrics",
}));
vi.mock("@/components/StabilityIndicator", () => ({
  StabilityIndicator: "StabilityIndicator",
}));
vi.mock("@/components/Screen", () => ({ Screen: "Screen" }));
vi.mock("@/components/Ui", () => ({
  Button: "Button",
  Card: "Card",
  ChoiceChip: "ChoiceChip",
}));
vi.mock("@/components/PhotoCropEditor", () => ({
  PhotoCropEditor: "PhotoCropEditor",
}));
vi.mock(
  "@/components/captureGuidance",
  () => import("../src/components/captureGuidance"),
);
vi.mock("@/lib/captureGuide", () => import("../src/lib/captureGuide"));
vi.mock("@/lib/analysisPolicy", () => import("../src/lib/analysisPolicy"));
vi.mock("@/lib/captureLifecycle", () => import("../src/lib/captureLifecycle"));
vi.mock("@/lib/privacyPolicy", () => import("../src/lib/privacyPolicy"));
vi.mock("@/lib/resultCopy", () => import("../src/lib/resultCopy"));
vi.mock("@/lib/longitudinalPolicy", () => ({
  latestPriorAcceptedCapture: () => runtime.priorCapture,
}));
vi.mock("@/lib/scanLogic", () => ({ scanProgress: () => ({ completed: 0 }) }));
vi.mock("@/lib/videoSweep", () => ({
  selectBestSweepFrames: vi.fn(),
  sweepFrameRequests: vi.fn(),
  sweepInstruction: vi.fn(),
}));
vi.mock("@/lib/photoPicker", () => ({ pickSelectedPhoto: runtime.picker }));
vi.mock("@/lib/api", () => ({ analyzeCapture: runtime.analyze }));
vi.mock("@/lib/imagePipeline", () => ({
  sanitizeSelectedImage: runtime.sanitize,
  sanitizeCameraCapture: runtime.sanitize,
  sanitizeVideoFrame: runtime.sanitize,
  editSanitizedCapture: runtime.edit,
  qualityForSanitizedCapture: () => ({
    accepted: true,
    blurScore: 0.9,
    exposureScore: 0.9,
    glareScore: 0,
    obstructionScore: 0,
    faceDetected: false,
    reasons: [],
  }),
}));
vi.mock("@/lib/secureFiles", () => ({
  encryptFile: runtime.encrypt,
  decryptToTemporaryFile: runtime.decrypt,
  removeTemporaryFile: runtime.removeTemporary,
  removeProtectedFile: runtime.removeProtected,
}));
vi.mock("@/lib/tempFiles", async () => ({
  ...(await import("../src/lib/tempFiles")),
  removePickerTemporaryCopy: runtime.removePicker,
}));
vi.mock("@/store/useStoma3DStore", () => ({
  useStoma3DStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) =>
      selector(runtime.store),
    { getState: () => runtime.store },
  ),
}));
vi.mock("@/theme", () => ({ useAppTheme: () => ({}) }));

import CaptureRoute from "../app/capture/[region]";

const photo: SanitizedCapture = {
  uri: "file:///cache/stoma3d-capture/fixture-photo.jpg",
  mimeType: "image/jpeg",
  source: "photo_library",
  width: 1200,
  height: 900,
  byteSize: 180000,
  privacyStatus: "passed",
  telemetry: {
    edgeStrength: 0.8,
    focusVariance: 0.02,
    meanLuminance: 0.55,
    highlightFraction: 0,
    obstructionEstimate: 0,
    faceDetected: false,
    stable: true,
    measurementStatus: "measured",
    wellExposedFraction: 0.95,
  },
};

function analysis(region: MouthRegion, matches = true): AnalysisResult {
  return {
    contractVersion: CONTRACT_VERSION,
    captureId: "fixture-capture",
    region,
    quality: {
      accepted: true,
      blurScore: 0.9,
      exposureScore: 0.9,
      glareScore: 0,
      obstructionScore: 0,
      faceDetected: false,
      reasons: [],
    },
    anatomyPrediction: {
      region: matches ? region : "ventral_tongue",
      confidence: 0.95,
      supported: true,
      selectedRegionMatches: matches,
    },
    candidateMask: null,
    descriptors: null,
    appearanceOutput: null,
    diseaseResearchOutput: null,
    uncertainty: {
      overallConfidence: 0.9,
      imageQualityConfidence: 0.9,
      datasetSimilarity: 0.9,
      modelAgreement: 0.9,
      limitations: [],
    },
    abstentionReasons: [],
    modelVersions: { anatomy: "fixture" },
    inputOrigin: "live_capture",
    analysisOrigin: "live_model",
    status: matches ? "complete" : "unsupported",
    disclaimer: DISCLAIMER,
  };
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

type NodeProps = {
  children?: ReactNode;
  action?: ReactNode;
  label?: string;
  selected?: boolean;
  disabled?: boolean;
  uri?: string;
  source?: { uri: string };
  onPress?: () => void;
  onCancel?: () => void;
  onCameraReady?: () => void;
};

function nodes(node: ReactNode): ReactElement<NodeProps>[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement<NodeProps>(node)) return [];
  return [node, ...nodes(node.props.children), ...nodes(node.props.action)];
}

function renderRoute() {
  let tree: ReactNode;
  for (let pass = 0; pass < 20; pass++) {
    runtime.cursor = 0;
    runtime.dirty = false;
    tree = CaptureRoute();
    runtime.pendingEffects.splice(0).forEach((setup) => setup());
    if (!runtime.dirty) {
      runtime.renderedTree = tree;
      return tree;
    }
  }
  throw new Error("The route hook harness did not settle.");
}

const finishMicrotasks = () =>
  new Promise<void>((resolve) => setImmediate(resolve));
async function settle() {
  for (let pass = 0; pass < 3; pass++) {
    await finishMicrotasks();
    renderRoute();
  }
  return renderRoute();
}

function control(label: string | RegExp) {
  const found = nodes(renderRoute()).find((node) =>
    typeof label === "string"
      ? node.props.label === label
      : label.test(node.props.label ?? ""),
  );
  expect(found, `Expected a route control matching ${label}`).toBeDefined();
  return found!;
}

function previewUri() {
  return nodes(renderRoute()).find((node) => node.type === "Image")?.props
    .source?.uri;
}

function appState(state: string) {
  runtime.appState = state;
  runtime.appListeners.forEach((listener) => listener(state));
  return renderRoute();
}

function blur() {
  runtime.focused = false;
  runtime.focusCleanup?.();
  runtime.focusCleanup = null;
  renderRoute();
}

function focus() {
  runtime.focused = true;
  runtime.focusCleanup = runtime.focusSetup?.() ?? null;
  renderRoute();
}

function unmount() {
  runtime.slots.forEach((slot) => slot.cleanup?.());
  runtime.focusCleanup?.();
  runtime.focusCleanup = null;
  runtime.unmounted = true;
}

async function settleUnmounted() {
  for (let pass = 0; pass < 3; pass++) await finishMicrotasks();
  expect(runtime.updatesAfterUnmount).toBe(0);
}

async function choosePhoto() {
  control("Choose photo").props.onPress!();
  await settle();
  expect(previewUri()).toBe(photo.uri);
}

function confirmPhoto() {
  control(/This shows .* only, and I have permission/).props.onPress!();
  expect(control("Use photo").props.disabled).toBe(false);
}

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  runtime.slots.forEach((slot) => slot.cleanup?.());
  runtime.focusCleanup?.();
  vi.clearAllMocks();
  runtime.cursor = 0;
  runtime.slots = [];
  runtime.pendingEffects = [];
  runtime.dirty = false;
  runtime.renderedTree = null;
  runtime.unmounted = false;
  runtime.updatesAfterUnmount = 0;
  runtime.focused = true;
  runtime.focusSetup = null;
  runtime.focusCleanup = null;
  runtime.appState = "active";
  runtime.appListeners.clear();
  runtime.cameraRefAssigned = false;
  runtime.files.clear();
  runtime.priorCapture = null;
  runtime.fileInfo.mockImplementation(async (uri: string) => ({
    exists:
      runtime.files.has(uri) ||
      [...runtime.files].some((file) => file.startsWith(uri)),
  }));
  runtime.readDirectory.mockImplementation(async (uri: string) =>
    [...runtime.files]
      .filter((file) => file.startsWith(uri))
      .map((file) => file.slice(uri.length)),
  );
  runtime.deleteFile.mockImplementation(async (uri: string) => {
    for (const file of runtime.files) {
      if (file === uri || file.startsWith(uri.endsWith("/") ? uri : `${uri}/`))
        runtime.files.delete(file);
    }
  });
  runtime.params = { region: "dorsal_tongue", angle: "primary" };
  runtime.store = {
    activeSessionId: "fixture-session",
    sessions: [
      { id: "fixture-session", protocol: "standard_eight_region", demo: false },
    ],
    settings: { haptics: false, voiceInstructions: false },
    captures: [],
    captureDrafts: [],
    addCaptures: runtime.addCaptures,
    saveCaptureDraft: runtime.saveDraft,
    removeCaptureDraft: runtime.removeDraft,
  };
  runtime.picker.mockImplementation(async () => {
    const uri = "file:///cache/ImagePicker/fixture.jpg";
    runtime.files.add(uri);
    return { uri };
  });
  runtime.sanitize.mockResolvedValue(photo);
  runtime.edit.mockResolvedValue({
    ...photo,
    uri: "file:///cache/stoma3d-capture/fixture-edit.jpg",
  });
  runtime.analyze.mockImplementation(
    async (input: { selectedRegion: MouthRegion }) =>
      analysis(input.selectedRegion),
  );
  runtime.encrypt.mockResolvedValue(
    "file:///documents/stoma3d-vault/fixture.osv",
  );
  runtime.decrypt.mockResolvedValue(
    "file:///cache/stoma3d-capture/fixture-restored.jpg",
  );
  runtime.removeTemporary.mockResolvedValue(undefined);
  runtime.removeProtected.mockResolvedValue(undefined);
  runtime.removePicker.mockImplementation(removePickerTemporaryCopy);
  runtime.addCaptures.mockResolvedValue(undefined);
  runtime.saveDraft.mockImplementation(async (draft: CaptureDraft) => {
    runtime.store.captureDrafts = [draft];
  });
  runtime.removeDraft.mockImplementation(async () => {
    runtime.store.captureDrafts = [];
  });
  runtime.faceDetector.detectFaces.mockResolvedValue({ faces: [] });
  runtime.videoPlayer.replaceAsync.mockResolvedValue(undefined);
  runtime.camera.takePictureAsync.mockResolvedValue({
    uri: "file:///cache/camera-new.jpg",
  });
  runtime.camera.pausePreview.mockResolvedValue(undefined);
});

afterEach(() => {
  if (!runtime.unmounted) unmount();
  vi.unstubAllGlobals();
});

describe("native capture recovery wiring", () => {
  it.each([
    ["image_too_blurry", "The image is too blurry."],
    ["exposure_out_of_range", "The image is too dark or too bright."],
    ["excessive_glare", "Reflections cover too much of the image."],
    ["image_too_small", "The image is too small to evaluate reliably."],
    ["face_detected", "A face or identifying facial area was detected."],
  ])(
    "handles a verified %s rejection before unavailable model output",
    async (reason, expectedMessage) => {
      await choosePhoto();
      confirmPhoto();
      const rejected = analysis("dorsal_tongue");
      runtime.analyze.mockResolvedValueOnce({
        ...rejected,
        quality: {
          ...rejected.quality,
          accepted: false,
          faceDetected: reason === "face_detected",
          reasons: [reason],
        },
        anatomyPrediction: {
          region: null,
          confidence: 0,
          supported: false,
          selectedRegionMatches: false,
        },
        analysisOrigin: "unavailable",
        status: "abstained",
        abstentionReasons: [reason],
      });

      control("Use photo").props.onPress!();
      await settle();

      expect(runtime.store.captureDrafts).toEqual([]);
      expect(runtime.store.captures).toEqual([]);
      expect(runtime.addCaptures).not.toHaveBeenCalled();
      expect(runtime.navigate).not.toHaveBeenCalled();
      expect(previewUri()).toBe(photo.uri);
      const messages = nodes(renderRoute())
        .map((node) => node.props.children)
        .filter((text): text is string => typeof text === "string");
      expect(
        messages.filter((text) => text.startsWith(expectedMessage)),
      ).toHaveLength(1);
      expect(messages).not.toContain(reason);
      expect(messages.join(" ")).not.toContain(
        "mouth region could not be confirmed",
      );
      expect(control("Choose another").props.disabled).toBe(false);
    },
  );

  it.each(["analysis_unavailable", "face_check_unavailable"])(
    "keeps the encrypted retry draft for %s without misreporting blur",
    async (reason) => {
      await choosePhoto();
      confirmPhoto();
      const result = analysis("dorsal_tongue");
      runtime.analyze.mockResolvedValueOnce({
        ...result,
        quality: { ...result.quality, accepted: false, reasons: [reason] },
        anatomyPrediction: {
          region: null,
          confidence: 0,
          supported: false,
          selectedRegionMatches: false,
        },
        analysisOrigin: "unavailable",
        status: "failed",
        abstentionReasons: [reason],
      });
      control("Use photo").props.onPress!();
      await settle();
      expect(runtime.store.captureDrafts).toHaveLength(1);
      expect(runtime.removeDraft).not.toHaveBeenCalled();
      expect(runtime.addCaptures).not.toHaveBeenCalled();
      expect(runtime.navigate).not.toHaveBeenCalled();
      expect(previewUri()).toBe(photo.uri);
      expect(control("Use photo").props.disabled).toBe(false);
      const messages = nodes(renderRoute())
        .map((node) => node.props.children)
        .filter((text): text is string => typeof text === "string");
      expect(messages).not.toContain(reason);
      expect(messages.join(" ")).not.toContain("blurry");
      expect(messages.join(" ")).not.toContain(
        "mouth region could not be confirmed",
      );
    },
  );

  it("accepts a clear replacement after a measured quality rejection", async () => {
    await choosePhoto();
    confirmPhoto();
    const result = analysis("dorsal_tongue");
    runtime.analyze.mockResolvedValueOnce({
      ...result,
      quality: {
        ...result.quality,
        accepted: false,
        reasons: ["image_too_blurry"],
      },
      analysisOrigin: "unavailable",
      status: "abstained",
      abstentionReasons: ["image_too_blurry"],
    });
    control("Use photo").props.onPress!();
    await settle();
    expect(runtime.store.captureDrafts).toEqual([]);
    control("Choose another").props.onPress!();
    await settle();
    confirmPhoto();
    control("Use photo").props.onPress!();
    await settle();
    expect(runtime.addCaptures).toHaveBeenCalledOnce();
    expect(runtime.navigate).toHaveBeenCalledWith({
      pathname: "/result/[captureId]",
      params: { captureId: "fixture-capture" },
    });
    expect(runtime.store.captureDrafts).toEqual([]);
  });

  it.each(["selected", "canceled"])(
    "does not report a cleared photo when an empty Android picker is %s",
    async (outcome) => {
      const selection = deferred<{ uri: string } | null>();
      runtime.picker.mockReturnValueOnce(selection.promise);
      control("Choose photo").props.onPress!();
      await settle();
      appState("background");
      appState("active");
      selection.resolve(
        outcome === "selected"
          ? { uri: "file:///cache/ImagePicker/selected.jpg" }
          : null,
      );
      await settle();
      expect(previewUri()).toBe(outcome === "selected" ? photo.uri : undefined);
      expect(
        nodes(renderRoute()).some(
          (node) =>
            typeof node.props.children === "string" &&
            node.props.children.startsWith("Photo cleared when you left"),
        ),
      ).toBe(false);
    },
  );

  it("clears a departure warning only after a replacement photo is ready", async () => {
    await choosePhoto();
    appState("background");
    appState("active");
    await settle();
    const departureWarning = () =>
      nodes(renderRoute()).some(
        (node) =>
          typeof node.props.children === "string" &&
          node.props.children.startsWith("Photo cleared when you left"),
      );
    expect(departureWarning()).toBe(true);
    const selection = deferred<{ uri: string }>();
    runtime.picker.mockReturnValueOnce(selection.promise);
    control("Choose photo").props.onPress!();
    await settle();
    appState("background");
    appState("active");
    selection.resolve({ uri: "file:///cache/ImagePicker/replacement.jpg" });
    await settle();
    expect(previewUri()).toBe(photo.uri);
    expect(departureWarning()).toBe(false);
    expect(control(/This shows .* only/).props.selected).toBe(false);
    expect(control("Use photo").props.disabled).toBe(true);
  });

  it("reports an interrupted preparation after the Android picker has returned", async () => {
    const prepared = deferred<SanitizedCapture>();
    runtime.sanitize.mockReturnValueOnce(prepared.promise);
    control("Choose photo").props.onPress!();
    await settle();
    expect(runtime.sanitize).toHaveBeenCalledOnce();
    appState("background");
    appState("active");
    prepared.resolve(photo);
    await settle();
    expect(previewUri()).toBeUndefined();
    expect(runtime.removeTemporary).toHaveBeenCalledWith(photo.uri);
    expect(
      nodes(renderRoute()).some(
        (node) =>
          typeof node.props.children === "string" &&
          node.props.children.startsWith("Photo cleared when you left"),
      ),
    ).toBe(true);
    expect(runtime.analyze).not.toHaveBeenCalled();
  });

  it.each(["background", "blur"])(
    "restores the camera when %s cancels a switch between animation frames",
    async (departure) => {
      const frames: FrameRequestCallback[] = [];
      vi.stubGlobal(
        "requestAnimationFrame",
        (callback: FrameRequestCallback) => {
          frames.push(callback);
          return frames.length;
        },
      );
      control("Switch camera").props.onPress!();
      await settle();
      expect(frames).toHaveLength(1);
      if (departure === "background") {
        appState("background");
        appState("active");
      } else {
        blur();
        focus();
      }
      frames[0](0);
      await settle();
      const camera = nodes(renderRoute()).find(
        (node) => node.type === "CameraView",
      );
      expect(camera).toBeDefined();
      expect(camera!.props.facing).toBe("front");
      camera!.props.onCameraReady!();
      expect(control("Take photo").props.disabled).toBe(false);
    },
  );

  it.each(["background", "unmount"])(
    "does not continue a delayed camera switch after %s",
    async (departure) => {
      const paused = deferred<void>();
      runtime.camera.pausePreview.mockReturnValueOnce(paused.promise);
      control("Switch camera").props.onPress!();
      await settle();
      if (departure === "background") {
        appState("background");
        appState("active");
      } else unmount();
      paused.resolve();
      if (departure === "unmount") await settleUnmounted();
      else {
        await settle();
        expect(
          nodes(renderRoute()).find((node) => node.type === "CameraView")?.props
            .facing,
        ).toBe("front");
      }
    },
  );
  it("removes an earlier-photo decrypt that finishes after a background purge", async () => {
    const guide = deferred<string>();
    runtime.priorCapture = {
      id: "prior",
      encryptedUri: "file:///documents/prior.osv",
      mimeType: "image/jpeg",
    };
    runtime.decrypt.mockReturnValueOnce(guide.promise);
    control("More options").props.onPress!();
    control("Show earlier photo").props.onPress!();
    await settle();
    appState("background");
    await captureBackgroundCleanup.schedule(
      purgeStoma3DBackgroundTemporaryFiles,
    );
    const uri = "file:///cache/stoma3d-preview/late-guide.jpg";
    runtime.files.add(uri);
    runtime.removeTemporary.mockImplementationOnce(async (removed: string) => {
      runtime.files.delete(removed);
    });
    guide.resolve(uri);
    await settle();
    expect(previewUri()).toBeUndefined();
    expect(runtime.files.has(uri)).toBe(false);
  });

  it("does not decrypt the earlier-photo guide when backgrounding clears a review", async () => {
    runtime.priorCapture = {
      id: "prior",
      encryptedUri: "file:///documents/prior.osv",
      mimeType: "image/jpeg",
    };
    control("More options").props.onPress!();
    control("Show earlier photo").props.onPress!();
    await settle();
    await choosePhoto();
    runtime.decrypt.mockClear();
    appState("background");
    await settle();
    expect(runtime.decrypt).not.toHaveBeenCalled();
    expect(previewUri()).toBeUndefined();
  });

  it("discards a guide decrypt after a newer review owns the active route", async () => {
    const guide = deferred<string>();
    const selected = deferred<SanitizedCapture>();
    runtime.priorCapture = {
      id: "prior",
      encryptedUri: "file:///documents/prior.osv",
      mimeType: "image/jpeg",
    };
    runtime.decrypt.mockReturnValueOnce(guide.promise);
    control("More options").props.onPress!();
    control("Show earlier photo").props.onPress!();
    await settle();
    runtime.sanitize.mockReturnValueOnce(selected.promise);
    control("Choose photo").props.onPress!();
    await settle();
    const uri = "file:///cache/stoma3d-preview/stale-review-guide.jpg";
    runtime.files.add(uri);
    runtime.removeTemporary.mockImplementation(async (removed: string) => {
      runtime.files.delete(removed);
    });
    guide.resolve(uri);
    await settle();
    const appearedWhileNewReviewPending = previewUri();
    selected.resolve(photo);
    await settle();
    expect(appearedWhileNewReviewPending).toBeUndefined();
    expect(runtime.files.has(uri)).toBe(false);
    expect(previewUri()).toBe(photo.uri);
  });

  it("waits for the old purge before decrypting an earlier-photo guide", async () => {
    const purge = deferred<void>();
    void captureBackgroundCleanup.schedule(() => purge.promise);
    runtime.priorCapture = {
      id: "prior",
      encryptedUri: "file:///documents/prior.osv",
      mimeType: "image/jpeg",
    };
    control("More options").props.onPress!();
    control("Show earlier photo").props.onPress!();
    await settle();
    const decryptsBeforePurge = runtime.decrypt.mock.calls.length;
    purge.resolve();
    await settle();
    expect(decryptsBeforePurge).toBe(0);
    expect(runtime.decrypt).toHaveBeenCalledOnce();
  });

  it("preserves the new Android picker file while an old filesystem deletion finishes", async () => {
    const oldUri = "file:///cache/ImagePicker/old.jpg";
    const selectedUri = "file:///cache/ImagePicker/new.jpg";
    runtime.files.add(oldUri);
    const selection = deferred<{ uri: string }>();
    runtime.picker.mockReturnValueOnce(selection.promise);
    control("Choose photo").props.onPress!();
    await settle();
    const deletion = deferred<void>();
    const actualDelete = runtime.deleteFile.getMockImplementation()!;
    runtime.deleteFile.mockImplementation(async (uri: string) => {
      await deletion.promise;
      await actualDelete(uri);
    });
    const purge = captureBackgroundCleanup.schedule(
      purgeStoma3DBackgroundTemporaryFiles,
    );
    appState("background");
    await settle();
    runtime.files.add(selectedUri);
    selection.resolve({ uri: selectedUri });
    appState("active");
    runtime.sanitize.mockImplementationOnce(async (uri: string) => {
      if (!runtime.files.has(uri))
        throw new Error("The picker file was deleted.");
      return photo;
    });
    deletion.resolve();
    await purge;
    await settle();
    expect(previewUri()).toBe(photo.uri);
    expect(runtime.files.has(oldUri)).toBe(false);
    expect(runtime.files.has(selectedUri)).toBe(false);
  });

  it("keeps the picker source readable until sanitization ends and then deletes it", async () => {
    const sanitized = deferred<SanitizedCapture>();
    runtime.sanitize.mockReturnValueOnce(sanitized.promise);
    control("Choose photo").props.onPress!();
    await settle();
    const uri = "file:///cache/ImagePicker/fixture.jpg";
    await purgeStoma3DBackgroundTemporaryFiles();
    expect(runtime.files.has(uri)).toBe(true);
    sanitized.resolve(photo);
    await settle();
    expect(previewUri()).toBe(photo.uri);
    expect(runtime.files.has(uri)).toBe(false);
  });

  it("keeps the pending picker as the only capture action after foregrounding", async () => {
    const selection = deferred<{ uri: string }>();
    runtime.picker.mockReturnValueOnce(selection.promise);
    control("Choose photo").props.onPress!();
    await settle();
    appState("background");
    appState("active");
    nodes(renderRoute()).find((node) => node.type === "CameraView")!.props
      .onCameraReady!();
    const shutter = control("Take photo");
    const switcher = control("Switch camera");
    const shutterDisabled = shutter.props.disabled;
    const switchDisabled = switcher.props.disabled;
    shutter.props.onPress!();
    switcher.props.onPress!();
    await settle();
    const cameraStarted = runtime.camera.takePictureAsync.mock.calls.length;
    const switchStarted = runtime.camera.pausePreview.mock.calls.length;
    selection.resolve({ uri: "file:///cache/ImagePicker/late-selection.jpg" });
    await settle();
    expect(cameraStarted).toBe(0);
    expect(switchStarted).toBe(0);
    expect(shutterDisabled).toBe(true);
    expect(switchDisabled).toBe(true);
    expect(runtime.sanitize).toHaveBeenCalledOnce();
    expect(runtime.sanitize).toHaveBeenCalledWith(
      "file:///cache/ImagePicker/late-selection.jpg",
    );
    expect(previewUri()).toBe(photo.uri);
  });

  it.each(["blur and refocus", "route change"])(
    "reenables controls on stale picker completion after %s without incidental renders",
    async (departure) => {
      const selection = deferred<null>();
      runtime.picker.mockReturnValueOnce(selection.promise);
      control("Choose photo").props.onPress!();
      await settle();
      if (departure === "blur and refocus") {
        blur();
        focus();
      } else {
        runtime.params = { region: "upper_lip", angle: "primary" };
        renderRoute();
      }
      selection.resolve(null);
      for (let pass = 0; pass < 3; pass++) {
        await finishMicrotasks();
        if (runtime.dirty) renderRoute();
      }
      const choose = nodes(runtime.renderedTree as ReactNode).find(
        (node) => node.props.label === "Choose photo",
      );
      const switcher = nodes(runtime.renderedTree as ReactNode).find(
        (node) => node.props.label === "Switch camera",
      );
      expect(choose?.props.disabled).toBe(false);
      expect(switcher?.props.disabled).toBe(false);
    },
  );

  it.each(["Rotate", "Choose another"])(
    "preserves the retry review if draft deletion fails during %s",
    async (action) => {
      await choosePhoto();
      confirmPhoto();
      runtime.analyze.mockRejectedValueOnce(
        new Error("Analysis temporarily unavailable."),
      );
      control("Use photo").props.onPress!();
      await settle();
      const replacement = {
        ...photo,
        uri: "file:///cache/stoma3d-capture/new-review.jpg",
      };
      runtime.files.add(photo.uri);
      runtime.files.add(replacement.uri);
      runtime.removeTemporary.mockImplementation(async (uri: string) => {
        runtime.files.delete(uri);
      });
      runtime.removeDraft.mockRejectedValueOnce(
        new Error("Draft removal failed."),
      );
      if (action === "Rotate") runtime.edit.mockResolvedValueOnce(replacement);
      else runtime.sanitize.mockResolvedValueOnce(replacement);
      control(action).props.onPress!();
      await settle();
      expect(runtime.files.has(photo.uri)).toBe(true);
      expect(runtime.files.has(replacement.uri)).toBe(false);
      expect(previewUri()).toBe(photo.uri);
      expect(runtime.removeTemporary).not.toHaveBeenCalledWith(photo.uri);
      expect((runtime.store.captureDrafts as CaptureDraft[]).length).toBe(1);
    },
  );

  it("re-encrypts a retained edit review if its deleted draft is followed by temporary cleanup failure", async () => {
    await choosePhoto();
    confirmPhoto();
    runtime.analyze.mockRejectedValueOnce(
      new Error("Analysis temporarily unavailable."),
    );
    control("Use photo").props.onPress!();
    await settle();
    runtime.removeTemporary.mockImplementation(async (uri: string) => {
      if (uri === photo.uri) throw new Error("Temporary cleanup failed.");
    });
    control("Rotate").props.onPress!();
    await settle();
    expect(previewUri()).toBe(photo.uri);
    expect(runtime.store.captureDrafts).toEqual([]);
    const freshUri = "file:///documents/stoma3d-vault/fresh-edit-retry.osv";
    runtime.encrypt.mockResolvedValueOnce(freshUri);
    control("Use photo").props.onPress!();
    await settle();
    expect(runtime.encrypt).toHaveBeenCalledTimes(2);
    expect(runtime.saveDraft.mock.calls.at(-1)?.[0].encryptedUri).toBe(
      freshUri,
    );
  });

  it("does not schedule automatic camera capture while a picker return is pending", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      control("More options").props.onPress!();
      control("Take photo automatically when still").props.onPress!();
      const selection = deferred<{ uri: string }>();
      runtime.picker.mockReturnValueOnce(selection.promise);
      control("Choose photo").props.onPress!();
      await settle();
      appState("background");
      appState("active");
      nodes(renderRoute()).find((node) => node.type === "CameraView")!.props
        .onCameraReady!();
      renderRoute();
      await vi.advanceTimersByTimeAsync(400);
      await settle();
      const cameraStarted = runtime.camera.takePictureAsync.mock.calls.length;
      selection.resolve({
        uri: "file:///cache/ImagePicker/automatic-overlap.jpg",
      });
      await settle();
      expect(cameraStarted).toBe(0);
      expect(runtime.sanitize).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-encrypts the retained photo after retake removed its draft but plaintext cleanup failed", async () => {
    runtime.sanitize.mockResolvedValueOnce({ ...photo, source: "camera" });
    await choosePhoto();
    confirmPhoto();
    runtime.analyze.mockRejectedValueOnce(
      new Error("Analysis temporarily unavailable."),
    );
    control("Use photo").props.onPress!();
    await settle();
    const removedDraftUri = (runtime.store.captureDrafts as CaptureDraft[])[0]
      .encryptedUri;
    runtime.removeTemporary.mockRejectedValueOnce(
      new Error("Temporary cleanup failed."),
    );
    control("Retake").props.onPress!();
    await settle();
    expect(previewUri()).toBe(photo.uri);
    expect(runtime.store.captureDrafts).toEqual([]);
    const freshUri = "file:///documents/stoma3d-vault/fresh-retry.osv";
    runtime.encrypt.mockResolvedValueOnce(freshUri);
    control("Use photo").props.onPress!();
    await settle();
    expect(runtime.encrypt).toHaveBeenCalledTimes(2);
    expect(
      runtime.addCaptures.mock.calls.at(-1)?.[0][0].capture.encryptedUri,
    ).toBe(freshUri);
    expect(runtime.saveDraft.mock.calls.at(-1)?.[0].encryptedUri).not.toBe(
      removedDraftUri,
    );
  });

  it("clears an in-flight picker copy during full temporary-file deletion", async () => {
    const selection = deferred<null>();
    runtime.picker.mockReturnValueOnce(selection.promise);
    control("Choose photo").props.onPress!();
    await settle();
    const uri = "file:///cache/ImagePicker/in-flight-copy.jpg";
    runtime.files.add(uri);
    await purgeStoma3DTemporaryFiles();
    const remainedAfterFullPurge = runtime.files.has(uri);
    selection.resolve(null);
    await settle();
    expect(remainedAfterFullPurge).toBe(false);
  });

  it("does not let a stale picker lease release delete a newer selection", async () => {
    const oldLease = await beginPickerTemporaryLease();
    await oldLease.release();
    const currentLease = await beginPickerTemporaryLease();
    const uri = "file:///cache/ImagePicker/newer-selection.jpg";
    runtime.files.add(uri);
    await oldLease.release();
    const survivedStaleRelease = runtime.files.has(uri);
    await currentLease.release();
    expect(survivedStaleRelease).toBe(true);
    expect(runtime.files.has(uri)).toBe(false);
  });

  it("preserves review and unlocks a retry when picker lease acquisition fails", async () => {
    await choosePhoto();
    runtime.fileInfo.mockRejectedValueOnce(
      new Error("Temporary storage is unavailable."),
    );
    runtime.picker.mockClear();
    control("Choose another").props.onPress!();
    await settle();
    expect(runtime.picker).not.toHaveBeenCalled();
    expect(previewUri()).toBe(photo.uri);
    expect(control("Choose another").props.disabled).toBe(false);
    control("Choose another").props.onPress!();
    await settle();
    expect(runtime.picker).toHaveBeenCalledOnce();
    expect(previewUri()).toBe(photo.uri);
  });

  it("removes unreturned picker copies after a backgrounded picker is canceled", async () => {
    const selection = deferred<null>();
    runtime.picker.mockReturnValueOnce(selection.promise);
    control("Choose photo").props.onPress!();
    await settle();
    appState("background");
    await captureBackgroundCleanup.schedule(
      purgeStoma3DBackgroundTemporaryFiles,
    );
    const uri = "file:///cache/ImagePicker/canceled-copy.jpg";
    runtime.files.add(uri);
    selection.resolve(null);
    appState("active");
    await settle();
    expect(runtime.files.has(uri)).toBe(false);
  });

  it.each(["blur", "unmount", "route change"])(
    "cleans the picker lease at %s and removes late canceled copies",
    async (departure) => {
      const selection = deferred<null>();
      runtime.picker.mockReturnValueOnce(selection.promise);
      control("Choose photo").props.onPress!();
      await settle();
      const uri = "file:///cache/ImagePicker/abandoned-copy.jpg";
      runtime.files.add(uri);
      if (departure === "blur") blur();
      else if (departure === "unmount") unmount();
      else {
        runtime.params = { region: "upper_lip", angle: "primary" };
        renderRoute();
      }
      await finishMicrotasks();
      const copyRemainedAtDeparture = runtime.files.has(uri);
      const lateUri = "file:///cache/ImagePicker/late-canceled-copy.jpg";
      runtime.files.add(lateUri);
      selection.resolve(null);
      if (departure === "unmount") await settleUnmounted();
      else await settle();
      expect(copyRemainedAtDeparture).toBe(false);
      expect(runtime.files.has(lateUri)).toBe(false);
    },
  );

  it("requires explicit region correction and fresh confirmation for the same photo", async () => {
    await choosePhoto();
    confirmPhoto();
    runtime.analyze.mockResolvedValueOnce(analysis("dorsal_tongue", false));
    control("Use photo").props.onPress!();
    await settle();
    expect(runtime.addCaptures).not.toHaveBeenCalled();
    expect(previewUri()).toBe(photo.uri);

    control("Change to tongue underside").props.onPress!();
    const corrected = renderRoute();
    expect(previewUri()).toBe(photo.uri);
    expect(
      nodes(corrected).some(
        (node) => node.props.label === "Change to tongue underside",
      ),
    ).toBe(false);
    expect(control("Use photo").props.disabled).toBe(true);
    expect(runtime.analyze).toHaveBeenCalledTimes(1);
    expect(runtime.sanitize).toHaveBeenCalledTimes(1);

    confirmPhoto();
    control("Use photo").props.onPress!();
    await settle();
    expect(runtime.analyze).toHaveBeenLastCalledWith(
      expect.objectContaining({
        selectedRegion: "ventral_tongue",
        imageUri: photo.uri,
      }),
    );
    expect(runtime.addCaptures).toHaveBeenCalledWith([
      expect.objectContaining({
        capture: expect.objectContaining({ region: "ventral_tongue" }),
      }),
    ]);
  });

  it("preserves review and crop on inactive but clears them on actual background", async () => {
    await choosePhoto();
    confirmPhoto();
    control("Crop").props.onPress!();
    appState("inactive");
    expect(
      nodes(renderRoute()).some((node) => node.type === "PhotoCropEditor"),
    ).toBe(true);
    appState("active");
    nodes(renderRoute()).find((node) => node.type === "PhotoCropEditor")!.props
      .onCancel!();
    expect(control("Use photo").props.disabled).toBe(false);
    control("Crop").props.onPress!();

    appState("background");
    appState("active");
    await settle();
    expect(previewUri()).toBeUndefined();
    expect(
      nodes(renderRoute()).some((node) => node.type === "PhotoCropEditor"),
    ).toBe(false);
    await choosePhoto();
    expect(control("Use photo").props.disabled).toBe(true);
  });

  it("accepts a system picker return across inactive without treating it as abandonment", async () => {
    const selection = deferred<{ uri: string }>();
    runtime.picker.mockReturnValueOnce(selection.promise);
    control("Choose photo").props.onPress!();
    await settle();
    appState("inactive");
    appState("active");
    selection.resolve({ uri: "file:///cache/ImagePicker/fixture.jpg" });
    await settle();
    expect(previewUri()).toBe(photo.uri);
    expect(control("Use photo").props.disabled).toBe(true);
  });

  it("accepts an Android picker return only after the background purge finishes", async () => {
    const selection = deferred<{ uri: string }>();
    const purge = deferred<void>();
    runtime.picker.mockReturnValueOnce(selection.promise);
    control("Choose photo").props.onPress!();
    await settle();
    void captureBackgroundCleanup.schedule(() => purge.promise);
    appState("background");
    selection.resolve({ uri: "file:///cache/ImagePicker/fixture.jpg" });
    appState("active");
    await settle();
    expect(runtime.sanitize.mock.calls.length).toBe(0);
    purge.resolve();
    await settle();
    expect(previewUri()).toBe(photo.uri);
    expect(control("Use photo").props.disabled).toBe(true);
  });

  it("does not retain the deleted review when a backgrounded picker is canceled", async () => {
    await choosePhoto();
    const selection = deferred<null>();
    runtime.picker.mockReturnValueOnce(selection.promise);
    control("Choose another").props.onPress!();
    await settle();
    appState("background");
    appState("active");
    selection.resolve(null);
    await settle();
    expect(previewUri()).toBeUndefined();
    expect(
      nodes(renderRoute()).some(
        (node) =>
          node.props.children ===
          "Photo cleared when you left the app. Choose another photo or retake it.",
      ),
    ).toBe(true);
  });

  it("reopens an eligible encrypted retry photo only after purge and resets confirmation", async () => {
    await choosePhoto();
    confirmPhoto();
    const response = deferred<AnalysisResult>();
    runtime.analyze.mockReturnValueOnce(response.promise);
    control("Use photo").props.onPress!();
    await settle();
    const purge = deferred<void>();
    void captureBackgroundCleanup.schedule(() => purge.promise);
    appState("background");
    appState("active");
    await settle();
    expect(runtime.decrypt.mock.calls.length).toBe(0);
    purge.resolve();
    await settle();
    expect(runtime.decrypt.mock.calls.length).toBe(1);
    expect(previewUri()).toBe(photo.uri);
    expect(control("Use photo").props.disabled).toBe(true);
    expect((runtime.store.captureDrafts as CaptureDraft[]).length).toBe(1);
    expect(runtime.analyze.mock.calls.length).toBe(1);
    response.resolve(analysis("dorsal_tongue"));
    await settle();
    expect(runtime.addCaptures.mock.calls.length).toBe(0);
  });

  it("resets a corrected region and review when a mounted route changes identity", async () => {
    await choosePhoto();
    confirmPhoto();
    runtime.analyze.mockResolvedValueOnce(analysis("dorsal_tongue", false));
    control("Use photo").props.onPress!();
    await settle();
    control("Change to tongue underside").props.onPress!();
    runtime.params = { region: "upper_lip", angle: "primary" };
    renderRoute();
    expect(previewUri()).toBeUndefined();
    await choosePhoto();
    expect(control(/This shows Inside upper lip only/).props.selected).toBe(
      false,
    );
    confirmPhoto();
    control("Use photo").props.onPress!();
    await settle();
    expect(runtime.analyze.mock.calls.at(-1)?.[0].selectedRegion).toBe(
      "upper_lip",
    );
  });

  it.each(["session", "angle"])(
    "clears the corrected review when %s identity changes",
    async (identity) => {
      await choosePhoto();
      confirmPhoto();
      runtime.analyze.mockResolvedValueOnce(analysis("dorsal_tongue", false));
      control("Use photo").props.onPress!();
      await settle();
      control("Change to tongue underside").props.onPress!();
      if (identity === "session") {
        runtime.store.activeSessionId = "fixture-second-session";
        runtime.store.sessions = [
          {
            id: "fixture-second-session",
            protocol: "standard_eight_region",
            demo: false,
          },
        ];
      } else
        runtime.params = { region: "dorsal_tongue", angle: "left_oblique" };
      renderRoute();
      expect(previewUri()).toBeUndefined();
      await choosePhoto();
      confirmPhoto();
      control("Use photo").props.onPress!();
      await settle();
      expect(runtime.analyze.mock.calls.at(-1)?.[0].selectedRegion).toBe(
        "dorsal_tongue",
      );
    },
  );

  it("deletes a rejected temporary review when the capture screen closes", async () => {
    await choosePhoto();
    confirmPhoto();
    runtime.analyze.mockResolvedValueOnce(analysis("dorsal_tongue", false));
    control("Use photo").props.onPress!();
    await settle();
    expect(runtime.store.captureDrafts).toEqual([]);
    blur();
    await settle();
    expect(runtime.removeTemporary).toHaveBeenCalledWith(photo.uri);
    focus();
    expect(previewUri()).toBeUndefined();
    expect(runtime.decrypt).not.toHaveBeenCalled();
  });

  it("retains a retry photo and unlocks controls if draft removal fails before retake", async () => {
    runtime.sanitize.mockResolvedValueOnce({ ...photo, source: "camera" });
    await choosePhoto();
    confirmPhoto();
    runtime.analyze.mockRejectedValueOnce(
      new Error("Analysis temporarily unavailable."),
    );
    control("Use photo").props.onPress!();
    await settle();
    runtime.removeDraft.mockRejectedValueOnce(
      new Error("Draft removal failed."),
    );
    control("Retake").props.onPress!();
    await settle();
    expect(previewUri()).toBe(photo.uri);
    expect(runtime.removeTemporary).not.toHaveBeenCalledWith(photo.uri);
    expect(control("Use photo").props.disabled).toBe(false);
    expect(
      nodes(renderRoute()).some(
        (node) =>
          node.props.children === "The photo could not be cleared. Try again.",
      ),
    ).toBe(true);
  });

  it("does not reopen a retry draft whose valid capture commit already started", async () => {
    await choosePhoto();
    confirmPhoto();
    const commit = deferred<void>();
    runtime.addCaptures.mockImplementationOnce(async (entries) => {
      runtime.store.captures = entries.map(
        (entry: { capture: unknown }) => entry.capture,
      );
      await commit.promise;
    });
    control("Use photo").props.onPress!();
    await settle();
    expect(runtime.addCaptures.mock.calls.length).toBe(1);
    appState("background");
    appState("active");
    await settle();
    expect(runtime.decrypt.mock.calls.length).toBe(0);
    commit.resolve();
    await settle();
    expect(runtime.navigate.mock.calls.length).toBe(0);
    expect(runtime.removeProtected.mock.calls.length).toBe(0);
  });

  it.each(["background", "blur"])(
    "keeps a queued capture save isolated after %s before its store turn",
    async (departure) => {
      await choosePhoto();
      confirmPhoto();
      const commit = deferred<void>();
      runtime.addCaptures.mockImplementationOnce(async (entries) => {
        await commit.promise;
        runtime.store.captures = entries.map(
          (entry: { capture: unknown }) => entry.capture,
        );
      });
      control("Use photo").props.onPress!();
      await settle();
      expect(runtime.addCaptures).toHaveBeenCalledOnce();
      expect(runtime.store.captures).toEqual([]);
      if (departure === "background") {
        appState("background");
        appState("active");
      } else {
        blur();
        focus();
      }
      await settle();
      expect(runtime.decrypt).not.toHaveBeenCalled();
      expect(previewUri()).toBeUndefined();
      nodes(renderRoute()).find((node) => node.type === "CameraView")!.props
        .onCameraReady!();
      for (const label of ["Take photo", "Choose photo", "Switch camera"]) {
        const action = control(label);
        expect(action.props.disabled).toBe(true);
        action.props.onPress!();
      }
      await settle();
      expect(runtime.picker).toHaveBeenCalledOnce();
      expect(runtime.camera.takePictureAsync).not.toHaveBeenCalled();
      expect(runtime.camera.pausePreview).not.toHaveBeenCalled();
      commit.resolve();
      await settle();
      expect(runtime.store.captureDrafts).toEqual([]);
      expect(runtime.navigate).not.toHaveBeenCalled();
      expect(runtime.removeProtected).not.toHaveBeenCalled();
      expect(control("Choose photo").props.disabled).toBe(false);
    },
  );

  it.each(["background", "blur"])(
    "reopens the encrypted retry photo only after a queued save fails following %s",
    async (departure) => {
      await choosePhoto();
      confirmPhoto();
      const commit = deferred<void>();
      runtime.addCaptures.mockReturnValueOnce(commit.promise);
      control("Use photo").props.onPress!();
      await settle();
      if (departure === "background") {
        appState("background");
        appState("active");
      } else {
        blur();
        focus();
      }
      await settle();
      expect(runtime.decrypt).not.toHaveBeenCalled();
      commit.reject(new Error("Capture storage unavailable."));
      await settle();
      expect(runtime.decrypt).toHaveBeenCalledOnce();
      expect(previewUri()).toBe(photo.uri);
      expect(control(/This shows .* only/).props.selected).toBe(false);
      expect(control("Use photo").props.disabled).toBe(true);
      expect(runtime.store.captures).toEqual([]);
      expect(runtime.navigate).not.toHaveBeenCalled();
      expect(runtime.removeProtected).not.toHaveBeenCalled();
    },
  );

  it.each(["complete", "failed"])(
    "settles a queued %s capture save after unmount without updating the closed screen",
    async (outcome) => {
      await choosePhoto();
      confirmPhoto();
      const commit = deferred<void>();
      runtime.addCaptures.mockReturnValueOnce(commit.promise);
      control("Use photo").props.onPress!();
      await settle();
      unmount();
      if (outcome === "complete") commit.resolve();
      else commit.reject(new Error("Capture storage unavailable."));
      await settleUnmounted();
      expect(runtime.decrypt).not.toHaveBeenCalled();
      expect(runtime.navigate).not.toHaveBeenCalled();
      expect(runtime.removeProtected).not.toHaveBeenCalled();
    },
  );

  it.each(["complete", "failed"])(
    "keeps a pending %s save owned across capture route remounts",
    async (outcome) => {
      await choosePhoto();
      confirmPhoto();
      const commit = deferred<void>();
      runtime.addCaptures.mockImplementationOnce(async (entries) => {
        await commit.promise;
        runtime.store.captures = entries.map(
          (entry: { capture: unknown }) => entry.capture,
        );
      });
      control("Use photo").props.onPress!();
      await settle();
      unmount();
      runtime.slots = [];
      runtime.pendingEffects = [];
      runtime.renderedTree = null;
      runtime.focusSetup = null;
      runtime.focusCleanup = null;
      runtime.cameraRefAssigned = false;
      runtime.unmounted = false;
      renderRoute();
      await settle();
      expect(runtime.decrypt).not.toHaveBeenCalled();
      expect(previewUri()).toBeUndefined();
      expect(control("Choose photo").props.disabled).toBe(true);
      if (outcome === "complete") commit.resolve();
      else commit.reject(new Error("Capture storage unavailable."));
      await settle();
      expect(runtime.navigate).not.toHaveBeenCalled();
      if (outcome === "complete") {
        expect(runtime.decrypt).not.toHaveBeenCalled();
        expect(runtime.store.captureDrafts).toEqual([]);
      } else {
        expect(runtime.decrypt).toHaveBeenCalledOnce();
        expect(previewUri()).toBe(photo.uri);
        expect(control(/This shows .* only/).props.selected).toBe(false);
      }
    },
  );

  it("does not start extracting a sweep returned after backgrounding", async () => {
    runtime.store.sessions = [
      { id: "fixture-session", protocol: "guided_video_sweep", demo: false },
    ];
    const video = deferred<{ uri: string }>();
    runtime.camera.recordAsync.mockReturnValueOnce(video.promise);
    control("Record sweep").props.onPress!();
    appState("background");
    appState("active");
    video.resolve({ uri: "file:///cache/fixture-sweep.mp4" });
    await settle();
    expect(runtime.videoPlayer.generateThumbnailsAsync.mock.calls.length).toBe(
      0,
    );
    expect(
      runtime.videoPlayer.replaceAsync.mock.calls.some((call) => call[0]?.uri),
    ).toBe(false);
    expect(runtime.removeTemporary).toHaveBeenCalledWith(
      "file:///cache/fixture-sweep.mp4",
    );
  });

  it.each(["background", "blur"])(
    "does not resurrect a delayed edit after %s",
    async (departure) => {
      await choosePhoto();
      const edited = deferred<SanitizedCapture>();
      runtime.edit.mockReturnValueOnce(edited.promise);
      control("Rotate").props.onPress!();
      if (departure === "background") {
        appState("background");
        appState("active");
      } else {
        blur();
        focus();
      }
      edited.resolve({
        ...photo,
        uri: "file:///cache/stoma3d-capture/fixture-late-edit.jpg",
      });
      await settle();
      expect(previewUri()).toBeUndefined();
      expect(runtime.removeTemporary).toHaveBeenCalledWith(
        "file:///cache/stoma3d-capture/fixture-late-edit.jpg",
      );
      expect(runtime.navigate).not.toHaveBeenCalled();
    },
  );

  it.each(["background", "blur"])(
    "does not save or navigate a delayed analysis after %s",
    async (departure) => {
      await choosePhoto();
      confirmPhoto();
      const response = deferred<AnalysisResult>();
      runtime.analyze.mockReturnValueOnce(response.promise);
      control("Use photo").props.onPress!();
      await settle();
      expect(runtime.analyze).toHaveBeenCalledOnce();
      if (departure === "background") {
        appState("background");
        appState("active");
      } else {
        blur();
        focus();
      }
      response.resolve(analysis("dorsal_tongue"));
      await settle();
      expect(runtime.addCaptures).not.toHaveBeenCalled();
      expect(runtime.navigate).not.toHaveBeenCalled();
    },
  );

  it.each(["background", "blur", "unmount"])(
    "does not start draft persistence after late encryption and %s",
    async (departure) => {
      await choosePhoto();
      confirmPhoto();
      const protectedPhoto = deferred<string>();
      runtime.encrypt.mockReturnValueOnce(protectedPhoto.promise);
      control("Use photo").props.onPress!();
      await settle();
      if (departure === "background") {
        appState("background");
        appState("active");
      } else if (departure === "blur") {
        blur();
        focus();
      } else unmount();
      protectedPhoto.resolve(
        "file:///documents/stoma3d-vault/fixture-late.osv",
      );
      if (departure === "unmount") await settleUnmounted();
      else await settle();
      expect(runtime.saveDraft).not.toHaveBeenCalled();
      expect(runtime.analyze).not.toHaveBeenCalled();
      expect(runtime.addCaptures).not.toHaveBeenCalled();
      expect(runtime.removeProtected).toHaveBeenCalledWith(
        "file:///documents/stoma3d-vault/fixture-late.osv",
      );
    },
  );

  it.each(["blur", "unmount"])(
    "discards a system picker return after %s",
    async (departure) => {
      const selection = deferred<{ uri: string }>();
      runtime.picker.mockReturnValueOnce(selection.promise);
      control("Choose photo").props.onPress!();
      await settle();
      if (departure === "blur") {
        blur();
        focus();
      } else unmount();
      selection.resolve({ uri: "file:///cache/ImagePicker/fixture-late.jpg" });
      if (departure === "unmount") await settleUnmounted();
      else await settle();
      expect(runtime.sanitize).not.toHaveBeenCalled();
      expect(runtime.removePicker).toHaveBeenCalledWith(
        "file:///cache/ImagePicker/fixture-late.jpg",
      );
    },
  );

  it("discards a late edit after unmount without updating the closed screen", async () => {
    await choosePhoto();
    const edited = deferred<SanitizedCapture>();
    runtime.edit.mockReturnValueOnce(edited.promise);
    control("Rotate").props.onPress!();
    unmount();
    edited.resolve({
      ...photo,
      uri: "file:///cache/stoma3d-capture/fixture-late-edit.jpg",
    });
    await settleUnmounted();
    expect(runtime.removeTemporary).toHaveBeenCalledWith(
      "file:///cache/stoma3d-capture/fixture-late-edit.jpg",
    );
    expect(runtime.navigate).not.toHaveBeenCalled();
  });

  it("does not save or navigate a late analysis after unmount", async () => {
    await choosePhoto();
    confirmPhoto();
    const response = deferred<AnalysisResult>();
    runtime.analyze.mockReturnValueOnce(response.promise);
    control("Use photo").props.onPress!();
    await settle();
    unmount();
    response.resolve(analysis("dorsal_tongue"));
    await settleUnmounted();
    expect(runtime.addCaptures).not.toHaveBeenCalled();
    expect(runtime.navigate).not.toHaveBeenCalled();
    expect(runtime.removeProtected).not.toHaveBeenCalled();
  });
});
