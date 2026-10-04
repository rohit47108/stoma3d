import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGuestSession } from "./guest-scan";
import { guestConflictRecovery, saveGuestUpdate } from "./guest-save";
import { refreshGuestSessions, saveGuestSession } from "./guest-storage";

vi.mock("./guest-storage", () => ({
  saveGuestSession: vi.fn(),
  refreshGuestSessions: vi.fn(),
  loadGuestSessions: vi.fn(async () => []),
  isGuestSessionConflictError: (error: unknown) =>
    error instanceof Error && error.name === "GuestSessionConflictError",
}));

beforeEach(() => vi.clearAllMocks());

describe("guest save conflict recovery", () => {
  it("opens the same scan's map when another tab replaced the displayed result", () => {
    const recovery = guestConflictRecovery(true, "old-photo", ["latest-photo"]);
    expect(recovery.openMap).toBe(true);
    expect(recovery.message).toBe(
      "That photo was replaced in another tab. Open its latest result from the map.",
    );
  });

  it("keeps photo review open when a stale save reloads the latest scan", () => {
    expect(
      guestConflictRecovery(false, "old-photo", ["latest-photo"]).openMap,
    ).toBe(false);
  });

  it("keeps a displayed result open when its saved capture still exists", () => {
    expect(
      guestConflictRecovery(true, "same-photo", ["same-photo"]).openMap,
    ).toBe(false);
  });

  it("does not leave the current screen when there is no displayed result to replace", () => {
    expect(guestConflictRecovery(true, null, ["latest-photo"]).openMap).toBe(
      false,
    );
  });

  it("reloads the same scan without saving a stale update over it", async () => {
    const stale = createGuestSession("same-scan");
    const latest = { ...stale, updatedAt: "2026-10-03T15:00:00.000Z" };
    const conflict = new Error("The scan changed in another tab.");
    conflict.name = "GuestSessionConflictError";
    vi.mocked(saveGuestSession).mockRejectedValue(conflict);
    vi.mocked(refreshGuestSessions).mockResolvedValue([latest]);

    await expect(saveGuestUpdate(stale)).resolves.toEqual({
      status: "reloaded",
      sessions: [latest],
      session: latest,
    });
    expect(saveGuestSession).toHaveBeenCalledExactlyOnceWith(stale);
  });

  it("does not mistake low storage for a concurrent edit", async () => {
    const error = new Error("Not enough device storage.");
    vi.mocked(saveGuestSession).mockRejectedValue(error);
    await expect(
      saveGuestUpdate(createGuestSession("full-device")),
    ).rejects.toBe(error);
    expect(refreshGuestSessions).not.toHaveBeenCalled();
  });

  it("never switches to another scan when the conflicted scan cannot be found", async () => {
    const conflict = new Error("The scan changed in another tab.");
    conflict.name = "GuestSessionConflictError";
    vi.mocked(saveGuestSession).mockRejectedValue(conflict);
    vi.mocked(refreshGuestSessions).mockResolvedValue([
      createGuestSession("other-scan"),
    ]);
    await expect(
      saveGuestUpdate(createGuestSession("missing-scan")),
    ).rejects.toBe(conflict);
  });

  it("returns success only after the update has saved", async () => {
    vi.mocked(saveGuestSession).mockResolvedValue(undefined);
    await expect(
      saveGuestUpdate(createGuestSession("saved-scan")),
    ).resolves.toEqual({ status: "saved" });
    expect(refreshGuestSessions).not.toHaveBeenCalled();
  });

  it("does not adopt new device data when deletion happens during conflict recovery", async () => {
    const conflict = new Error("The scan changed in another tab.");
    conflict.name = "GuestSessionConflictError";
    const deleted = new Error("Device data was cleared in another tab.");
    deleted.name = "GuestDataClearedError";
    vi.mocked(saveGuestSession).mockRejectedValue(conflict);
    vi.mocked(refreshGuestSessions).mockRejectedValue(deleted);

    await expect(
      saveGuestUpdate(createGuestSession("cleared-scan")),
    ).rejects.toBe(deleted);
    expect(saveGuestSession).toHaveBeenCalledTimes(1);
  });
});
