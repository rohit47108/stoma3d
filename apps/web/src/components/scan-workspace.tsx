"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { MOUTH_REGIONS, type MouthRegion } from "@stoma3d/contracts";
import { BrandMark } from "./brand-mark";
import { ScanCamera } from "./scan-camera";
import { ScanIntake } from "./scan-intake";
import { ScanPhotoReview } from "./scan-photo-review";
import { ScanResult } from "./scan-result";
import { ScanMapPanel } from "./scan-map-panel";
import { ScanHome, ScanHistory } from "./scan-home-history";
import { ScanReport } from "./scan-report";
import {
  addGuestCapture,
  confirmGuestObservation,
  createGuestSession,
  guestCompletedRegions,
  nextGuestRegion,
  regionDetail,
  resultProblem,
  suggestedRetryRegion,
  type GuestCapture,
  type GuestSession,
} from "@/lib/guest-scan";
import {
  clearGuestData,
  isGuestDataClearedError,
  loadGuestSessions,
  saveGuestSession,
  subscribeGuestDataReset,
} from "@/lib/guest-storage";
import { analyzeGuestPhoto } from "@/lib/scan-client";
import { preparedPhotoFromSaved, type PreparedPhoto } from "@/lib/scan-image";

type Destination = "home" | "scan" | "map" | "history";
type ScanStage = "intake" | "capture" | "review" | "result";
const destinations: { id: Destination; label: string; symbol: string }[] = [
  { id: "home", label: "Home", symbol: "⌂" },
  { id: "scan", label: "Scan", symbol: "◎" },
  { id: "map", label: "3D Map", symbol: "◇" },
  { id: "history", label: "History", symbol: "◷" },
];

