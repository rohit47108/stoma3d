import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGuestSession } from "./guest-scan";

const DATABASE = "stoma3d-guest-v1";
let unsubscribe: (() => void) | undefined;

async function independentClient() {
  vi.resetModules();
  return import("./guest-storage");
}

async function storedValues(store: "keys" | "records") {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<unknown[]>((resolve, reject) => {
      const request = db
        .transaction(store, "readonly")
        .objectStore(store)
        .getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
});

afterEach(() => {
  unsubscribe?.();
  unsubscribe = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("persistent encrypted guest storage", () => {
  it("reopens an encrypted saved scan with a non-extractable installation key", async () => {
    const first = await independentClient();
    await first.loadGuestSessions();
    const session = createGuestSession(
      "scan-to-reopen",
      "2026-10-01T12:00:00.000Z",
    );
    await first.saveGuestSession(session);
    const second = await independentClient();
    expect(await second.loadGuestSessions()).toEqual([session]);

    const records = await storedValues("records");
    expect(records).toHaveLength(1);
    const record = records[0] as { ciphertext: ArrayBuffer };
    expect(new TextDecoder().decode(record.ciphertext)).not.toContain(
      session.id,
    );
    const key = (await storedValues("keys")).find(
      (value) => value instanceof CryptoKey,
    ) as CryptoKey;
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", key)).rejects.toThrow();
  });

  it("deletes all encrypted records and the old key before reopening empty", async () => {
    const first = await independentClient();
    await first.loadGuestSessions();
    await first.saveGuestSession(createGuestSession("deleted-scan"));
    const [deletedRecord] = await storedValues("records");
    await first.clearGuestData();
    expect(await storedValues("records")).toEqual([]);
    expect(
      (await storedValues("keys")).some((value) => value instanceof CryptoKey),
    ).toBe(false);
    const reopened = await independentClient();
    expect(await reopened.loadGuestSessions()).toEqual([]);
    await reopened.saveGuestSession(createGuestSession("new-scan"));
    expect(
      (await reopened.loadGuestSessions()).map((session) => session.id),
    ).toEqual(["new-scan"]);
    const freshKey = (await storedValues("keys")).find(
      (value) => value instanceof CryptoKey,
    ) as CryptoKey;
    await expect(
      reopened.decryptGuestRecord(
        freshKey,
        deletedRecord as Parameters<typeof reopened.decryptGuestRecord>[1],
      ),
    ).rejects.toThrow();
  });

  it("adds the deletion generation to existing v1 storage without replacing its key or scan", async () => {
    const client = await independentClient();
    const key = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    const legacySession = createGuestSession("legacy-scan");
    const encrypted = await client.encryptGuestRecord(key, legacySession);
    const legacyDb = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("keys");
        request.result.createObjectStore("records");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = legacyDb.transaction(
        ["keys", "records"],
        "readwrite",
      );
      transaction.objectStore("keys").put(key, "installation-key");
      transaction.objectStore("records").put(encrypted, legacySession.id);
      transaction.oncomplete = () => resolve();
      transaction.onabort = transaction.onerror = () =>
        reject(transaction.error);
    });
    legacyDb.close();
    expect(await client.loadGuestSessions()).toEqual([legacySession]);
    expect(await storedValues("records")).toEqual([encrypted]);
    const persistedKey = (await storedValues("keys")).find(
      (value) => value instanceof CryptoKey,
    ) as CryptoKey;
    expect(await client.decryptGuestRecord(persistedKey, encrypted)).toEqual(
      legacySession,
    );
  });

  it("creates a fresh key for an explicitly started scan after clearing this client", async () => {
    const client = await independentClient();
    await client.loadGuestSessions();
    await client.saveGuestSession(createGuestSession("old-scan"));
    await client.clearGuestData();
    await client.saveGuestSession(createGuestSession("fresh-scan"));
    expect(
      (await client.loadGuestSessions()).map((session) => session.id),
    ).toEqual(["fresh-scan"]);
  });

  it("does not report a save as successful when the record transaction aborts", async () => {
    const client = await independentClient();
    await client.loadGuestSessions();
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
      this: IDBObjectStore,
      ...args
    ) {
      const request = put.apply(this, args);
      if (this.name === "records") this.transaction.abort();
      return request;
    });
    await expect(
      client.saveGuestSession(createGuestSession("not-saved")),
    ).rejects.toThrow(/could not be saved/i);
    expect(await storedValues("records")).toEqual([]);
  });

  it("prevents a stale independent tab from restoring a scan after another tab clears data", async () => {
    const first = await independentClient();
    await first.loadGuestSessions();
    await first.saveGuestSession(createGuestSession("must-stay-deleted"));
    const staleTab = await independentClient();
    const [staleSession] = await staleTab.loadGuestSessions();
    await first.clearGuestData();

    await expect(staleTab.saveGuestSession(staleSession!)).rejects.toThrow(
      /cleared/i,
    );
    expect(await storedValues("records")).toEqual([]);
    expect(
      (await storedValues("keys")).some((value) => value instanceof CryptoKey),
    ).toBe(false);
  });

  it("prevents a save queued in this client after deletion starts from restoring an old scan", async () => {
    const client = await independentClient();
    await client.loadGuestSessions();
    const deleting = client.clearGuestData();
    const lateSave = client.saveGuestSession(
      createGuestSession("queued-after-clear"),
    );
    const rejected = expect(lateSave).rejects.toThrow(/cleared/i);
    await deleting;
    await rejected;
    expect(await storedValues("records")).toEqual([]);
  });

  it("rejects a write encrypted before deletion when its final transaction runs afterwards", async () => {
    const first = await independentClient();
    await first.loadGuestSessions();
    const second = await independentClient();
    await second.loadGuestSessions();
    const originalEncrypt = crypto.subtle.encrypt.bind(crypto.subtle);
    let release!: () => void;
    let signalEncryptionStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      signalEncryptionStarted = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(crypto.subtle, "encrypt").mockImplementationOnce(
      async (...args) => {
        signalEncryptionStarted();
        await held;
        return originalEncrypt(...args);
      },
    );
    const lateSave = second.saveGuestSession(createGuestSession("late-scan"));
    const rejection = expect(lateSave).rejects.toThrow(/cleared/i);
    await started;
    await first.clearGuestData();
    release();
    await rejection;
    expect(await storedValues("records")).toEqual([]);
  });

  it("notifies another open client to remove photos and results from its interface", async () => {
    const first = await independentClient();
    await first.loadGuestSessions();
    const second = await independentClient();
    await second.loadGuestSessions();
    const reset = new Promise<void>((resolve) => {
      unsubscribe = second.subscribeGuestDataReset(resolve);
    });
    await first.clearGuestData();
    await reset;
  });

  it("does not return a stale scan if deletion happens while its encrypted records are opening", async () => {
    const first = await independentClient();
    await first.loadGuestSessions();
    await first.saveGuestSession(createGuestSession("deleted-during-open"));
    const second = await independentClient();
    const originalDecrypt = crypto.subtle.decrypt.bind(crypto.subtle);
    let release!: () => void;
    let started!: () => void;
    const decryptionStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(crypto.subtle, "decrypt").mockImplementationOnce(
      async (...args) => {
        started();
        await held;
        return originalDecrypt(...args);
      },
    );
    const pendingLoad = second.loadGuestSessions();
    const rejected = expect(pendingLoad).rejects.toThrow(/cleared/i);
    await decryptionStarted;
    await first.clearGuestData();
    release();
    await rejected;
    expect(await storedValues("records")).toEqual([]);
  });
});
