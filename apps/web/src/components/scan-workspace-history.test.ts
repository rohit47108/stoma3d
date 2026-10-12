import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import {
  CONTRACT_VERSION,
  DISCLAIMER,
  MOUTH_REGIONS,
} from "@stoma3d/contracts";
import { createGuestSession, type GuestSession } from "@/lib/guest-scan";

const hooks = vi.hoisted(() => ({
  index: 0,
  updates: new Map<number, unknown>(),
}));

// Execute the real route callback without mounting browser storage or graphics.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      const index = hooks.index++;
      const value = index === 0 ? "history" : index === 7 ? false : initial;
      return [value, (next: unknown) => hooks.updates.set(index, next)];
    },
    useEffect: () => undefined,
    useRef: (current: unknown) => ({ current }),
  };
});

import { ScanWorkspace } from "./scan-workspace";
import { ScanHistory } from "./scan-home-history";

function savedSession(regionCount: number): GuestSession {
  const session = createGuestSession("history-scan", "2026-10-11T12:00:00Z");
  // Synthetic contract data belongs only to this test, never to live analysis.
  session.captures = MOUTH_REGIONS.slice(0, regionCount).map((region) => ({
    id: `test-${region}`,
    region,
    capturedAt: "2026-10-11T12:00:00Z",
    image: "data:image/jpeg;base64,dGVzdA==",
    width: 640,
    height: 480,
    analysis: {
      contractVersion: CONTRACT_VERSION,
      captureId: `test-${region}`,
      region,
      quality: {
        accepted: true,
        blurScore: 0.8,
        exposureScore: 0.8,
        glareScore: 0,
        obstructionScore: 0,
        faceDetected: false,
        reasons: [],
      },
      anatomyPrediction: {
        region,
        confidence: 0.9,
        supported: true,
        selectedRegionMatches: true,
      },
      candidateMask: null,
      descriptors: null,
      appearanceOutput: null,
      diseaseResearchOutput: null,
      uncertainty: {
        overallConfidence: 0.8,
        imageQualityConfidence: 0.8,
        datasetSimilarity: null,
        modelAgreement: null,
        limitations: [],
      },
      abstentionReasons: [],
      modelVersions: { segmentation: "test-only" },
      inputOrigin: "live_capture",
      analysisOrigin: "live_model",
      status: "complete",
      disclaimer: DISCLAIMER,
    },
  }));
  return session;
}

function findHistory(node: unknown):
  | ReactElement<{
      onResume: (session: GuestSession) => void;
    }>
  | undefined {
  if (Array.isArray(node)) {
    return node.map(findHistory).find(Boolean);
  }
  if (!node || typeof node !== "object" || !("props" in node)) return;
  const element = node as ReactElement<{ children?: unknown }>;
  if (element.type === ScanHistory) {
    return element as ReactElement<{
      onResume: (session: GuestSession) => void;
    }>;
  }
  return findHistory(element.props.children);
}

function openFromHistory(session: GuestSession) {
  const history = findHistory(ScanWorkspace());
  expect(history).toBeDefined();
  history!.props.onResume(session);
}

describe("opening saved scans from history", () => {
  beforeEach(() => {
    hooks.index = 0;
    hooks.updates.clear();
  });

  it("opens a completed scan on its observation map without recapture", () => {
    const session = savedSession(8);
    const before = structuredClone(session);
    openFromHistory(session);
    expect(hooks.updates.get(0)).toBe("map");
    expect(hooks.updates.get(3)).toBe(session);
    expect(session).toEqual(before);
  });

  it("resumes a seven-region scan at its missing lower arch", () => {
    const session = savedSession(7);
    openFromHistory(session);
    expect(hooks.updates.get(0)).toBe("scan");
    expect(hooks.updates.get(1)).toBe("capture");
    expect(hooks.updates.get(4)).toBe("lower_dental_arch");
    expect(hooks.updates.get(3)).toBe(session);
  });

  it("opens a saved empty scan at the first region without a new session", () => {
    const session = savedSession(0);
    openFromHistory(session);
    expect(hooks.updates.get(0)).toBe("scan");
    expect(hooks.updates.get(4)).toBe("dorsal_tongue");
    expect(hooks.updates.get(3)).toBe(session);
  });
});
