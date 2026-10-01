import { guestSessionSchema, type GuestSession } from "./guest-scan";

const DATABASE = "stoma3d-guest-v1";
const KEY_ID = "installation-key";
const GENERATION_ID = "data-generation";
const RESET_CHANNEL = "stoma3d-guest-data-reset";

export class GuestDataClearedError extends Error {
  readonly code = "GUEST_DATA_CLEARED";

  constructor() {
    super("Device data was cleared in another tab. Start a new scan.");
    this.name = "GuestDataClearedError";
  }
}

export function isGuestDataClearedError(error: unknown): boolean {
  return error instanceof GuestDataClearedError;
}
export interface EncryptedGuestRecord {
  iv: Uint8Array<ArrayBuffer>;
  ciphertext: ArrayBuffer;
}

export async function encryptGuestRecord(
  key: CryptoKey,
  value: unknown,
): Promise<EncryptedGuestRecord> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return { iv, ciphertext };
}

export async function decryptGuestRecord(
  key: CryptoKey,
  record: EncryptedGuestRecord,
): Promise<unknown> {
  const bytes = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: record.iv },
    key,
    record.ciphertext,
  );
  return JSON.parse(new TextDecoder().decode(bytes));
}

function openDatabase(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB || !globalThis.crypto?.subtle) {
    return Promise.reject(
      new Error(
        "Protected device storage is unavailable in this browser. Open Stoma3D in a regular browser window over HTTPS.",
      ),
    );
  }
  // CryptoKey is structured-cloned into IndexedDB, never exported or placed in localStorage.
  // https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("keys");
      request.result.createObjectStore("records");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        new Error(
          "Device storage could not open. Try a regular browser window.",
        ),
      );
    request.onblocked = () =>
      reject(new Error("Close other Stoma3D tabs and try again."));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        new Error(
          "Your scan could not be saved. Check available device storage.",
        ),
      );
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = transaction.onabort = () =>
      reject(
        new Error(
          "Your scan could not be saved. Check available device storage.",
        ),
      );
  });
}

interface StorageIdentity {
  key: CryptoKey;
  generation: string;
}

async function initializeIdentity(
  db: IDBDatabase,
  expected?: string,
): Promise<StorageIdentity> {
  // Non-extractable AES keys: https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/generateKey
  const candidate = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("keys", "readwrite");
    const store = transaction.objectStore("keys");
    const generationRequest = store.get(GENERATION_ID);
    let key = candidate;
    let generation = crypto.randomUUID();
    let cleared = false;
    generationRequest.onsuccess = () => {
      if (expected && generationRequest.result !== expected) {
        cleared = true;
        transaction.abort();
        return;
      }
      // Existing v1 encrypted records keep their key. The new non-sensitive
      // generation is added in place, without replacing or dropping records.
      if (typeof generationRequest.result === "string") {
        generation = generationRequest.result;
      } else {
        store.put(generation, GENERATION_ID);
      }
      const keyRequest = store.get(KEY_ID);
      keyRequest.onsuccess = () => {
        key = (keyRequest.result as CryptoKey | undefined) ?? candidate;
        if (!keyRequest.result) store.put(key, KEY_ID);
      };
    };
    transaction.oncomplete = () => resolve({ key, generation });
    transaction.onerror = transaction.onabort = () =>
      reject(
        cleared
          ? new GuestDataClearedError()
          : new Error("Protected device storage could not initialize."),
      );
  });
}

// This generation belongs to this client, not just its queue. Other tabs use
// independent queues; every final write checks the durable generation atomically.
let clientGeneration: string | null = null;
let storageQueue: Promise<unknown> = Promise.resolve();
function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const next = storageQueue.then(operation, operation);
  storageQueue = next.catch(() => undefined);
  return next;
}

const resetListeners = new Set<() => void>();
let resetChannel: BroadcastChannel | null = null;

function notifyReset() {
  for (const listener of resetListeners) listener();
}

async function checkGeneration() {
  const expected = clientGeneration;
  if (!expected) return;
  const db = await openDatabase();
  try {
    const generation = await requestResult(
      db.transaction("keys", "readonly").objectStore("keys").get(GENERATION_ID),
    );
    if (generation !== expected && clientGeneration === expected) notifyReset();
  } finally {
    db.close();
  }
}

function checkAfterReturning() {
  if (typeof document !== "undefined" && document.visibilityState === "hidden")
    return;
  void checkGeneration().catch(() => undefined);
}

