"use client";

import { useEffect, useRef, useState } from "react";
import { MOUTH_REGIONS, type MouthRegion } from "@stoma3d/contracts";
import { BrandMark } from "./brand-mark";
import { DemoPhoto } from "./demo-photo";
import { ScanObservationMap } from "./scan-observation-map";
import { DemoReport } from "./demo-report";
import { regionDetail } from "@/lib/guest-scan";
import {
  DEMO_CHAPTERS,
  DEMO_STEPS,
  demoTransition,
  initialDemoState,
  sampleCase,
} from "@/lib/demo-tour";
import {
  WEB_MAP_ASSET_VERSION,
  WEB_MAP_MESHES,
} from "@/lib/web-observation-map";
import "./guided-demo.css";
import {
  keepScanFocusVisible,
  observeScanNavigationInset,
} from "@/lib/scan-navigation-inset";

const observation = sampleCase.observations[0];
const samplePins = [
  {
    captureId: "sample-cheek-current",
    region: observation.region,
    meshId: WEB_MAP_MESHES[observation.region],
    uvX: 0.62,
    uvY: 0.47,
    assetVersion: WEB_MAP_ASSET_VERSION,
    confirmedAt: "2026-10-17T12:00:00Z",
  },
];

export function GuidedDemo({ onExit }: { onExit: () => void }) {
  const [state, setState] = useState(initialDemoState);
  const [region, setRegion] = useState<MouthRegion>(observation.region);
  const [mask, setMask] = useState(true);
  const [blend, setBlend] = useState(50);
  const heading = useRef<HTMLHeadingElement>(null);
  const controls = useRef<HTMLElement>(null);
  const step = DEMO_STEPS[state.index];
  useEffect(() => {
    if (controls.current)
      return observeScanNavigationInset(
        controls.current,
        document.documentElement,
      );
  }, []);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [state.index]);

  function move(action: "next" | "back" | "skip" | "restart") {
    setState((current) => demoTransition(current, action));
    if (action === "restart") {
      setRegion(observation.region);
      setMask(true);
      setBlend(50);
    }
  }

  return (
    <div className="scan-shell demo-shell" data-demo="sample">
      <header className="scan-header demo-header">
        <BrandMark />
        <span className="demo-badge">Sample demo</span>
        <button type="button" className="scan-text-button" onClick={onExit}>
          Exit demo
        </button>
      </header>
      <nav className="demo-chapters" aria-label="Demo chapters">
        {DEMO_CHAPTERS.map((chapter, i) => {
          const active =
            state.index >= chapter.index &&
            state.index < (DEMO_CHAPTERS[i + 1]?.index ?? DEMO_STEPS.length);
          return (
            <button
              type="button"
              key={chapter.label}
              aria-current={active ? "step" : undefined}
              onClick={() =>
                setState((current) => ({ ...current, index: chapter.index }))
              }
            >
              {chapter.label}
            </button>
          );
        })}
      </nav>
      <main
        id="main-content"
        className="demo-content"
        onFocusCapture={(event) => {
          if (controls.current)
            keepScanFocusVisible(event.target, controls.current);
        }}
      >
        <div className="demo-heading">
          <p className="demo-eyebrow">
            {step.kind === "region"
              ? `Photo ${MOUTH_REGIONS.indexOf(step.region) + 1} of 8`
              : "The guided tour"}
          </p>
          <h1 ref={heading} tabIndex={-1}>
            {step.kind === "region"
              ? regionDetail(step.region).label
              : step.title}
          </h1>
        </div>

        {step.kind === "welcome" && (
          <div className="demo-two-column demo-welcome">
            <div>
              <p className="demo-lead">Eight photos. One connected record.</p>
              <p>
                Follow a sample scan from the first photo to a clear, shareable
                report.
              </p>
              <ol className="demo-intro-list">
                <li>
                  <span>01</span>
                  <div>
                    <strong>Capture consistently</strong>
                    <p>A short guide for each mouth region.</p>
                  </div>
                </li>
                <li>
                  <span>02</span>
                  <div>
                    <strong>Review what you see</strong>
                    <p>Photos, observations, and a 3D map.</p>
                  </div>
                </li>
                <li>
                  <span>03</span>
                  <div>
                    <strong>Keep track over time</strong>
                    <p>History, comparison, and a local PDF.</p>
                  </div>
                </li>
              </ol>
              <p className="demo-caption">
                This tour uses synthetic images and prepared results. Your own
                scans stay separate.
              </p>
            </div>
            <div
              className="demo-contact-sheet"
              aria-label="Eight synthetic mouth-region samples"
            >
              {MOUTH_REGIONS.map((id, i) => (
                <figure key={id}>
                  <DemoPhoto region={id} />
                  <figcaption>
                    <span>{i + 1}</span>
                    {regionDetail(id).shortLabel}
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        )}

        {step.kind === "region" && (
          <div className="demo-two-column">
            <DemoPhoto region={step.region} />
            <section className="demo-photo-review">
              <p className="demo-eyebrow">Review photo</p>
              <h2>A consistent view</h2>
              <p>{regionDetail(step.region).captureInstruction}</p>
              <div className="demo-review-note">
                <span aria-hidden="true">✓</span>
                <div>
                  <strong>Prepared sample photo</strong>
                  <p>
                    In your own scan, take or upload a photo, then review it
                    here.
                  </p>
                </div>
              </div>
              <ol
                className="demo-region-progress"
                aria-label="Eight-region progress"
              >
                {MOUTH_REGIONS.map((id, i) => (
                  <li key={id}>
                    <button
                      type="button"
                      aria-label={`Review ${regionDetail(id).label}`}
                      aria-current={step.region === id ? "step" : undefined}
                      onClick={() =>
                        setState((current) => ({ ...current, index: i + 1 }))
                      }
                    >
                      {i + 1}
                    </button>
                  </li>
                ))}
              </ol>
              <p className="demo-caption">
                View {MOUTH_REGIONS.indexOf(step.region) + 1} of 8 · Synthetic
                sample
              </p>
            </section>
          </div>
        )}

        {step.kind === "results" && (
          <div className="demo-two-column">
            <div>
              <DemoPhoto region={observation.region} mask={mask} />
              <button
                type="button"
                className="scan-text-button"
                aria-pressed={mask}
                onClick={() => setMask(!mask)}
              >
                {mask ? "Hide" : "Show"} observation outline
              </button>
            </div>
            <section>
              <p className="demo-eyebrow">8 of 8 sample views · October 17</p>
              <h2>{observation.description}</h2>
              <p>Left inner cheek</p>
              <dl className="demo-descriptors">
                <div>
                  <dt>Approximate area</dt>
                  <dd>{observation.currentAreaPercent}% of the image</dd>
                </div>
                <div>
                  <dt>Shape</dt>
                  <dd>{observation.shape}</dd>
                </div>
                <div>
                  <dt>Color</dt>
                  <dd>{observation.color}</dd>
                </div>
                <div>
                  <dt>Texture</dt>
                  <dd>{observation.texture}</dd>
                </div>
              </dl>
              <p className="demo-caption">
                Prepared example outline and values, not a model prediction.
                This result is not a diagnosis.
              </p>
            </section>
          </div>
        )}

        {step.kind === "map" && (
          <>
            <p className="demo-subtitle">
              Rotate, zoom, or select a region to explore the sample scan.
            </p>
            <p className="demo-caption">
              Generic oral map · Not a personal reconstruction
            </p>
            <ScanObservationMap
              completed={MOUTH_REGIONS}
              selected={region}
              pins={samplePins}
              onSelect={setRegion}
            />
            <section className="demo-selected-region" aria-live="polite">
              <div>
                <p className="demo-eyebrow">Selected region</p>
                <h2>{regionDetail(region).label}</h2>
                <p>
                  {region === observation.region
                    ? "Small red area · Prepared sample observation"
                    : "Sample photo available"}
                </p>
              </div>
              <div className="demo-thumbnail">
                <DemoPhoto
                  region={region}
                  mask={region === observation.region}
                />
              </div>
            </section>
          </>
        )}

        {step.kind === "history" && (
          <>
            <p className="demo-subtitle">
              The same observation, organized across two example visits.
            </p>
            <div className="demo-timeline">
              {[
                { date: "October 17, 2026", area: 3.2, baseline: false },
                { date: "October 3, 2026", area: 4.0, baseline: true },
              ].map((visit) => (
                <article key={visit.date}>
                  <div className="demo-timeline-dot" aria-hidden="true" />
                  <div className="demo-thumbnail">
                    <DemoPhoto
                      region={observation.region}
                      mask
                      baseline={visit.baseline}
                    />
                  </div>
                  <div>
                    <p className="demo-eyebrow">Sample visit</p>
                    <h2>{visit.date}</h2>
                    <p>Left inner cheek · Small red area</p>
                    <p>Approximate area: {visit.area.toFixed(1)}%</p>
                  </div>
                  <button
                    type="button"
                    className="scan-text-button"
                    onClick={() =>
                      setState((current) => ({
                        ...current,
                        index: visit.baseline ? 12 : 9,
                      }))
                    }
                  >
                    View {visit.baseline ? "comparison" : "result"}{" "}
                    <span aria-hidden="true">→</span>
                  </button>
                </article>
              ))}
            </div>
          </>
        )}

        {step.kind === "compare" && (
          <div className="demo-two-column">
            <div>
              <div className="demo-comparison">
                <DemoPhoto region={observation.region} mask baseline />
                <div
                  className="demo-comparison-current"
                  style={{ clipPath: `inset(0 0 0 ${blend}%)` }}
                >
                  <DemoPhoto region={observation.region} mask />
                </div>
                <span
                  className="demo-comparison-divider"
                  style={{ left: `${blend}%` }}
                  aria-hidden="true"
                />
                <div className="demo-comparison-labels">
                  <span>Oct 3 · Sample</span>
                  <span>Oct 17 · Sample</span>
                </div>
              </div>
              <label className="demo-slider-label" htmlFor="demo-blend">
                Compare example outlines
              </label>
              <input
                id="demo-blend"
                type="range"
                min="0"
                max="100"
                value={blend}
                onChange={(e) => setBlend(Number(e.target.value))}
              />
              <p className="demo-caption">
                One synthetic image, two illustrative outlines.
              </p>
            </div>
            <section>
              <p className="demo-eyebrow">Left inner cheek</p>
              <h2>Follow the same observation</h2>
              <p>Confirm the match before comparing a change.</p>
              <label className="demo-confirm">
                <input
                  type="checkbox"
                  checked={state.matchConfirmed}
                  onChange={(e) =>
                    setState((current) => ({
                      ...current,
                      matchConfirmed: e.target.checked,
                    }))
                  }
                />
                <span>These show the same sample observation</span>
              </label>
              {state.matchConfirmed ? (
                <div className="demo-change" role="status">
                  <strong>4.0% → 3.2%</strong>
                  <p>20% smaller normalized area</p>
                  <small>
                    Illustrative values · Not a physical measurement
                  </small>
                </div>
              ) : (
                <p className="demo-caption">
                  Confirm above to reveal the sample change.
                </p>
              )}
            </section>
          </div>
        )}

        {step.kind === "report" && (
          <DemoReport matchConfirmed={state.matchConfirmed} />
        )}

        {step.kind === "finish" && (
          <div className="demo-finish">
            <span className="demo-finish-mark" aria-hidden="true">
              ✓
            </span>
            <p className="demo-lead">From a photo to a record you can use.</p>
            <p>
              You’ve explored all eight regions, results, the map, history,
              comparison, and a report.
            </p>
            <p className="demo-caption">
              The tour hasn’t added anything to your saved scans.
            </p>
          </div>
        )}
      </main>
      <footer
        ref={controls}
        className="demo-controls"
        aria-label="Guided demo controls"
      >
        <div className="demo-controls-inner">
          <div className="demo-controls-meta">
            <span aria-live="polite">
              Sample · {state.index + 1} / {DEMO_STEPS.length}
            </span>
            <button
              type="button"
              className="scan-text-button"
              onClick={() => move("restart")}
            >
              Restart
            </button>
            <button
              type="button"
              className="scan-text-button"
              onClick={() => move("skip")}
              disabled={step.kind === "finish"}
            >
              Skip
            </button>
          </div>
          <div className="demo-controls-actions">
            <button
              type="button"
              className="scan-button"
              onClick={() => move("back")}
              disabled={state.index === 0}
            >
              Back
            </button>
            <button
              type="button"
              className="scan-button scan-button-primary"
              onClick={() => (step.kind === "finish" ? onExit() : move("next"))}
            >
              {step.kind === "welcome"
                ? "Start sample scan"
                : step.kind === "finish"
                  ? "Start my own scan"
                  : step.kind === "region" &&
                      step.region === "lower_dental_arch"
                    ? "View results"
                    : step.kind === "results"
                      ? "View on 3D map"
                      : "Next"}
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
