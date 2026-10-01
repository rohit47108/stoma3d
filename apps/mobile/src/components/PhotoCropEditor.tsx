import { useMemo, useRef, useState } from "react";
import { Image, PanResponder, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Ui";
import {
  cropToPixels,
  moveCrop,
  resizeCrop,
  type NormalizedCrop,
} from "@/lib/cropGeometry";
import { useAppTheme } from "@/theme";

export function PhotoCropEditor({
  uri,
  width,
  height,
  busy,
  onCrop,
  onCancel,
}: {
  uri: string;
  width: number;
  height: number;
  busy: boolean;
  onCrop: (rect: ReturnType<typeof cropToPixels>) => void;
  onCancel: () => void;
}) {
  const theme = useAppTheme();
  const [crop, setCrop] = useState<NormalizedCrop>({
    x: 0.15,
    y: 0.35,
    width: 0.7,
    height: 0.3,
  });
  const cropRef = useRef(crop);
  cropRef.current = crop;
  const bounds = useRef({ width: 1, height: 1 });
  const dragStart = useRef(crop);
  const gesture = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !busy,
        onMoveShouldSetPanResponder: () => !busy,
        onPanResponderGrant: () => {
          dragStart.current = cropRef.current;
        },
        onPanResponderMove: (_, state) => {
          if (state.numberActiveTouches > 1) return;
          setCrop(
            moveCrop(
              dragStart.current,
              state.dx / bounds.current.width,
              state.dy / bounds.current.height,
            ),
          );
        },
      }),
    [busy],
  );
  return (
    <View style={styles.editor}>
      <Text style={[styles.instruction, { color: theme.text }]}>
        Move the box around the mouth area.
      </Text>
      <View
        style={[
          styles.photo,
          { aspectRatio: width / height, backgroundColor: theme.navy },
        ]}
        onLayout={(event) => {
          bounds.current = event.nativeEvent.layout;
        }}
      >
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          resizeMode="contain"
          accessible={false}
        />
        <View
          {...gesture.panHandlers}
          accessibilityLabel="Crop area. Use the movement buttons to adjust."
          style={[
            styles.crop,
            {
              left: `${crop.x * 100}%`,
              top: `${crop.y * 100}%`,
              width: `${crop.width * 100}%`,
              height: `${crop.height * 100}%`,
            },
          ]}
        />
      </View>
      <View style={styles.row}>
        <Button
          label="Smaller"
          variant="secondary"
          disabled={busy}
          onPress={() => setCrop(resizeCrop(crop, 0.85))}
          style={styles.flex}
        />
        <Button
          label="Larger"
          variant="secondary"
          disabled={busy}
          onPress={() => setCrop(resizeCrop(crop, 1.15))}
          style={styles.flex}
        />
      </View>
      <View style={styles.row}>
        {(
          [
            { label: "Left", dx: -0.05, dy: 0 },
            { label: "Up", dx: 0, dy: -0.05 },
            { label: "Down", dx: 0, dy: 0.05 },
            { label: "Right", dx: 0.05, dy: 0 },
          ] as const
        ).map((move) => (
          <Button
            key={move.label}
            label={move.label}
            variant="ghost"
            disabled={busy}
            onPress={() => setCrop(moveCrop(crop, move.dx, move.dy))}
            style={styles.flex}
          />
        ))}
      </View>
      <Button
        label="Apply crop"
        loading={busy}
        loadingLabel="Checking crop..."
        onPress={() => onCrop(cropToPixels(crop, width, height))}
      />
      <Button
        label="Cancel crop"
        variant="ghost"
        disabled={busy}
        onPress={onCancel}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  editor: { gap: 12 },
  instruction: { fontSize: 15, lineHeight: 22 },
  photo: { width: "100%", overflow: "hidden", borderRadius: 12 },
  crop: {
    position: "absolute",
    borderWidth: 3,
    borderColor: "#FFFFFF",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  row: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  flex: { flexGrow: 1, minWidth: 64 },
});