export function subscribeGuestDataReset(listener: () => void): () => void {
  resetListeners.add(listener);
  if (resetListeners.size === 1) {
    if (typeof BroadcastChannel !== "undefined") {
      resetChannel = new BroadcastChannel(RESET_CHANNEL);
      resetChannel.onmessage = (event: MessageEvent<unknown>) => {
        const message = event.data;
        if (
          typeof message === "object" &&
          message !== null &&
          "type" in message &&
          message.type === "reset" &&
          "generation" in message &&
          typeof message.generation === "string" &&
          message.generation !== clientGeneration
        )
          notifyReset();
      };
    }
    // BroadcastChannel improves immediacy; the durable check on returning also
    // covers suspended tabs and browsers where broadcasting is unavailable.
    if (typeof window !== "undefined")
      window.addEventListener("focus", checkAfterReturning);
    if (typeof document !== "undefined")
      document.addEventListener("visibilitychange", checkAfterReturning);
  }
  return () => {
    resetListeners.delete(listener);
    if (resetListeners.size === 0) {
      resetChannel?.close();
      resetChannel = null;
      if (typeof window !== "undefined")
        window.removeEventListener("focus", checkAfterReturning);
      if (typeof document !== "undefined")
        document.removeEventListener("visibilitychange", checkAfterReturning);
    }
  };
}

async function readForGeneration(db: IDBDatabase, expected: string) {
  return new Promise<{ key: CryptoKey; records: EncryptedGuestRecord[] }>(
    (resolve, reject) => {
      const transaction = db.transaction(["keys", "records"], "readonly");
      const keys = transaction.objectStore("keys");
      let key: CryptoKey;
      let records: EncryptedGuestRecord[] = [];
      let cleared = false;
      const generationRequest = keys.get(GENERATION_ID);
      generationRequest.onsuccess = () => {
        if (generationRequest.result !== expected) {
          cleared = true;
          transaction.abort();
          return;
        }
        const keyRequest = keys.get(KEY_ID);
        keyRequest.onsuccess = () => {
          if (!keyRequest.result) {
            cleared = true;
            transaction.abort();
            return;
          }
          key = keyRequest.result as CryptoKey;
          const recordsRequest = transaction.objectStore("records").getAll();
          recordsRequest.onsuccess = () => {
            records = recordsRequest.result as EncryptedGuestRecord[];
          };
        };
      };
      transaction.oncomplete = () => resolve({ key, records });
      transaction.onerror = transaction.onabort = () =>
        reject(
          cleared
            ? new GuestDataClearedError()
            : new Error("Your saved scans could not open. Try again."),
        );
    },
  );
}

export function loadGuestSessions(): Promise<GuestSession[]> {
  return serialized(async () => {
    const db = await openDatabase();
    try {
      const identity = await initializeIdentity(db);
      const { key, records } = await readForGeneration(db, identity.generation);
      const sessions = await Promise.all(
        records.map(async (record) =>
          guestSessionSchema.parse(await decryptGuestRecord(key, record)),
        ),
      );
      const currentGeneration = await requestResult(
        db
          .transaction("keys", "readonly")
          .objectStore("keys")
          .get(GENERATION_ID),
      );
      if (currentGeneration !== identity.generation)
        throw new GuestDataClearedError();
      clientGeneration = identity.generation;
      return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    } finally {
      db.close();
    }
  });
}

export function saveGuestSession(session: GuestSession): Promise<void> {
  // Capture before joining the queue. A later clear must not give an already
  // pending save permission to use the new generation.
  const expected = clientGeneration;
  return serialized(async () => {
    guestSessionSchema.parse(session);
    if (!expected)
      throw new Error("Device storage is still opening. Try again.");
    const db = await openDatabase();
    try {
      const { key } = await initializeIdentity(db, expected);
      const encrypted = await encryptGuestRecord(key, session);
      // No crypto awaits inside this transaction: generation validation and the
      // encrypted put run in the same active read/write transaction as clear.
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(["keys", "records"], "readwrite");
        const request = transaction.objectStore("keys").get(GENERATION_ID);
        let cleared = false;
        request.onsuccess = () => {
          if (request.result !== expected) {
            cleared = true;
            transaction.abort();
            return;
          }
          transaction.objectStore("records").put(encrypted, session.id);
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = transaction.onabort = () =>
          reject(
            cleared
              ? new GuestDataClearedError()
              : new Error(
                  "Your scan could not be saved. Check available device storage.",
                ),
          );
      });
    } finally {
      db.close();
    }
  }).catch((error: unknown) => {
    if (isGuestDataClearedError(error) && clientGeneration === expected)
      notifyReset();
    throw error;
  });
}

export function clearGuestData(): Promise<void> {
  return serialized(async () => {
    const db = await openDatabase();
    try {
      const transaction = db.transaction(["records", "keys"], "readwrite");
      const completion = transactionComplete(transaction);
      const generation = crypto.randomUUID();
      transaction.objectStore("records").clear();
      transaction.objectStore("keys").clear();
      // Keep only a non-sensitive tombstone. Removing it would let an old tab
      // create a fresh key and resurrect the photos the user just deleted.
      transaction.objectStore("keys").put(generation, GENERATION_ID);
      await completion;
      clientGeneration = generation;
      notifyReset();
      if (typeof BroadcastChannel !== "undefined") {
        const channel = resetChannel ?? new BroadcastChannel(RESET_CHANNEL);
        channel.postMessage({ type: "reset", generation });
        if (channel !== resetChannel) channel.close();
      }
    } finally {
      db.close();
    }
  });
}
