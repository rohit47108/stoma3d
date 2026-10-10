import { describe, expect, it } from "vitest";
import { createLocalMutationQueue } from "../src/lib/localMutationQueue";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

describe("complete local mutation queue", () => {
  it("runs the first mutation eagerly but waits through cleanup before taking the next snapshot", async () => {
    const enqueue = createLocalMutationQueue();
    const persistence = deferred();
    const cleanup = deferred();
    const events: string[] = [];
    const first = enqueue(async () => {
      events.push("first-state-change");
      await persistence.promise;
      events.push("first-committed");
      await cleanup.promise;
      events.push("first-cleaned");
    });
    const second = enqueue(async () => {
      events.push("second-snapshot");
    });
    expect(events).toEqual(["first-state-change"]);
    persistence.resolve();
    await Promise.resolve();
    expect(events).toEqual(["first-state-change", "first-committed"]);
    cleanup.resolve();
    await Promise.all([first, second]);
    expect(events).toEqual([
      "first-state-change",
      "first-committed",
      "first-cleaned",
      "second-snapshot",
    ]);
  });

  it("takes every later snapshot after a rejected mutation has rolled back", async () => {
    const enqueue = createLocalMutationQueue();
    const gate = deferred();
    let value = "saved";
    const first = enqueue(async () => {
      value = "optimistic";
      await gate.promise;
      value = "saved";
      throw new Error("not committed");
    });
    const rejection = expect(first).rejects.toThrow("not committed");
    const second = enqueue(async () => value);
    const third = enqueue(async () => {
      value = "new saved";
      return value;
    });
    gate.resolve();
    await rejection;
    await expect(second).resolves.toBe("saved");
    await expect(third).resolves.toBe("new saved");
  });

  it("continues in FIFO order after a synchronous boundary error", async () => {
    const enqueue = createLocalMutationQueue();
    const failed = enqueue(() => {
      throw new Error("invalid input");
    });
    const next = enqueue(async () => "saved");
    await expect(failed).rejects.toThrow("invalid input");
    await expect(next).resolves.toBe("saved");
  });
});
