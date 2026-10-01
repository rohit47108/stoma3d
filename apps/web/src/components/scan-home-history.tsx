"use client";

import {
  captureSummary,
  regionDetail,
  type GuestCapture,
  type GuestSession,
} from "@/lib/guest-scan";

interface SharedProps {
  sessions: GuestSession[];
  onOpen: (session: GuestSession, capture: GuestCapture) => void;
  onStart: () => void;
}

export function ScanHome({
  sessions,
  session,
  onOpen,
  onStart,
  onMap,
}: SharedProps & { session: GuestSession | null; onMap: () => void }) {
  const recent = sessions.find((item) => item.captures.length > 0);
  const recentCapture = recent?.captures.at(-1);
  return (
    <div className="scan-home">
      <p className="scan-home-lead">
        Take a guided mouth scan. Review each photo, explore your observations,
        and keep a clear record.
      </p>
      <button
        type="button"
        className="scan-button scan-button-primary"
        onClick={onStart}
      >
        {session && session.captures.length < 8
          ? "Continue scan"
          : "Start scan"}
        <span aria-hidden="true">→</span>
      </button>
      {session && (
        <div className="scan-home-progress">
          <span>{session.captures.length} of 8 regions captured</span>
          <progress max="8" value={session.captures.length} />
          <small>
            {session.captures.length === 8
              ? "Your scan is complete."
              : "Pick up where you left off."}
          </small>
        </div>
      )}
      <button type="button" className="scan-text-button" onClick={onMap}>
        Explore the 3D map
      </button>
      {recent && recentCapture && (
        <section className="scan-recent">
          <h2>Recent observation</h2>
          <button type="button" onClick={() => onOpen(recent, recentCapture)}>
            <span>
              {regionDetail(recentCapture.region).label}
              <small>
                {new Date(recentCapture.capturedAt).toLocaleDateString()}
              </small>
            </span>
            <span aria-hidden="true">→</span>
          </button>
        </section>
      )}
    </div>
  );
}

export function ScanHistory({
  sessions,
  onOpen,
  onStart,
  onResume,
}: SharedProps & { onResume: (session: GuestSession) => void }) {
  if (!sessions.length)
    return (
      <div className="scan-empty">
        <h2>No scans yet</h2>
        <p>Your accepted photos and results will appear here.</p>
        <button
          type="button"
          className="scan-button scan-button-primary"
          onClick={onStart}
        >
          Start scan
        </button>
      </div>
    );
  return (
    <div className="scan-history">
      {sessions.map((item) => (
        <section key={item.id}>
          <div className="scan-history-heading">
            <h2>
              {new Date(item.createdAt).toLocaleDateString(undefined, {
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </h2>
            <span>{item.captures.length}/8 captured</span>
          </div>
          {item.captures.length ? (
            <ul>
              {item.captures.map((result) => (
                <li key={result.id}>
                  <button type="button" onClick={() => onOpen(item, result)}>
                    <span>
                      {regionDetail(result.region).label}
                      <small>{captureSummary(result)}</small>
                    </span>
                    <span aria-hidden="true">→</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p>No photos captured yet.</p>
          )}
          <button
            type="button"
            className="scan-text-button"
            onClick={() => onResume(item)}
          >
            {item.captures.length < 8 ? "Continue this scan" : "Open scan"}
          </button>
        </section>
      ))}
    </div>
  );
}
