import { useMemo, useState } from "react";
import {
  Image,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { Canvas, Path, Skia } from "@shopify/react-native-skia";
import type { CandidateMask } from "@stoma3d/contracts";

import { useAppTheme } from "@/theme";

interface MaskOverlayProps {
  imageUri: string | null;
  mask: CandidateMask | null;
  showMask?: boolean;
}

export function MaskOverlay({
  imageUri,
  mask,
  showMask = true,
}: MaskOverlayProps) {
  const theme = useAppTheme();
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [imageAspectRatio, setImageAspectRatio] = useState(4 / 3);
  const path = useMemo(() => {
    if (!mask || mask.polygon.length < 3) return null;
    const builder = Skia.PathBuilder.Make();
    const first = mask.polygon[0];
    if (!first) return null;
    builder.moveTo(first[0] * size.width, first[1] * size.height);
    for (const point of mask.polygon.slice(1))
      builder.lineTo(point[0] * size.width, point[1] * size.height);
    builder.close();
    return builder.build();
  }, [mask, size.height, size.width]);
  const onLayout = (event: LayoutChangeEvent) =>
    setSize(event.nativeEvent.layout);

  return (
    <View
      accessible
      accessibilityLabel={
        mask && showMask
          ? "Captured image with an approximate candidate outline."
          : "Captured image. No candidate outline available."
      }
      onLayout={onLayout}
      style={[
        styles.frame,
        { backgroundColor: theme.navy, aspectRatio: imageAspectRatio },
      ]}
    >
      {imageUri ? (
        <Image
          accessible={false}
          source={{ uri: imageUri }}
          onLoad={(event) => {
            const { width, height } = event.nativeEvent.source;
            if (width > 0 && height > 0) setImageAspectRatio(width / height);
          }}
          resizeMode="contain"
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      {!imageUri ? (
        <Text style={styles.placeholder}>
          Protected image preview unavailable
        </Text>
      ) : null}
      {path && showMask ? (
        <Canvas pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Path path={path} color="rgba(255,205,74,0.28)" style="fill" />
          <Path path={path} color="#FFCD4A" style="stroke" strokeWidth={4} />
        </Canvas>
      ) : null}
      {mask && showMask ? (
        <View style={styles.key}>
          <View style={styles.keyLine} />
          <Text style={styles.keyText}>Approximate candidate boundary</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: "100%",
    borderRadius: 22,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  placeholder: { color: "#FFFFFF", fontWeight: "700" },
  key: {
    position: "absolute",
    left: 12,
    bottom: 12,
    flexDirection: "row",
    gap: 7,
    alignItems: "center",
    backgroundColor: "rgba(7,26,43,0.78)",
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
  },
  keyLine: {
    width: 17,
    height: 3,
    borderRadius: 2,
    backgroundColor: "#FFCD4A",
  },
  keyText: { color: "#FFFFFF", fontSize: 11, fontWeight: "700" },
});
