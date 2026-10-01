import type { Metadata } from "next";
import Link from "next/link";

import { PhoneCapture } from "@/components/phone-capture";
import { RegionMap } from "@/components/region-map";
import { scanSteps } from "@/content/site";

export const metadata: Metadata = {
  title: "Guided mouth scans and visual change tracking",
  description:
    "Capture eight consistent mouth views, review visible changes, compare observations over time, and create a report you control.",
};

function Arrow() {
  return <span aria-hidden="true">→</span>;
}

export default function HomePage() {
  return (
    <>
      <section className="hero page-width" aria-labelledby="hero-heading">
        <ol className="scan-rail" aria-label="The Stoma3D flow">
          {scanSteps.map((step, index) => (
            <li
              key={step.title}
              className={index === 0 ? "scan-rail__active" : undefined}
            >
              <span className="scan-rail__number">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div>
                <h2>{step.title}</h2>
                <p>{step.summary}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="hero-copy">
          <p className="hero-copy__lead">Guided mouth observation</p>
          <h1 id="hero-heading">
            Track visible changes with a consistent scan.
          </h1>
          <p className="hero-copy__body">
            Stoma3D guides you through eight mouth regions, checks each capture,
            highlights candidate areas, and turns your observations into a
            timeline and shareable report.
          </p>
          <div className="hero-actions">
            <Link className="button" href="/scan">
              Start scan
            </Link>
            <Link className="arrow-link" href="/for-professionals">
              For professionals <Arrow />
            </Link>
          </div>
          <p className="hero-note">
            Your scans stay organized by region, date, and capture quality.
          </p>
        </div>

        <PhoneCapture />
        <RegionMap />
      </section>

      <section
        className="chapter chapter--comparison"
        aria-labelledby="comparison-heading"
      >
        <div className="page-width chapter-grid">
          <div className="chapter-copy">
            <p className="section-label">Compare with context</p>
            <h2 id="comparison-heading">See the same area, side by side.</h2>
            <p>
              Confirm two observations show the same area, then review them side
              by side. Stoma3D checks whether the images align well enough
              before showing an approximate change.
            </p>
            <Link className="arrow-link" href="/how-it-works#compare">
              How comparisons work <Arrow />
            </Link>
          </div>
          <div
            className="comparison-stage"
            role="group"
            aria-label="Empty comparison preview"
          >
            <div className="comparison-stage__header">
              <span>Inside left cheek</span>
              <span>Comparison preview</span>
            </div>
            <div className="comparison-stage__views">
              <div className="observation-placeholder">
                <span>Earlier observation</span>
                <svg viewBox="0 0 220 140" aria-hidden="true">
                  <path d="M24 99c28-58 78-79 150-48 17 8 27 23 31 45-67-22-119-21-181 3Z" />
                  <path d="M57 92c30-29 69-38 117-25" />
                </svg>
              </div>
              <div className="observation-placeholder">
                <span>Current observation</span>
                <svg viewBox="0 0 220 140" aria-hidden="true">
                  <path d="M24 99c28-58 78-79 150-48 17 8 27 23 31 45-67-22-119-21-181 3Z" />
                  <path d="M57 92c30-29 69-38 117-25" />
                </svg>
              </div>
            </div>
            <p className="comparison-stage__empty">
              No sample result is shown. Your own confirmed observations appear
              here.
            </p>
          </div>
        </div>
      </section>

      <section
        className="chapter chapter--share"
        aria-labelledby="sharing-heading"
      >
        <div className="page-width share-layout">
          <div
            className="share-preview"
            role="group"
            aria-label="Report sharing settings preview"
          >
            <div className="share-preview__heading">
              <strong>Share report</strong>
              <span>Preview</span>
            </div>
            <dl>
              <div>
                <dt>Included</dt>
                <dd>Selected sessions and notes</dd>
              </div>
              <div>
                <dt>Access</dt>
                <dd>View-only link</dd>
              </div>
              <div>
                <dt>Expires</dt>
                <dd>Choose a time limit</dd>
              </div>
            </dl>
            <button type="button" disabled>
              Create link after review
            </button>
            <small>Interface preview. No link is created here.</small>
          </div>
          <div className="chapter-copy chapter-copy--share">
            <p className="section-label">Share on your terms</p>
            <h2 id="sharing-heading">A report without giving up control.</h2>
            <p>
              Choose the sessions and notes that belong in a report. Shared
              access can be time-limited and revoked. A local PDF remains
              available when you prefer not to share online.
            </p>
            <ul className="plain-checklist">
              <li>Clear input and analysis provenance</li>
              <li>Approximate values labeled as approximate</li>
              <li>Limitations placed beside the result</li>
            </ul>
            <Link className="arrow-link" href="/privacy">
              Read the privacy approach <Arrow />
            </Link>
          </div>
        </div>
      </section>

      <section
        className="report-chapter page-width"
        aria-labelledby="report-heading"
      >
        <div className="report-chapter__heading">
          <p className="section-label">Made for a real conversation</p>
          <h2 id="report-heading">A report a professional can scan quickly.</h2>
          <p>
            Dates, region names, image quality, visible descriptors, confidence,
            comparisons, and questions stay together in one readable record.
          </p>
        </div>
        <article className="report-sheet" aria-label="Report structure preview">
          <header>
            <div>
              <span className="report-sheet__mark">Stoma3D</span>
              <h3>Oral observation report</h3>
            </div>
            <span className="report-sheet__status">Prepared locally</span>
          </header>
          <div className="report-sheet__summary">
            <span>Session date</span>
            <strong>Shown when created</strong>
            <span>Coverage</span>
            <strong>8 named regions</strong>
          </div>
          <div className="report-sheet__row">
            <span className="report-sheet__region">Region</span>
            <div>
              <strong>Observation and quality summary</strong>
              <p>
                Descriptors, uncertainty, and any reason analysis was
                unavailable.
              </p>
            </div>
          </div>
          <footer>
            <strong>This result is not a diagnosis.</strong>
            <span>Preview contains no patient data.</span>
          </footer>
        </article>
      </section>

      <section className="closing-callout">
        <div className="page-width closing-callout__inner">
          <h2>See how Stoma3D analyzes each capture.</h2>
          <p>
            Explore the image checks, candidate-area analysis, confidence
            details, comparison rules, and model performance records behind a
            result.
          </p>
          <Link className="button button--light" href="/research">
            Explore the analysis
          </Link>
        </div>
      </section>
    </>
  );
}
