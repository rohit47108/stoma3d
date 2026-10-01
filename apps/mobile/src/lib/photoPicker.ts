import type {
  ImagePickerAsset,
  ImagePickerOptions,
  ImagePickerResult,
} from "expo-image-picker";

interface SystemPhotoPicker {
  launchImageLibraryAsync: (
    options: ImagePickerOptions,
  ) => Promise<ImagePickerResult>;
}

export async function pickSelectedPhoto(
  picker: SystemPhotoPicker,
): Promise<ImagePickerAsset | null> {
  // SDK 57 uses the selected-photo system picker, not broad library access.
  // https://docs.expo.dev/versions/latest/sdk/imagepicker/#imagepickerlaunchimagelibraryasyncoptions
  const selection = await picker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsEditing: false,
    allowsMultipleSelection: false,
    exif: false,
    quality: 1,
    selectionLimit: 1,
  });
  if (selection.canceled) return null;
  const asset = selection.assets[0];
  if (!asset?.uri) {
    throw new Error("The photo library did not return an image.");
  }
  return asset;
}
