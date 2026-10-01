import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { ImagePickerAsset } from "expo-image-picker";

const selectedPhoto: ImagePickerAsset = {
  uri: "file:///cache/selected-photo.jpg",
  width: 1200,
  height: 900,
  type: "image",
  assetId: null,
  fileName: null,
};

describe("system selected-photo picker", () => {
  it("does not require broad library permission in the capture upload path", () => {
    const captureRoute = readFileSync(
      new URL("../app/capture/[region].tsx", import.meta.url),
      "utf8",
    );
    const choosePhoto = captureRoute
      .split("const choosePhoto = async () => {")[1]
      ?.split("const retake = async () => {")[0];
    expect(choosePhoto).toBeDefined();
    expect(choosePhoto).not.toContain("requestMediaLibraryPermissionsAsync");
  });

  it("accepts a selected photo without requesting full or limited library access", async () => {
    const { pickSelectedPhoto } = await import("../src/lib/photoPicker");
    const picker = {
      launchImageLibraryAsync: vi.fn(async () => ({
        canceled: false as const,
        assets: [selectedPhoto],
      })),
      requestMediaLibraryPermissionsAsync: vi.fn(async () => ({
        granted: false,
        canAskAgain: false,
        accessPrivileges: "none",
      })),
    };

    expect(await pickSelectedPhoto(picker)).toEqual(selectedPhoto);
    expect(picker.requestMediaLibraryPermissionsAsync).not.toHaveBeenCalled();
    expect(picker.launchImageLibraryAsync).toHaveBeenCalledWith({
      mediaTypes: ["images"],
      allowsEditing: false,
      allowsMultipleSelection: false,
      exif: false,
      quality: 1,
      selectionLimit: 1,
    });
  });

  it("keeps cancellation separate from picker failure", async () => {
    const { pickSelectedPhoto } = await import("../src/lib/photoPicker");

    expect(
      await pickSelectedPhoto({
        launchImageLibraryAsync: async () => ({ canceled: true, assets: null }),
      }),
    ).toBeNull();
    await expect(
      pickSelectedPhoto({
        launchImageLibraryAsync: async () => {
          throw new Error("The system photo picker is unavailable.");
        },
      }),
    ).rejects.toThrow("The system photo picker is unavailable");
  });

  it("rejects a result without a readable selected asset", async () => {
    const { pickSelectedPhoto } = await import("../src/lib/photoPicker");

    await expect(
      pickSelectedPhoto({
        launchImageLibraryAsync: async () => ({ canceled: false, assets: [] }),
      }),
    ).rejects.toThrow("The photo library did not return an image");
  });
});