export function ScanWorkspace() {
  const [destination, setDestination] = useState<Destination>("home");
  const [stage, setStage] = useState<ScanStage>("intake");
  const [sessions, setSessions] = useState<GuestSession[]>([]);
  const [session, setSession] = useState<GuestSession | null>(null);
  const [region, setRegion] = useState<MouthRegion>("dorsal_tongue");
  const [photo, setPhoto] = useState<PreparedPhoto | null>(null);
  const [capture, setCapture] = useState<GuestCapture | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [suggestedRegion, setSuggestedRegion] = useState<MouthRegion | null>(
    null,
  );
  const [storageProblem, setStorageProblem] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [cameraFacing, setCameraFacing] = useState<"user" | "environment">(
    "user",
  );
  const requestRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const dataGenerationRef = useRef(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const complete = guestCompletedRegions(session);

  useEffect(() => {
    let active = true;
    const openingGeneration = dataGenerationRef.current;
    const unsubscribe = subscribeGuestDataReset(() => {
      dataGenerationRef.current += 1;
      requestRef.current?.abort();
      requestRef.current = null;
      busyRef.current = false;
      setBusy(false);
      setSessions([]);
      setSession(null);
      setCapture(null);
      setPhoto(null);
      setProblem(null);
      setSuggestedRegion(null);
      setStorageProblem(null);
      setDeleteConfirm(false);
      setDestination("home");
      setStage("intake");
      setLoading(true);
      const resetGeneration = dataGenerationRef.current;
      void loadGuestSessions()
        .then((saved) => {
          if (!active || dataGenerationRef.current !== resetGeneration) return;
          setSessions(saved);
          setSession(
            saved.find((item) => item.captures.length < 8) ?? saved[0] ?? null,
          );
        })
        .catch((error: unknown) => {
          if (active && dataGenerationRef.current === resetGeneration) {
            setStorageProblem(
              error instanceof Error
                ? error.message
                : "Device storage could not open.",
            );
          }
        })
        .finally(() => {
          if (active && dataGenerationRef.current === resetGeneration)
            setLoading(false);
        });
    });
    void loadGuestSessions()
      .then((saved) => {
        if (active && dataGenerationRef.current === openingGeneration) {
          setSessions(saved);
          setSession(
            saved.find((item) => item.captures.length < 8) ?? saved[0] ?? null,
          );
        }
      })
      .catch((error: unknown) => {
        if (active && dataGenerationRef.current === openingGeneration)
          setStorageProblem(
            error instanceof Error
              ? error.message
              : "Device storage could not open.",
          );
      })
      .finally(() => {
        if (active && dataGenerationRef.current === openingGeneration)
          setLoading(false);
      });
    return () => {
      active = false;
      unsubscribe();
      requestRef.current?.abort();
    };
  }, []);
  useEffect(() => {
    headingRef.current?.focus();
  }, [destination, stage]);

  async function remember(next: GuestSession) {
    const generation = dataGenerationRef.current;
    try {
      await saveGuestSession(next);
      if (dataGenerationRef.current !== generation) return false;
      setStorageProblem(null);
    } catch (error) {
      if (
        dataGenerationRef.current !== generation ||
        isGuestDataClearedError(error)
      )
        return false;
      setStorageProblem(
        error instanceof Error
          ? error.message
          : "Your scan could not be saved. Free some device storage and try again.",
      );
      return false;
    }
    setSession(next);
    setSessions((current) => [
      next,
      ...current.filter((item) => item.id !== next.id),
    ]);
    return true;
  }

  function navigate(next: Destination) {
    if (busyRef.current) return;
    setPhoto(null);
    setProblem(null);
    setSuggestedRegion(null);
    setDestination(next);
    setDeleteConfirm(false);
    if (next === "scan") {
      setStage(session ? "capture" : "intake");
      setRegion(nextGuestRegion(session) ?? MOUTH_REGIONS[0]);
    }
  }

  function begin() {
    setProblem(null);
    setSuggestedRegion(null);
    setPhoto(null);
    setDestination("scan");
    if (session && session.captures.length < 8) {
      setRegion(nextGuestRegion(session)!);
      setStage("capture");
    } else {
      setStage("intake");
    }
  }

  async function start(intake: GuestSession["intake"]) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const generation = dataGenerationRef.current;
    try {
      const next = { ...createGuestSession(crypto.randomUUID()), intake };
      if (!(await remember(next)) || dataGenerationRef.current !== generation)
        return;
      setCameraFacing("user");
      setRegion(MOUTH_REGIONS[0]);
      setStage("capture");
    } finally {
      if (dataGenerationRef.current === generation) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }

  async function analyze() {
    if (!photo || !session || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setProblem(null);
    setSuggestedRegion(null);
    const generation = dataGenerationRef.current;
    const controller = new AbortController();
    requestRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 115_000);
    try {
      const id = crypto.randomUUID(),
        capturedAt = new Date().toISOString();
      const result = await analyzeGuestPhoto(
        photo,
        region,
        id,
        controller.signal,
      );
      if (dataGenerationRef.current !== generation || controller.signal.aborted)
        return;
      const correction = resultProblem(result);
      if (
        correction &&
        !(
          result.status === "abstained" &&
          result.quality.accepted &&
          result.anatomyPrediction.supported &&
          result.anatomyPrediction.selectedRegionMatches
        )
      ) {
        setProblem(correction);
        setSuggestedRegion(suggestedRetryRegion(result));
        return;
      }
      const accepted: GuestCapture = {
        id,
        region,
        capturedAt,
        image: photo.image,
        width: photo.width,
        height: photo.height,
        analysis: result,
      };
      if (
        !(await remember(addGuestCapture(session, accepted))) ||
        dataGenerationRef.current !== generation
      )
        return;
      setCapture(accepted);
      setPhoto(null);
      setStage("result");
    } catch (error) {
      if (dataGenerationRef.current !== generation) return;
      setProblem(
        controller.signal.aborted
          ? "Analysis took too long. Your photo is still here; try again."
          : error instanceof Error
            ? error.message
            : "Analysis is unavailable. Your photo is still here; try again.",
      );
    } finally {
      window.clearTimeout(timeout);
      if (requestRef.current === controller) requestRef.current = null;
      if (dataGenerationRef.current === generation) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }

  async function confirmPin() {
    if (!session || !capture) return;
    await remember(confirmGuestObservation(session, capture.id));
  }

  async function deleteData() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await clearGuestData();
      setSessions([]);
      setSession(null);
      setCapture(null);
      setPhoto(null);
      setStorageProblem(null);
      setDeleteConfirm(false);
      setDestination("home");
    } catch (error) {
      setStorageProblem(
        error instanceof Error
          ? error.message
          : "Deletion could not finish. Try again.",
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function openCapture(owner: GuestSession, item: GuestCapture) {
    setSession(owner);
    setCapture(item);
    setRegion(item.region);
    setStage("result");
    setDestination("scan");
    setProblem(null);
  }

  const title =
    destination === "home"
      ? "Your mouth, mapped over time."
      : destination === "history"
        ? "Your scans"
        : destination === "map"
          ? "Oral observation map"
          : stage === "review"
            ? "Review your photo"
            : stage === "result"
              ? regionDetail(region).shortLabel
              : regionDetail(region).label;

  return (
    <div className="scan-shell">
      <header className="scan-header">
        <BrandMark />
        <span>Saved on this device.</span>
        <details className="scan-menu">
          <summary aria-label="Open help and settings">•••</summary>
          <div>
            <Link href="/how-it-works">Help</Link>
            <Link href="/signin">Cloud sync</Link>
            <Link href="/security">Privacy</Link>
            <button
              type="button"
              disabled={busy}
              onClick={() => setDeleteConfirm(true)}
            >
              Clear device data
            </button>
          </div>
        </details>
      </header>
      <nav className="scan-nav" aria-label="Main destinations">
        {destinations.map((item) => (
          <button
            type="button"
            key={item.id}
            aria-current={destination === item.id ? "page" : undefined}
            disabled={busy}
            onClick={() => navigate(item.id)}
          >
            <span aria-hidden="true">{item.symbol}</span>
            {item.label}
          </button>
        ))}
      </nav>
      <main
        id="main-content"
        className="scan-content"
        aria-busy={loading || busy}
      >
        {loading ? (
          <div className="scan-loading" role="status">
            <span className="scan-loading-mark">S3</span>
            <p>Opening your scans…</p>
          </div>
        ) : (
          <>
            {storageProblem && (
              <p className="scan-error" role="alert">
                {storageProblem}
              </p>
            )}
            {deleteConfirm && (
              <section className="scan-delete">
                <h2>Clear this device?</h2>
                <p>
                  This removes all browser scans, photos, and the encryption key
                  from this device. Cloud records are not changed.
                </p>
                <div className="scan-actions">
                  <button
                    type="button"
                    className="scan-button scan-button-danger"
                    disabled={busy}
                    onClick={() => void deleteData()}
                  >
                    Delete device data
                  </button>
                  <button
                    type="button"
                    className="scan-button"
                    onClick={() => setDeleteConfirm(false)}
                  >
                    Cancel
                  </button>
                </div>
              </section>
            )}
            {destination === "scan" && stage === "intake" ? (
              <ScanIntake
                onFinish={(intake) => void start(intake)}
                onCancel={() => navigate("home")}
              />
            ) : (
              <>
                <div className="scan-page-heading">
                  <div>
                    <p className="scan-step-note">
                      {destination === "scan"
                        ? `Region ${MOUTH_REGIONS.indexOf(region) + 1} of 8`
                        : destination === "map"
                          ? `${complete.length} of 8 regions captured`
                          : "Stoma3D"}
                    </p>
                    <h1 ref={headingRef} tabIndex={-1}>
                      {title}
                    </h1>
                  </div>
                  {session && destination !== "home" && (
                    <span className="scan-progress-label">
                      {complete.length}/8
                    </span>
                  )}
                </div>
                {destination === "home" && (
                  <ScanHome
                    sessions={sessions}
                    session={session}
                    onOpen={openCapture}
                    onStart={begin}
                    onMap={() => navigate("map")}
                  />
                )}
                {destination === "scan" && stage === "capture" && (
                  <>
                    <p className="scan-capture-instruction">
                      {regionDetail(region).captureInstruction}
                    </p>
                    <label className="scan-region-select">
                      Region
                      <select
                        value={region}
                        onChange={(event) => {
                          setRegion(event.target.value as MouthRegion);
                          setProblem(null);
                        }}
                      >
                        {MOUTH_REGIONS.map((item) => (
                          <option key={item} value={item}>
                            {regionDetail(item).shortLabel}
                            {complete.includes(item) ? " ✓" : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    {problem && (
                      <p className="scan-error" role="alert">
                        {problem}
                      </p>
                    )}
                    <ScanCamera
                      initialFacing={cameraFacing}
                      onFacingChange={setCameraFacing}
                      onPhoto={(next) => {
                        setPhoto(next);
                        setProblem(null);
                        setSuggestedRegion(null);
                        setStage("review");
                      }}
                      onProblem={setProblem}
                    />
                  </>
                )}
                {destination === "scan" && stage === "review" && photo && (
                  <ScanPhotoReview
                    photo={photo}
                    busy={busy}
                    problem={problem}
                    regionCorrection={
                      suggestedRegion
                        ? {
                            region: suggestedRegion,
                            onApply: () => {
                              setRegion(suggestedRegion);
                              setSuggestedRegion(null);
                              setProblem(null);
                            },
                          }
                        : undefined
                    }
                    onChange={(next) => {
                      setPhoto(next);
                      setProblem(null);
                      setSuggestedRegion(null);
                    }}
                    onUse={() => void analyze()}
                    onReplace={() => {
                      setPhoto(null);
                      setProblem(null);
                      setSuggestedRegion(null);
                      setStage("capture");
                    }}
                  />
                )}
                {destination === "scan" && stage === "result" && capture && (
                  <ScanResult
                    capture={capture}
                    pinConfirmed={Boolean(
                      session?.pins.some((pin) => pin.captureId === capture.id),
                    )}
                    onConfirmPin={() => void confirmPin()}
                    onRetry={() => {
                      setPhoto(
                        preparedPhotoFromSaved(
                          capture.image,
                          capture.width,
                          capture.height,
                        ),
                      );
                      setStage("review");
                      setProblem(null);
                    }}
                    onNext={() => {
                      setRegion(nextGuestRegion(session) ?? region);
                      setStage("capture");
                    }}
                    onMap={() => {
                      setDestination("map");
                      setPhoto(null);
                    }}
                    complete={complete.length === 8}
                  />
                )}
                {destination === "map" && (
                  <ScanMapPanel
                    session={session}
                    region={region}
                    onSelect={setRegion}
                    onOpen={openCapture}
                    onCapture={() => {
                      setDestination("scan");
                      setStage(session ? "capture" : "intake");
                    }}
                  />
                )}
                {destination === "history" && (
                  <ScanHistory
                    sessions={sessions}
                    onOpen={openCapture}
                    onStart={begin}
                    onResume={(item) => {
                      setSession(item);
                      setRegion(nextGuestRegion(item) ?? MOUTH_REGIONS[0]);
                      setStage("capture");
                      setDestination("scan");
                    }}
                  />
                )}
              </>
            )}
          </>
        )}
      </main>
      <ScanReport session={session} />
    </div>
  );
}
