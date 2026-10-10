import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";

export type Stoma3DTempKind = "capture" | "preview" | "share";

function cacheRoot(): string {
  if (!FileSystem.cacheDirectory) {
    throw new Error("Temporary device storage is unavailable.");
  }
  return FileSystem.cacheDirectory;
}

export function stoma3DTempDirectory(kind: Stoma3DTempKind): string {
  return `${cacheRoot()}stoma3d-${kind}/`;
}

export async function ensureStoma3DTempDirectory(
  kind: Stoma3DTempKind,
): Promise<string> {
  const directory = stoma3DTempDirectory(kind);
  const info = await FileSystem.getInfoAsync(directory);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  }
  return directory;
}

export async function createStoma3DTempUri(
  kind: Stoma3DTempKind,
  extension: "jpg" | "png" | "pdf",
): Promise<string> {
  const directory = await ensureStoma3DTempDirectory(kind);
  return `${directory}${Crypto.randomUUID()}.${extension}`;
}

export async function removeFileIfPresent(
  uri: string | null | undefined,
): Promise<void> {
  if (!uri) return;
  const info = await FileSystem.getInfoAsync(uri);
  if (info.exists) {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  }
}

export async function removePickerTemporaryCopy(
  uri: string | null | undefined,
): Promise<void> {
  if (!uri) return;
  const root = cacheRoot();
  if (!uri.startsWith(root)) {
    return;
  }
  await removeFileIfPresent(uri);
}

export interface PickerTemporaryLease {
  release(): Promise<void>;
}

let pickerFilesPending: Promise<unknown> = Promise.resolve();
let activePickerLease: { oldUris: string[] } | null = null;

function withPickerFiles<Value>(
  operation: () => Promise<Value>,
): Promise<Value> {
  const next = pickerFilesPending.catch(() => undefined).then(operation);
  pickerFilesPending = next;
  return next;
}

async function pickerTemporaryUris(): Promise<string[]> {
  const directory = `${cacheRoot()}ImagePicker/`;
  if (!(await FileSystem.getInfoAsync(directory)).exists) return [];
  // Enumerate before deleting; never recursively delete a live picker directory.
  // https://docs.expo.dev/versions/v57.0.0/sdk/filesystem-legacy/#filesystem-legacyreaddirectoryasyncfileuri
  return (await FileSystem.readDirectoryAsync(directory))
    .filter((name) => name !== "." && name !== ".." && !/[\\/]/.test(name))
    .map((name) => `${directory}${name}`);
}

async function purgePickerTemporaryFiles(): Promise<void> {
  const uris = activePickerLease?.oldUris ?? (await pickerTemporaryUris());
  await Promise.all(uris.map(removeFileIfPresent));
}

export function beginPickerTemporaryLease(): Promise<PickerTemporaryLease> {
  return withPickerFiles(async () => {
    if (activePickerLease) {
      throw new Error("Another photo selection is still being cleaned up.");
    }
    const lease = { oldUris: await pickerTemporaryUris() };
    activePickerLease = lease;
    return {
      release: () =>
        withPickerFiles(async () => {
          if (activePickerLease === lease) activePickerLease = null;
          // Repeat on a late picker return after departure to remove canceled copies.
          await purgePickerTemporaryFiles();
        }),
    };
  });
}

async function purgeDirectories(directories: string[]): Promise<void> {
  await Promise.all(
    directories.map(async (directory) => {
      const info = await FileSystem.getInfoAsync(directory);
      if (info.exists) {
        await FileSystem.deleteAsync(directory, { idempotent: true });
      }
    }),
  );
}

export async function purgeStoma3DBackgroundTemporaryFiles(): Promise<void> {
  await Promise.all([
    purgeDirectories(
      (["capture", "preview"] as const).map(stoma3DTempDirectory),
    ),
    withPickerFiles(purgePickerTemporaryFiles),
  ]);
}

export async function purgeStoma3DTemporaryFiles(): Promise<void> {
  await Promise.all([
    purgeDirectories(
      (["capture", "preview", "share"] as const).map(stoma3DTempDirectory),
    ),
    withPickerFiles(async () => {
      activePickerLease = null;
      await purgeDirectories([`${cacheRoot()}ImagePicker/`]);
    }),
  ]);
}
