import {
  Component,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { Canvas, useFrame, useThree } from "@react-three/fiber/native";
import { Ionicons } from "@expo/vector-icons";
import { MOUTH_REGION_DETAILS, type MouthRegion } from "@stoma3d/contracts";
import type { Group } from "three";

import { ORAL_MAP_ASSET_VERSION } from "@/constants";
import {
  nextIntroRegion,
  nextIntroRotation,
} from "@/components/oralObservationIntro";
import {
  derivePinWorldPosition,
  deriveRegionWorldPosition,
  deriveScanPhonePose,
  nextScanPathRegion,
  ORAL_SCAN_PATH,
  REGION_SCALES,
  scanPathCue,
  type ObservationMapLayer,
  type ObservationMapView,
  type RegionObservationSummary,
} from "@/lib/observationMap";
import { useAppTheme, useShouldReduceMotion } from "@/theme";
import type { ObservationPin } from "@/types";

interface OralObservationMapProps {
  completedRegions: MouthRegion[];
  selectedRegion: MouthRegion | null;
  onSelectRegion: (region: MouthRegion) => void;
  pins?: ObservationPin[];
  summaries?: Record<MouthRegion, RegionObservationSummary>;
  visiblePinIds?: readonly string[];
  showRegionList?: boolean;
}

interface RegionMeshProps {
  id: MouthRegion;
  meshId: string;
  position: [number, number, number];
  scale: [number, number, number];
  color: string;
  opacity: number;
  selected: boolean;
  onSelect: (region: MouthRegion) => void;
}

interface MapRenderBoundaryProps {
  children: ReactNode;
  fallback: ReactNode;
  onError: () => void;
}

const TOOTH_POSITIONS = Array.from({ length: 11 }, (_, index) => {
  const angle = Math.PI * (0.08 + (index / 10) * 0.84);
  return {
    x: Math.cos(angle) * 0.88,
    curve: Math.sin(angle),
    rotation: (Math.PI / 2 - angle) * 0.22,
  };
});

class MapRenderBoundary extends Component<
  MapRenderBoundaryProps,
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch() {
    this.props.onError();
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function RegionMesh({
  id,
  meshId,
  position,
  scale,
  color,
  opacity,
  selected,
  onSelect,
}: RegionMeshProps) {
  return (
    <group name={meshId} position={position} scale={scale}>
      <mesh onClick={() => onSelect(id)}>
        <sphereGeometry args={[0.55, 32, 20]} />
        <meshStandardMaterial
          color={color}
          roughness={0.68}
          metalness={0.01}
          transparent
          opacity={opacity}
        />
      </mesh>
      {selected ? (
        <mesh scale={[1.045, 1.045, 1.045]}>
          <sphereGeometry args={[0.55, 24, 16]} />
          <meshBasicMaterial
            color="#FFF4C2"
            wireframe
            transparent
            opacity={0.54}
          />
        </mesh>
      ) : null}
    </group>
  );
}

function MouthAnatomySupport({
  exploded,
  showTeeth,
  translucent,
}: {
  exploded: boolean;
  showTeeth: boolean;
  translucent: boolean;
}) {
  const tissueOpacity = translucent ? 0.22 : 0.5;
  const rearTissueOpacity = translucent ? 0.11 : 0.32;
  const upperOffset = exploded ? 0.18 : 0;
  const lowerOffset = exploded ? -0.18 : 0;

  return (
    <group name="supporting-oral-anatomy">
      <mesh
        name="palate"
        position={[0, 0.24 + upperOffset, -0.48]}
        scale={[1.22, 0.7, 0.18]}
      >
        <sphereGeometry args={[0.72, 30, 18]} />
        <meshStandardMaterial
          color="#9C525F"
          roughness={0.74}
          transparent
          opacity={tissueOpacity}
          depthWrite={!translucent}
        />
      </mesh>
      <mesh
        name="floor-of-mouth"
        position={[0, -0.55 + lowerOffset, -0.4]}
        scale={[1.2, 0.48, 0.16]}
      >
        <sphereGeometry args={[0.72, 30, 18]} />
        <meshStandardMaterial
          color="#A95F68"
          roughness={0.78}
          transparent
          opacity={tissueOpacity}
          depthWrite={!translucent}
        />
      </mesh>
      <mesh
        name="posterior-oral-wall"
        position={[0, -0.02, -0.8]}
        scale={[0.86, 1.08, 0.2]}
      >
        <sphereGeometry args={[0.72, 28, 18]} />
        <meshStandardMaterial
          color="#743A48"
          roughness={0.82}
          transparent
          opacity={rearTissueOpacity}
          depthWrite={!translucent}
        />
      </mesh>
      {showTeeth
        ? TOOTH_POSITIONS.flatMap((tooth, index) => {
            const toothScale = 0.88 + tooth.curve * 0.18;
            return [
              <mesh
                key={`upper-tooth-${index}`}
                name={`upper-tooth-${index + 1}`}
                position={[
                  tooth.x,
                  0.42 + upperOffset + tooth.curve * 0.17,
                  0.22,
                ]}
                rotation={[0, 0, -tooth.rotation]}
                scale={[0.11 * toothScale, 0.17, 0.09]}
              >
                <sphereGeometry args={[1, 14, 10]} />
                <meshStandardMaterial
                  color="#F4EBDD"
                  roughness={0.38}
                  metalness={0.01}
                />
              </mesh>,
              <mesh
                key={`lower-tooth-${index}`}
                name={`lower-tooth-${index + 1}`}
                position={[
                  tooth.x,
                  -0.48 + lowerOffset - tooth.curve * 0.14,
                  0.2,
                ]}
                rotation={[0, 0, tooth.rotation]}
                scale={[0.1 * toothScale, 0.15, 0.085]}
              >
                <sphereGeometry args={[1, 14, 10]} />
                <meshStandardMaterial
                  color="#F4EBDD"
                  roughness={0.38}
                  metalness={0.01}
                />
              </mesh>,
            ];
          })
        : null}
    </group>
  );
}

function CameraRig({
  zoom,
  focusedRegion,
}: {
  zoom: number;
  focusedRegion: MouthRegion | null;
}) {
  const camera = useThree((state) => state.camera);

  useEffect(() => {
    const target = focusedRegion
      ? deriveRegionWorldPosition(focusedRegion, false)
      : ([0, 0, 0] as const);
    camera.position.set(target[0], target[1], target[2] + zoom);
    camera.lookAt(target[0], target[1], target[2]);
    camera.updateProjectionMatrix();
  }, [camera, focusedRegion, zoom]);

  return null;
}

function ScanPhoneCue({
  region,
  reducedMotion,
  frameColor,
  screenColor,
}: {
  region: MouthRegion;
  reducedMotion: boolean;
  frameColor: string;
  screenColor: string;
}) {
  const group = useRef<Group>(null);
  const initialized = useRef(false);
  const pose = useMemo(() => deriveScanPhonePose(region), [region]);

  useEffect(() => {
    if (!group.current || (initialized.current && !reducedMotion)) return;
    group.current.position.set(...pose.position);
    group.current.rotation.set(...pose.rotation);
    initialized.current = true;
  }, [pose, reducedMotion]);

  useFrame((_, delta) => {
    if (!group.current || reducedMotion || !initialized.current) return;
    const amount = 1 - Math.exp(-Math.min(delta, 0.05) * 8);
    group.current.position.x +=
      (pose.position[0] - group.current.position.x) * amount;
    group.current.position.y +=
      (pose.position[1] - group.current.position.y) * amount;
    group.current.position.z +=
      (pose.position[2] - group.current.position.z) * amount;
    group.current.rotation.x +=
      (pose.rotation[0] - group.current.rotation.x) * amount;
    group.current.rotation.y +=
      (pose.rotation[1] - group.current.rotation.y) * amount;
    group.current.rotation.z +=
      (pose.rotation[2] - group.current.rotation.z) * amount;
  });

  return (
    <group ref={group} name="scan-phone-position-cue" scale={0.72}>
      <mesh>
        <boxGeometry args={[0.64, 1.06, 0.1]} />
        <meshStandardMaterial
          color={frameColor}
          transparent
          opacity={0.58}
          roughness={0.54}
          metalness={0.04}
        />
      </mesh>
      <mesh position={[0, 0, 0.057]}>
        <planeGeometry args={[0.52, 0.82]} />
        <meshBasicMaterial color={screenColor} transparent opacity={0.34} />
      </mesh>
      <mesh position={[0, 0.41, 0.07]}>
        <circleGeometry args={[0.045, 18]} />
        <meshBasicMaterial color={screenColor} />
      </mesh>
    </group>
  );
}

const detailFor = (region: MouthRegion | null) =>
  MOUTH_REGION_DETAILS.find((detail) => detail.id === region);

const emptySummary = (region: MouthRegion): RegionObservationSummary => ({
  region,
  acceptedCaptureCount: 0,
  latestCaptureAt: null,
  averageAnalysisConfidence: null,
  confirmedPinCount: 0,
  rejectedCaptureCount: 0,
  retakeRequiredCount: 0,
  visuallyChangedPinCount: 0,
});

const confidenceCopy = (summary: RegionObservationSummary): string => {
  if (!summary.acceptedCaptureCount) return "No capture";
  if (summary.averageAnalysisConfidence === null) {
    return "Analysis confidence unavailable";
  }
  return `${Math.round(summary.averageAnalysisConfidence * 100)}% analysis confidence`;
};

function IntroMouthScene({
  selectedRegion,
  rotation,
  reducedMotion,
  regionColor,
  selectedColor,
  onSelectRegion,
}: {
  selectedRegion: MouthRegion;
  rotation: number;
  reducedMotion: boolean;
  regionColor: string;
  selectedColor: string;
  onSelectRegion: (region: MouthRegion) => void;
}) {
  const group = useRef<Group>(null);

  useEffect(() => {
    if (group.current) group.current.rotation.y = rotation;
  }, [rotation]);

  useFrame((_, delta) => {
    if (!group.current || reducedMotion) return;
    group.current.rotation.y += Math.min(delta, 0.05) * 0.16;
  });

  return (
    <group ref={group} rotation={[0.06, rotation, 0]}>
      <MouthAnatomySupport exploded={false} showTeeth translucent={false} />
      {MOUTH_REGION_DETAILS.map((detail) => (
        <RegionMesh
          key={detail.id}
          id={detail.id}
          meshId={detail.meshId}
          position={deriveRegionWorldPosition(detail.id, false)}
          scale={REGION_SCALES[detail.id]}
          color={detail.id === selectedRegion ? selectedColor : regionColor}
          opacity={detail.id === selectedRegion ? 0.98 : 0.7}
          selected={detail.id === selectedRegion}
          onSelect={onSelectRegion}
        />
      ))}
    </group>
  );
}

export function OralObservationMapIntroduction() {
  const theme = useAppTheme();
  const reducedMotion = useShouldReduceMotion();
  const [selectedRegion, setSelectedRegion] =
    useState<MouthRegion>("dorsal_tongue");
  const [rotation, setRotation] = useState(0);
  const [renderFailed, setRenderFailed] = useState(false);
  const [renderAttempt, setRenderAttempt] = useState(0);
  const selectedDetail = detailFor(selectedRegion)!;
  const regionIndex = MOUTH_REGION_DETAILS.findIndex(
    (detail) => detail.id === selectedRegion,
  );

  return (
    <View
      style={[
        styles.introContainer,
        { backgroundColor: theme.surface, borderColor: theme.border },
      ]}
    >
      <View style={styles.introHeading}>
        <View style={styles.introHeadingCopy}>
          <Text
            accessibilityRole="header"
            style={[
              styles.introTitle,
              { color: theme.text, fontSize: 18 * theme.fontScale },
            ]}
          >
            Your oral observation map
          </Text>
          <Text
            style={[
              styles.introBody,
              {
                color: theme.secondaryText,
                fontSize: 13 * theme.fontScale,
              },
            ]}
          >
            Eight named regions keep every capture and later observation in the
            same place. This is a standard map, not a scan of your anatomy.
          </Text>
        </View>
        <View
          accessible
          accessibilityLabel="Eight named regions"
          style={[styles.introCount, { backgroundColor: theme.mint }]}
        >
          <Text style={[styles.introCountNumber, { color: theme.primary }]}>
            8
          </Text>
          <Text style={[styles.introCountLabel, { color: theme.text }]}>
            regions
          </Text>
        </View>
      </View>

      <View
        style={[
          styles.introShell,
          { backgroundColor: theme.navy, borderColor: theme.border },
        ]}
      >
        <MapRenderBoundary
          key={renderAttempt}
          onError={() => setRenderFailed(true)}
          fallback={
            <View style={styles.introFallback}>
              <Ionicons
                accessible={false}
                name="cube-outline"
                size={30}
                color={theme.onCamera}
              />
              <Text
                style={[styles.introFallbackText, { color: theme.onCamera }]}
              >
                The 3D introduction is unavailable. The scan still uses the same
                eight named regions.
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Retry 3D oral observation map introduction"
                onPress={() => {
                  setRenderFailed(false);
                  setRenderAttempt((value) => value + 1);
                }}
                style={({ pressed }) => [
                  styles.introRetry,
                  { borderColor: theme.onCamera },
                  pressed && styles.controlPressed,
                ]}
              >
                <Text style={{ color: theme.onCamera, fontWeight: "800" }}>
                  Retry 3D view
                </Text>
              </Pressable>
            </View>
          }
        >
          <View
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            style={styles.canvas}
          >
            <Canvas camera={{ position: [0, 0, 4.4], fov: 46 }}>
              <ambientLight intensity={1.55} />
              <directionalLight position={[2, 3, 4]} intensity={2.25} />
              <directionalLight position={[-2, -1, 2]} intensity={0.55} />
              <IntroMouthScene
                selectedRegion={selectedRegion}
                rotation={rotation}
                reducedMotion={reducedMotion}
                regionColor={theme.aqua}
                selectedColor={theme.pin}
                onSelectRegion={setSelectedRegion}
              />
            </Canvas>
          </View>
        </MapRenderBoundary>
        {!renderFailed ? (
          <>
            <View pointerEvents="none" style={styles.introReadout}>
              <Text
                style={[styles.introReadoutStep, { color: theme.onCamera }]}
              >
                Region {regionIndex + 1} of 8
              </Text>
              <Text
                style={[styles.introReadoutTitle, { color: theme.onCamera }]}
              >
                {selectedDetail.shortLabel}
              </Text>
            </View>
            <View style={styles.introControls}>
              <MapControl
                label="Rotate introduction left"
                icon="arrow-back"
                onPress={() =>
                  setRotation((value) => nextIntroRotation(value, -1))
                }
              />
              <MapControl
                label="Show next named mouth region"
                icon="navigate-outline"
                onPress={() =>
                  setSelectedRegion((value) => nextIntroRegion(value))
                }
              />
              <MapControl
                label="Rotate introduction right"
                icon="arrow-forward"
                onPress={() =>
                  setRotation((value) => nextIntroRotation(value, 1))
                }
              />
            </View>
          </>
        ) : null}
      </View>

      <View
        accessible
        accessibilityLabel={`${selectedDetail.label}. Region ${regionIndex + 1} of 8. ${selectedDetail.captureInstruction}`}
        style={styles.introCaption}
      >
        <View
          accessible={false}
          style={[styles.introRegionNumber, { backgroundColor: theme.primary }]}
        >
          <Text style={[styles.introRegionNumberText, { color: theme.white }]}>
            {regionIndex + 1}
          </Text>
        </View>
        <View style={styles.introCaptionCopy}>
          <Text style={[styles.introCaptionTitle, { color: theme.text }]}>
            {selectedDetail.label}
          </Text>
          <Text
            style={[styles.introCaptionBody, { color: theme.secondaryText }]}
          >
            {selectedDetail.captureInstruction}
          </Text>
          <Text style={[styles.introMotionNote, { color: theme.primary }]}>
            {reducedMotion
              ? "Automatic rotation is off. Use the controls to explore."
              : "Rotates slowly. Tap a region or use the controls to explore."}
          </Text>
        </View>
      </View>
    </View>
  );
}

export function OralObservationMap({
  completedRegions,
  selectedRegion,
  onSelectRegion,
  pins = [],
  summaries,
  visiblePinIds,
  showRegionList = false,
}: OralObservationMapProps) {
  const theme = useAppTheme();
  const reduceMotion = useShouldReduceMotion();
  const { height, width } = useWindowDimensions();
  const [rotation, setRotation] = useState(0);
  const [zoom, setZoom] = useState(4.5);
  const [layer, setLayer] = useState<ObservationMapLayer>("coverage");
  const [view, setView] = useState<ObservationMapView>("whole");
  const [tissueTranslucent, setTissueTranslucent] = useState(false);
  const [showTeeth, setShowTeeth] = useState(true);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [renderUnavailable, setRenderUnavailable] = useState(false);
  const [renderAttempt, setRenderAttempt] = useState(0);
  const isWide = width >= 700;
  const compactLandscape = width > height && height < 560;
  const mapHeight = compactLandscape ? 300 : isWide ? 440 : 370;
  const exploded = view === "exploded";
  const focusedRegion = view === "focus" ? selectedRegion : null;
  const visiblePinSet = useMemo(
    () => new Set(visiblePinIds ?? pins.map((pin) => pin.id)),
    [pins, visiblePinIds],
  );
  const validPins = useMemo(
    () =>
      pins.filter((pin) => {
        const detail = detailFor(pin.region);
        return (
          pin.userConfirmed &&
          visiblePinSet.has(pin.id) &&
          pin.assetVersion === ORAL_MAP_ASSET_VERSION &&
          pin.meshId === detail?.meshId
        );
      }),
    [pins, visiblePinSet],
  );
  const pathIndex = selectedRegion
    ? ORAL_SCAN_PATH.indexOf(selectedRegion)
    : -1;
  const selectedDetail = detailFor(selectedRegion);
  const selectedCue = selectedRegion ? scanPathCue(selectedRegion) : null;

  const summaryFor = (region: MouthRegion) =>
    summaries?.[region] ?? {
      ...emptySummary(region),
      acceptedCaptureCount: completedRegions.includes(region) ? 1 : 0,
      confirmedPinCount: validPins.filter((pin) => pin.region === region)
        .length,
    };

  const colorFor = (region: MouthRegion): string => {
    const summary = summaryFor(region);
    if (layer === "coverage") {
      return summary.acceptedCaptureCount ? theme.aqua : theme.border;
    }
    if (layer === "status") {
      if (summary.visuallyChangedPinCount) return theme.danger;
      if (summary.confirmedPinCount) return theme.pin;
      if (summary.retakeRequiredCount) return theme.mapPending;
      return summary.acceptedCaptureCount ? theme.aqua : theme.border;
    }
    if (!summary.acceptedCaptureCount) return theme.border;
    const confidence = summary.averageAnalysisConfidence;
    if (confidence === null) return theme.onCamera;
    if (confidence >= 0.8) return theme.aqua;
    if (confidence >= 0.6) return theme.warningOnCamera;
    return theme.mapPending;
  };

  const opacityFor = (region: MouthRegion): number => {
    const tissueFactor = tissueTranslucent ? 0.46 : 1;
    if (view === "focus") {
      return (selectedRegion === region ? 0.98 : 0.09) * tissueFactor;
    }
    if (view === "path") {
      if (selectedRegion === region) return 0.98 * tissueFactor;
      return (completedRegions.includes(region) ? 0.48 : 0.2) * tissueFactor;
    }
    return 0.92 * tissueFactor;
  };

  const selectView = (nextView: ObservationMapView) => {
    if ((nextView === "focus" || nextView === "path") && !selectedRegion) {
      onSelectRegion(nextScanPathRegion(completedRegions, null, 1));
    }
    setView(nextView);
  };

  const stepPath = (direction: -1 | 1) => {
    onSelectRegion(
      nextScanPathRegion(completedRegions, selectedRegion, direction),
    );
  };

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.surfaceHeader,
          { backgroundColor: theme.surface, borderColor: theme.border },
        ]}
      >
        <View style={styles.surfaceHeaderCopy}>
          <Text
            accessibilityRole="header"
            style={[
              styles.surfaceTitle,
              { color: theme.text, fontSize: 17 * theme.fontScale },
            ]}
          >
            Oral observation map
          </Text>
          <Text
            style={[
              styles.surfaceBody,
              {
                color: theme.secondaryText,
                fontSize: 12 * theme.fontScale,
              },
            ]}
          >
            Eight regions, with your saved photos and confirmed observations.
          </Text>
        </View>
        <View
          accessible
          accessibilityLabel={`${completedRegions.length} of 8 regions covered. ${validPins.length} confirmed observation pins.`}
          style={[styles.coverageBadge, { backgroundColor: theme.mint }]}
        >
          <Text style={[styles.coverageNumber, { color: theme.primary }]}>
            {completedRegions.length}/8
          </Text>
          <Text style={[styles.coverageLabel, { color: theme.text }]}>
            covered
          </Text>
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          optionsOpen ? "Hide map options" : "More map options"
        }
        accessibilityState={{ expanded: optionsOpen }}
        onPress={() => setOptionsOpen((value) => !value)}
        style={styles.mapOptionsToggle}
      >
        <Text style={[styles.toolbarLabel, { color: theme.primary }]}>
          {optionsOpen ? "Hide map options" : "More map options"}
        </Text>
      </Pressable>
      {optionsOpen ? (
        <>
          <View style={styles.toolbarGroup}>
            <Text style={[styles.toolbarLabel, { color: theme.secondaryText }]}>
              View
            </Text>
            <View accessibilityRole="tablist" style={styles.segmentRow}>
              <SegmentButton
                label="Whole"
                icon="cube-outline"
                selected={view === "whole"}
                onPress={() => selectView("whole")}
              />
              <SegmentButton
                label="Exploded"
                icon="expand-outline"
                selected={view === "exploded"}
                onPress={() => selectView("exploded")}
              />
              <SegmentButton
                label="Focus"
                icon="locate-outline"
                selected={view === "focus"}
                onPress={() => selectView("focus")}
              />
              <SegmentButton
                label="Scan path"
                icon="navigate-outline"
                selected={view === "path"}
                onPress={() => selectView("path")}
              />
            </View>
          </View>

          <View style={styles.toolbarGroup}>
            <Text style={[styles.toolbarLabel, { color: theme.secondaryText }]}>
              Map layer
            </Text>
            <View accessibilityRole="tablist" style={styles.layerRow}>
              <LayerButton
                label="Capture coverage"
                selected={layer === "coverage"}
                onPress={() => setLayer("coverage")}
              />
              <LayerButton
                label="Scan status"
                selected={layer === "status"}
                onPress={() => setLayer("status")}
              />
              <LayerButton
                label="Analysis confidence"
                selected={layer === "confidence"}
                onPress={() => setLayer("confidence")}
              />
            </View>
          </View>

          <View style={styles.toolbarGroup}>
            <Text style={[styles.toolbarLabel, { color: theme.secondaryText }]}>
              Anatomy display
            </Text>
            <View style={styles.displayRow}>
              <DisplayToggle
                label="See through tissue"
                icon="layers-outline"
                checked={tissueTranslucent}
                onPress={() => setTissueTranslucent((value) => !value)}
              />
              <DisplayToggle
                label="Show teeth"
                icon="eye-outline"
                checked={showTeeth}
                onPress={() => setShowTeeth((value) => !value)}
              />
            </View>
          </View>
        </>
      ) : null}
      <View
        accessible={false}
        style={[
          styles.shell,
          {
            height: mapHeight,
            backgroundColor: theme.navy,
            borderColor: theme.border,
          },
        ]}
      >
        <MapRenderBoundary
          key={renderAttempt}
          onError={() => setRenderUnavailable(true)}
          fallback={
            <View accessible={false} style={styles.renderFallback}>
              <View
                accessible
                accessibilityRole="alert"
                accessibilityLabel="3D map unavailable. Use the named region list below or retry the 3D view."
                style={styles.renderFallbackCopy}
              >
                <Ionicons
                  accessible={false}
                  name="cube-outline"
                  size={32}
                  color={theme.onCamera}
                />
                <Text
                  style={[
                    styles.renderFallbackTitle,
                    { color: theme.onCamera },
                  ]}
                >
                  3D view unavailable
                </Text>
                <Text
                  style={[styles.renderFallbackBody, { color: theme.onCamera }]}
                >
                  The named region list has the same selections and observation
                  details.
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Retry 3D view"
                onPress={() => {
                  setRenderUnavailable(false);
                  setRenderAttempt((value) => value + 1);
                }}
                style={({ pressed }) => [
                  styles.renderRetry,
                  { borderColor: theme.onCamera },
                  pressed && styles.renderRetryPressed,
                ]}
              >
                <Ionicons
                  accessible={false}
                  name="refresh"
                  size={18}
                  color={theme.onCamera}
                />
                <Text
                  style={[styles.renderRetryText, { color: theme.onCamera }]}
                >
                  Retry 3D view
                </Text>
              </Pressable>
            </View>
          }
        >
          <View
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            style={styles.canvas}
          >
            <Canvas camera={{ position: [0, 0, zoom], fov: 46 }}>
              <CameraRig
                zoom={focusedRegion ? 2.9 : zoom}
                focusedRegion={focusedRegion}
              />
              <ambientLight intensity={1.55} />
              <directionalLight position={[2, 3, 4]} intensity={2.25} />
              <directionalLight position={[-2, -1, 2]} intensity={0.55} />
              <group rotation={[0.06, rotation, 0]}>
                <MouthAnatomySupport
                  exploded={exploded}
                  showTeeth={showTeeth}
                  translucent={tissueTranslucent}
                />
                {MOUTH_REGION_DETAILS.map((detail) => (
                  <RegionMesh
                    key={detail.id}
                    id={detail.id}
                    meshId={detail.meshId}
                    position={deriveRegionWorldPosition(detail.id, exploded)}
                    scale={REGION_SCALES[detail.id]}
                    color={colorFor(detail.id)}
                    opacity={opacityFor(detail.id)}
                    selected={selectedRegion === detail.id}
                    onSelect={onSelectRegion}
                  />
                ))}
                {validPins.map((pin) => (
                  <mesh
                    key={pin.id}
                    name={`pin-${pin.id}`}
                    position={derivePinWorldPosition(pin, exploded)}
                    scale={selectedRegion === pin.region ? 1.2 : 1}
                    onClick={() => onSelectRegion(pin.region)}
                  >
                    <sphereGeometry args={[0.105, 18, 18]} />
                    <meshStandardMaterial
                      color={theme.pin}
                      emissive={theme.amber}
                      emissiveIntensity={0.32}
                    />
                  </mesh>
                ))}
                {view === "path" && selectedRegion ? (
                  <ScanPhoneCue
                    region={selectedRegion}
                    reducedMotion={reduceMotion}
                    frameColor={theme.onCamera}
                    screenColor={theme.pin}
                  />
                ) : null}
              </group>
            </Canvas>
          </View>
        </MapRenderBoundary>
        {!renderUnavailable ? (
          <>
            <View pointerEvents="none" style={styles.mapReadout}>
              <Text style={[styles.mapReadoutLabel, { color: theme.onCamera }]}>
                {view === "path" && pathIndex >= 0
                  ? `Step ${pathIndex + 1} of 8`
                  : layer === "confidence"
                    ? "Analysis confidence"
                    : layer === "status"
                      ? "Personal scan status"
                      : "Capture coverage"}
              </Text>
              <Text style={[styles.mapReadoutTitle, { color: theme.onCamera }]}>
                {selectedDetail?.shortLabel ?? "All named regions"}
              </Text>
            </View>
            <View pointerEvents="box-none" style={styles.legend}>
              {layer === "coverage" ? (
                <>
                  <LegendItem color={theme.aqua} label="Captured" />
                  <LegendItem color={theme.border} label="Not captured" />
                </>
              ) : layer === "status" ? (
                <>
                  <LegendItem color={theme.danger} label="Visually changed" />
                  <LegendItem color={theme.pin} label="Confirmed area" />
                  <LegendItem color={theme.mapPending} label="Needs retake" />
                  <LegendItem color={theme.aqua} label="Captured" />
                  <LegendItem color={theme.border} label="Not captured" />
                </>
              ) : (
                <>
                  <LegendItem color={theme.aqua} label="High" />
                  <LegendItem color={theme.onCamera} label="Unavailable" />
                  <LegendItem color={theme.warningOnCamera} label="Moderate" />
                  <LegendItem color={theme.mapPending} label="Lower" />
                </>
              )}
            </View>
            <View style={styles.controls}>
              <MapControl
                label="Rotate left"
                icon="arrow-back"
                onPress={() => setRotation((value) => value - 0.35)}
              />
              <MapControl
                label="Rotate right"
                icon="arrow-forward"
                onPress={() => setRotation((value) => value + 0.35)}
              />
              <MapControl
                label="Zoom in"
                icon="add"
                onPress={() => setZoom((value) => Math.max(3.4, value - 0.4))}
              />
              <MapControl
                label="Zoom out"
                icon="remove"
                onPress={() => setZoom((value) => Math.min(6, value + 0.4))}
              />
            </View>
          </>
        ) : null}
      </View>

      {view === "path" ? (
        <View
          style={[
            styles.pathPanel,
            { backgroundColor: theme.surface, borderColor: theme.border },
          ]}
        >
          <MapControlLight
            label="Previous region"
            icon="chevron-back"
            onPress={() => stepPath(-1)}
          />
          <View style={styles.pathCopy}>
            <Text style={[styles.pathTitle, { color: theme.text }]}>
              {pathIndex >= 0
                ? `${pathIndex + 1}. ${selectedDetail?.label}`
                : "Choose a region"}
            </Text>
            <Text style={[styles.pathMeta, { color: theme.secondaryText }]}>
              {selectedRegion && completedRegions.includes(selectedRegion)
                ? "Captured · revisit or continue"
                : "Still needed for a complete scan"}
            </Text>
            {selectedCue ? (
              <>
                <Text style={[styles.pathInstruction, { color: theme.text }]}>
                  {selectedCue.phonePosition}
                </Text>
                <Text
                  style={[
                    styles.pathInstruction,
                    { color: theme.secondaryText },
                  ]}
                >
                  {selectedCue.tissuePosition}
                </Text>
                <Text style={[styles.pathEquipment, { color: theme.primary }]}>
                  {selectedCue.camera}
                  {selectedCue.helperRecommended ? " · Helper recommended" : ""}
                </Text>
              </>
            ) : null}
            <View accessible={false} style={styles.pathTicks}>
              {ORAL_SCAN_PATH.map((region, index) => (
                <View
                  key={region}
                  style={[
                    styles.pathTick,
                    {
                      backgroundColor:
                        selectedRegion === region
                          ? theme.pin
                          : completedRegions.includes(region)
                            ? theme.primary
                            : theme.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.pathTickText,
                      {
                        color:
                          selectedRegion === region
                            ? theme.navy
                            : theme.surface,
                      },
                    ]}
                  >
                    {completedRegions.includes(region) ? "✓" : index + 1}
                  </Text>
                </View>
              ))}
            </View>
          </View>
          <MapControlLight
            label="Next region"
            icon="chevron-forward"
            onPress={() => stepPath(1)}
          />
        </View>
      ) : null}

      {showRegionList ? (
        <View
          style={[
            styles.regionSection,
            { backgroundColor: theme.surface, borderColor: theme.border },
          ]}
        >
          <Text
            accessibilityRole="header"
            style={[styles.regionSectionTitle, { color: theme.text }]}
          >
            Named regions
          </Text>
          <Text
            style={[styles.regionSectionHint, { color: theme.secondaryText }]}
          >
            This list mirrors the 3D map for screen readers and when 3D
            rendering is unavailable.
          </Text>
          <View style={styles.regionGrid}>
            {MOUTH_REGION_DETAILS.map((detail, index) => {
              const selected = selectedRegion === detail.id;
              const summary = summaryFor(detail.id);
              const accepted = summary.acceptedCaptureCount > 0;
              const pinCount = summary.confirmedPinCount;
              const stateDetails = [
                accepted
                  ? `${summary.acceptedCaptureCount} accepted`
                  : "Not captured",
                confidenceCopy(summary),
                `${pinCount} confirmed pin${pinCount === 1 ? "" : "s"}`,
                ...(summary.retakeRequiredCount
                  ? [`${summary.retakeRequiredCount} needs retake`]
                  : []),
                ...(summary.visuallyChangedPinCount
                  ? [`${summary.visuallyChangedPinCount} visually changed`]
                  : []),
              ];
              const stateCopy = stateDetails.join(" · ");
              return (
                <Pressable
                  key={detail.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${index + 1}. ${detail.label}. ${stateCopy}`}
                  accessibilityState={{ selected }}
                  onPress={() => onSelectRegion(detail.id)}
                  style={({ pressed }) => [
                    styles.regionOption,
                    isWide && styles.regionOptionWide,
                    {
                      backgroundColor: selected ? theme.mint : theme.background,
                      borderColor: selected ? theme.primary : theme.border,
                    },
                    pressed && styles.regionOptionPressed,
                  ]}
                >
                  <View
                    style={[
                      styles.regionNumber,
                      {
                        backgroundColor: accepted
                          ? theme.primary
                          : theme.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.regionNumberText,
                        { color: accepted ? theme.white : theme.text },
                      ]}
                    >
                      {accepted ? "✓" : index + 1}
                    </Text>
                  </View>
                  <View style={styles.regionOptionCopy}>
                    <Text
                      style={[styles.regionOptionTitle, { color: theme.text }]}
                    >
                      {detail.label}
                    </Text>
                    <Text
                      style={[
                        styles.regionOptionMeta,
                        { color: theme.secondaryText },
                      ]}
                    >
                      {stateCopy}
                    </Text>
                  </View>
                  <Ionicons
                    accessible={false}
                    name={selected ? "location" : "chevron-forward"}
                    color={selected ? theme.primary : theme.secondaryText}
                    size={19}
                  />
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function DisplayToggle({
  label,
  icon,
  checked,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  checked: boolean;
  onPress: () => void;
}) {
  const theme = useAppTheme();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.displayToggle,
        {
          backgroundColor: checked ? theme.mint : theme.surface,
          borderColor: checked ? theme.primary : theme.border,
        },
        pressed && styles.controlPressed,
      ]}
    >
      <Ionicons
        accessible={false}
        name={icon}
        size={17}
        color={checked ? theme.primary : theme.secondaryText}
      />
      <Text style={[styles.displayToggleText, { color: theme.text }]}>
        {label}
      </Text>
      <View
        accessible={false}
        style={[
          styles.displaySwitchTrack,
          { backgroundColor: checked ? theme.primary : theme.border },
        ]}
      >
        <View
          style={[
            styles.displaySwitchThumb,
            {
              backgroundColor: theme.surface,
              transform: [{ translateX: checked ? 14 : 0 }],
            },
          ]}
        />
      </View>
    </Pressable>
  );
}

function SegmentButton({
  label,
  icon,
  selected,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useAppTheme();
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.segmentButton,
        {
          backgroundColor: selected ? theme.primary : theme.surface,
          borderColor: selected ? theme.primary : theme.border,
        },
        pressed && styles.controlPressed,
      ]}
    >
      <Ionicons
        name={icon}
        size={17}
        color={selected ? theme.white : theme.text}
      />
      <Text
        style={[
          styles.segmentText,
          { color: selected ? theme.white : theme.text },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function LayerButton({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useAppTheme();
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.layerButton,
        {
          backgroundColor: selected ? theme.mint : theme.surface,
          borderColor: selected ? theme.primary : theme.border,
        },
        pressed && styles.controlPressed,
      ]}
    >
      <View
        style={[
          styles.layerMarker,
          { backgroundColor: selected ? theme.primary : theme.border },
        ]}
      />
      <Text style={[styles.layerText, { color: theme.text }]}>{label}</Text>
    </Pressable>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  const theme = useAppTheme();
  return (
    <View style={styles.legendRow}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.legendText, { color: theme.onCamera }]}>
        {label}
      </Text>
    </View>
  );
}

function MapControl({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}) {
  const theme = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Adjusts the visual oral observation map"
      hitSlop={4}
      style={({ pressed }) => [
        styles.control,
        {
          borderColor: "rgba(255,255,255,0.5)",
          backgroundColor: "rgba(7,26,43,0.88)",
        },
        pressed && styles.controlPressed,
      ]}
      onPress={onPress}
    >
      <Ionicons
        accessible={false}
        name={icon}
        size={20}
        color={theme.onCamera}
      />
    </Pressable>
  );
}

function MapControlLight({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}) {
  const theme = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.lightControl,
        { borderColor: theme.border },
        pressed && styles.controlPressed,
      ]}
    >
      <Ionicons name={icon} size={21} color={theme.primary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  mapOptionsToggle: { minHeight: 48, justifyContent: "center" },
  container: { gap: 12 },
  introContainer: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 14,
    gap: 12,
    shadowColor: "#102A43",
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  introHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  introHeadingCopy: { flex: 1, gap: 4 },
  introTitle: { fontWeight: "900" },
  introBody: { lineHeight: 19 },
  introCount: {
    minWidth: 62,
    minHeight: 58,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 9,
  },
  introCountNumber: {
    fontSize: 21,
    lineHeight: 24,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
  },
  introCountLabel: { fontSize: 10, fontWeight: "800" },
  introShell: {
    height: 310,
    borderWidth: 1,
    borderRadius: 17,
    overflow: "hidden",
  },
  introReadout: {
    position: "absolute",
    top: 12,
    left: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "rgba(7,26,43,0.88)",
    borderRadius: 11,
  },
  introReadoutStep: { fontSize: 10, lineHeight: 13, fontWeight: "700" },
  introReadoutTitle: { fontSize: 14, lineHeight: 18, fontWeight: "900" },
  introControls: {
    position: "absolute",
    right: 12,
    bottom: 12,
    left: 12,
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
  },
  introFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 24,
  },
  introFallbackText: { maxWidth: 330, textAlign: "center", lineHeight: 19 },
  introRetry: {
    minHeight: 48,
    paddingHorizontal: 17,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: 14,
  },
  introCaption: { flexDirection: "row", alignItems: "center", gap: 11 },
  introRegionNumber: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  introRegionNumberText: {
    fontSize: 13,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
  },
  introCaptionCopy: { flex: 1, gap: 2 },
  introCaptionTitle: { fontSize: 14, fontWeight: "900" },
  introCaptionBody: { fontSize: 12, lineHeight: 17 },
  introMotionNote: {
    marginTop: 2,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "800",
  },
  surfaceHeader: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 15,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  surfaceHeaderCopy: { flex: 1, gap: 3 },
  surfaceTitle: { fontWeight: "800" },
  surfaceBody: { lineHeight: 18 },
  coverageBadge: {
    minWidth: 64,
    minHeight: 60,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  coverageNumber: {
    fontSize: 20,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  coverageLabel: { fontSize: 10, fontWeight: "700" },
  toolbarGroup: { gap: 6 },
  toolbarLabel: { fontSize: 11, fontWeight: "700" },
  segmentRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  segmentButton: {
    minHeight: 48,
    flexGrow: 1,
    minWidth: 104,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 11,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  segmentText: { fontSize: 12, fontWeight: "800" },
  layerRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  layerButton: {
    flex: 1,
    minWidth: 100,
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  layerMarker: { width: 8, height: 8, borderRadius: 4 },
  layerText: { fontSize: 12, fontWeight: "800", flexShrink: 1 },
  displayRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  displayToggle: {
    flex: 1,
    minWidth: 150,
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  displayToggleText: { flex: 1, fontSize: 12, fontWeight: "800" },
  displaySwitchTrack: {
    width: 34,
    height: 20,
    borderRadius: 10,
    padding: 3,
    justifyContent: "center",
  },
  displaySwitchThumb: { width: 14, height: 14, borderRadius: 7 },
  shell: { borderRadius: 20, overflow: "hidden", borderWidth: 1 },
  canvas: { flex: 1 },
  renderFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
    gap: 18,
  },
  renderFallbackCopy: { alignItems: "center", gap: 8 },
  renderFallbackTitle: { fontSize: 18, fontWeight: "800", textAlign: "center" },
  renderFallbackBody: {
    maxWidth: 340,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
    opacity: 0.86,
  },
  renderRetry: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  renderRetryPressed: { opacity: 0.76, transform: [{ scale: 0.98 }] },
  renderRetryText: { fontSize: 14, fontWeight: "800" },
  mapReadout: {
    position: "absolute",
    top: 14,
    left: 14,
    maxWidth: "52%",
    backgroundColor: "rgba(7,26,43,0.88)",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  mapReadoutLabel: { fontSize: 10, fontWeight: "700", opacity: 0.82 },
  mapReadoutTitle: { fontSize: 14, fontWeight: "800" },
  legend: {
    position: "absolute",
    top: 14,
    right: 14,
    gap: 5,
    backgroundColor: "rgba(7,26,43,0.88)",
    padding: 9,
    borderRadius: 12,
  },
  legendRow: { flexDirection: "row", gap: 6, alignItems: "center" },
  legendText: { fontSize: 10, fontWeight: "700" },
  dot: { width: 8, height: 8, borderRadius: 4 },
  controls: {
    position: "absolute",
    bottom: 12,
    left: 12,
    right: 12,
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
  },
  control: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  controlPressed: { opacity: 0.78, transform: [{ scale: 0.97 }] },
  pathPanel: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  lightControl: {
    width: 48,
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  pathCopy: { flex: 1, gap: 2 },
  pathTitle: { fontSize: 14, fontWeight: "800", textAlign: "center" },
  pathMeta: { fontSize: 11, lineHeight: 15, textAlign: "center" },
  pathInstruction: { fontSize: 11, lineHeight: 15, textAlign: "center" },
  pathEquipment: {
    marginTop: 2,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "800",
    textAlign: "center",
  },
  pathTicks: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 4,
    marginTop: 7,
  },
  pathTick: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  pathTickText: { fontSize: 9, fontWeight: "800" },
  regionSection: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 8 },
  regionSectionTitle: { fontSize: 17, fontWeight: "800" },
  regionSectionHint: { fontSize: 13, lineHeight: 19 },
  regionGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  regionOption: {
    width: "100%",
    minHeight: 64,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 11,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  regionOptionWide: { width: "48.5%", flexGrow: 1 },
  regionOptionPressed: { opacity: 0.8, transform: [{ scale: 0.99 }] },
  regionNumber: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  regionNumberText: { fontSize: 11, fontWeight: "800" },
  regionOptionCopy: { flex: 1, gap: 2 },
  regionOptionTitle: { fontSize: 14, fontWeight: "800" },
  regionOptionMeta: { fontSize: 11, lineHeight: 16 },
});
