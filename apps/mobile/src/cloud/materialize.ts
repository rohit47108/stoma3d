import { fromByteArray } from "base64-js";
import * as FileSystem from "expo-file-system/legacy";

import { encryptFile, removeProtectedFile } from "@/lib/secureFiles";
import { createStoma3DTempUri, removeFileIfPresent } from "@/lib/tempFiles";
import {
  LocalWorkspaceConflictError,
  LocalWorkspaceReloadError,
  useStoma3DStore,
} from "@/store/useStoma3DStore";
import type { PersistedAppState } from "@/types";

import { downloadVerifiedAsset } from "./assetTransfer";
import { PlatformClient } from "./client";
import { syncEntityFingerprint } from "./syncModel";
import {
  readCloudResourceMappings,
  type CloudResourceMapping,
} from "./productSync";

function validCaptureMapping(
  value: CloudResourceMapping | undefined,
): value is CloudResourceMapping & {
  assetId: string;
  sha256: string;
  byteSize: number;
  mimeType: string;
  uploaded: true;
} {
  return Boolean(
    value?.kind === "capture_view" &&
    value.uploaded === true &&
    value.assetId &&
    value.sha256 &&
    value.byteSize &&
    value.mimeType,
  );
}

function assertWorkspaceGeneration(expected: number): void {
  if (useStoma3DStore.getState().getWorkspaceGeneration() !== expected) {
    throw new LocalWorkspaceConflictError();
  }
}

export async function materializeRemoteCaptures(options: {
  client: PlatformClient;
  state: PersistedAppState;
  workspaceGeneration: number;
}): Promise<{ state: PersistedAppState; downloaded: number }> {
  assertWorkspaceGeneration(options.workspaceGeneration);
  const mappings = new Map(
    (await readCloudResourceMappings()).map((value) => [value.localId, value]),
  );
  assertWorkspaceGeneration(options.workspaceGeneration);
  let downloaded = 0;
  for (const capture of options.state.captures) {
    if (capture.encryptedUri) continue;
    const mapping = mappings.get(capture.id);
    if (!validCaptureMapping(mapping)) continue;
    const ticket = await options.client.requestAssetDownload(mapping.assetId);
    assertWorkspaceGeneration(options.workspaceGeneration);
    const bytes = await downloadVerifiedAsset({
      ticket,
      expectedSha256: mapping.sha256,
      expectedByteSize: mapping.byteSize,
      expectedMimeType: mapping.mimeType,
    });
    const extension = mapping.mimeType === "image/png" ? "png" : "jpg";
    let temporary: string | null = null;
    let encryptedUri: string | null = null;
    let attached = false;
    let attachmentMayHaveCommitted = false;
    try {
      assertWorkspaceGeneration(options.workspaceGeneration);
      temporary = await createStoma3DTempUri("capture", extension);
      assertWorkspaceGeneration(options.workspaceGeneration);
      await FileSystem.writeAsStringAsync(temporary, fromByteArray(bytes), {
        encoding: FileSystem.EncodingType.Base64,
      });
      assertWorkspaceGeneration(options.workspaceGeneration);
      encryptedUri = await encryptFile(temporary, `capture:${capture.id}`);
      const committed = await useStoma3DStore
        .getState()
        .applyCloudState((latest) => {
          const current = latest.captures.find(
            (value) => value.id === capture.id,
          );
          if (
            !current ||
            current.encryptedUri ||
            syncEntityFingerprint(current) !== syncEntityFingerprint(capture)
          ) {
            return latest;
          }
          return {
            ...latest,
            captures: latest.captures.map((value) =>
              value.id === capture.id ? { ...value, encryptedUri } : value,
            ),
          };
        }, options.workspaceGeneration);
      attached = committed.captures.some(
        (value) =>
          value.id === capture.id && value.encryptedUri === encryptedUri,
      );
      assertWorkspaceGeneration(options.workspaceGeneration);
      if (attached) downloaded += 1;
    } catch (error) {
      // A successful write followed by failed readback cannot safely prove
      // whether this ciphertext is referenced. Hydration will reconcile it.
      attachmentMayHaveCommitted = error instanceof LocalWorkspaceReloadError;
      throw error;
    } finally {
      bytes.fill(0);
      const cleanup = await Promise.allSettled([
        !attached && !attachmentMayHaveCommitted && encryptedUri
          ? removeProtectedFile(encryptedUri)
          : Promise.resolve(),
        removeFileIfPresent(temporary),
      ]);
      if (cleanup.some((result) => result.status === "rejected")) {
        throw new Error(
          "The protected cloud download could not be fully cleaned up on this device.",
        );
      }
    }
  }
  // Even if every candidate was skipped, return the current queued snapshot,
  // not the earlier download plan that may predate local commits.
  const state = await useStoma3DStore
    .getState()
    .applyCloudState((latest) => latest, options.workspaceGeneration);
  assertWorkspaceGeneration(options.workspaceGeneration);
  return { state, downloaded };
}
