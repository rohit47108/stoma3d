import type { GuestSession } from "./guest-scan";
import {
  isGuestSessionConflictError,
  refreshGuestSessions,
  saveGuestSession,
} from "./guest-storage";

export type GuestSaveOutcome =
  | { status: "saved" }
  | { status: "reloaded"; sessions: GuestSession[]; session: GuestSession };

export function guestConflictRecovery(
  showingResult: boolean,
  captureId: string | null,
  latestCaptureIds: readonly string[],
): { openMap: boolean; message: string } {
  const openMap =
    showingResult &&
    captureId !== null &&
    !latestCaptureIds.includes(captureId);
  return {
    openMap,
    message: openMap
      ? "That photo was replaced in another tab. Open its latest result from the map."
      : "This scan changed in another tab. The latest saved photos are loaded; try again.",
  };
}

export async function saveGuestUpdate(
  next: GuestSession,
): Promise<GuestSaveOutcome> {
  try {
    await saveGuestSession(next);
    return { status: "saved" };
  } catch (error) {
    if (!isGuestSessionConflictError(error)) throw error;
    // Do not merge medical results or silently select a different scan. The
    // caller keeps the reviewed photo and applies a fresh retry to this scan.
    const sessions = await refreshGuestSessions();
    const session = sessions.find((item) => item.id === next.id);
    if (!session) throw error;
    return { status: "reloaded", sessions, session };
  }
}
