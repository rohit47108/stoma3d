"use client";

import type { MouthRegion } from "@stoma3d/contracts";
import {
  captureSummary,
  guestCompletedRegions,
  regionDetail,
  type GuestCapture,
  type GuestSession,
} from "@/lib/guest-scan";
import { ScanObservationMap } from "./scan-observation-map";

interface Props {
  session: GuestSession | null;
  region: MouthRegion;
  onSelect: (region: MouthRegion) => void;
  onCapture: () => void;
  onOpen: (session: GuestSession, capture: GuestCapture) => void;
}

export function ScanMapPanel({
  session,
  region,
  onSelect,
  onCapture,
  onOpen,
}: Props) {
  const selected = session?.captures.find((item) => item.region === region);
  const confirmed =
    selected && session?.pins.some((pin) => pin.captureId === selected.id);
  return (
    <>
      <p className="scan-help">
        A general mouth map for organizing your observations.
      </p>
      <ScanObservationMap
        completed={guestCompletedRegions(session)}
        selected={region}
        pins={session?.pins ?? []}
        onSelect={onSelect}
      />
      <div className="scan-map-observation">
        <h2>{regionDetail(region).shortLabel}</h2>
        <p>
          {selected
            ? confirmed
              ? "Your confirmed observation is marked on this region."
              : captureSummary(selected)
            : "No photo for this region yet."}
        </p>
        <button
          type="button"
          className="scan-button scan-button-primary"
          onClick={
            selected && session ? () => onOpen(session, selected) : onCapture
          }
        >
          {selected ? "View result" : "Capture this region"}
        </button>
      </div>
      {session && session.captures.length > 0 && (
        <button
          type="button"
          className="scan-text-button"
          onClick={() => window.print()}
        >
          Save or print report
        </button>
      )}
    </>
  );
}
