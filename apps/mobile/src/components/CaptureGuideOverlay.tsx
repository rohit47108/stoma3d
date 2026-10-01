import { Canvas, Path } from "@shopify/react-native-skia";
import { StyleSheet, Text, View } from "react-native";
import type { MouthRegion } from "@stoma3d/contracts";

import { captureGuideSpec } from "@/lib/captureGuide";

interface CaptureGuideOverlayProps {
  region: MouthRegion;
  mirrored?: boolean;
}

export function CaptureGuideOverlay({
  region,
  mirrored = false,
}: CaptureGuideOverlayProps) {
  const guide = captureGuideSpec(region);

  return (
    <View accessible={false} pointerEvents="none" style={styles.container}>
      <Canvas style={[styles.canvas, mirrored ? styles.mirrored : undefined]}>
        <Path
          path={guide.outlinePath}
          color="rgba(22,125,122,0.18)"
          style="fill"
        />
        <Path
          path={guide.outlinePath}
          color="rgba(255,255,255,0.96)"
          style="stroke"
          strokeWidth={4}
        />
      </Canvas>
      <View style={styles.cue}>
        <Text style={styles.cueText}>{guide.cue}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 280,
    height: 190,
    maxWidth: "86%",
  },
  canvas: {
    width: 280,
    height: 190,
  },
  mirrored: { transform: [{ scaleX: -1 }] },
  cue: {
    position: "absolute",
    bottom: 8,
    alignSelf: "center",
    maxWidth: 250,
    borderRadius: 10,
    backgroundColor: "rgba(7,26,33,0.76)",
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  cueText: {
    color: "#FFFFFF",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "800",
    textAlign: "center",
  },
});
