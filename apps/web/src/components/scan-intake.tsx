"use client";

import { useEffect, useRef, useState } from "react";
import type { GuestSession } from "@/lib/guest-scan";

export function ScanIntake({
  onFinish,
  onCancel,
}: {
  onFinish: (intake: GuestSession["intake"]) => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState(0);
  const [consent, setConsent] = useState(false);
  const [symptoms, setSymptoms] = useState<string[]>([]);
  const [duration, setDuration] = useState("Not sure");
  const [change, setChange] = useState("Not sure");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const options = ["Soreness", "A patch or spot", "Bleeding", "Swelling"];

  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  return (
    <section className="scan-intake" aria-labelledby="intake-heading">
      <p className="scan-step-note">
        {step + 1} of {symptoms.length ? 3 : 2}
      </p>
      <h1 id="intake-heading" ref={headingRef} tabIndex={-1}>
        {step === 0
          ? "Before your scan"
          : step === 1
            ? "Anything you’ve noticed?"
            : "A little more context"}
      </h1>
      {step === 0 ? (
        <>
          <p>
            Take one mouth photo for each of eight regions. Stoma3D checks the
            photo, highlights candidate areas, and keeps your observations
            organized.
          </p>
          <p>
            Your mouth-only photos are sent to the analysis service when you
            choose Use photo. Accepted results are encrypted and saved on this
            device.
          </p>
          <p className="scan-help">This result is not a diagnosis.</p>
          <label className="scan-check">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            <span>
              I have permission to scan and agree to send mouth-only photos for
              analysis.
            </span>
          </label>
        </>
      ) : step === 1 ? (
        <>
          <p>You can continue with no symptoms or when you’re not sure.</p>
          <fieldset className="scan-symptoms">
            <legend className="sr-only">Symptoms</legend>
            {options.map((label) => (
              <label className="scan-check" key={label}>
                <input
                  type="checkbox"
                  checked={symptoms.includes(label)}
                  onChange={() =>
                    setSymptoms((current) =>
                      current.includes(label)
                        ? current.filter((item) => item !== label)
                        : [...current, label],
                    )
                  }
                />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>
          <label className="scan-check">
            <input
              type="radio"
              name="none"
              checked={symptoms.length === 0}
              onChange={() => setSymptoms([])}
            />
            <span>No symptoms / not sure</span>
          </label>
        </>
      ) : (
        <>
          <label className="scan-field">
            How long have you noticed it?
            <select
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
            >
              {[
                "Not sure",
                "Less than a week",
                "One to two weeks",
                "More than two weeks",
              ].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label className="scan-field">
            Has it changed?
            <select
              value={change}
              onChange={(event) => setChange(event.target.value)}
            >
              {["Not sure", "About the same", "Improving", "Getting worse"].map(
                (value) => (
                  <option key={value}>{value}</option>
                ),
              )}
            </select>
          </label>
        </>
      )}
      <div className="scan-actions">
        <button
          type="button"
          className="scan-button scan-button-primary"
          disabled={step === 0 && !consent}
          onClick={() => {
            if (step === 0 || (step === 1 && symptoms.length > 0))
              setStep(step + 1);
            else onFinish({ symptoms, duration, change });
          }}
        >
          {step === 2 || (step === 1 && symptoms.length === 0)
            ? "Start scan"
            : "Continue"}
        </button>
        <button
          type="button"
          className="scan-button"
          onClick={step === 0 ? onCancel : () => setStep(step - 1)}
        >
          {step === 0 ? "Cancel" : "Back"}
        </button>
      </div>
    </section>
  );
}
