import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

import { useStoma3DStore } from "@/store/useStoma3DStore";

const light = {
  navy: "#102A43",
  teal: "#0B716C",
  aqua: "#BCEFE6",
  mint: "#DDF5EE",
  coral: "#A42E3A",
  amber: "#7A4D00",
  ink: "#17324D",
  muted: "#536A7C",
  line: "#C9D8E0",
  canvas: "#FAFAF7",
  surface: "#FFFFFF",
  white: "#FFFFFF",
  mapPending: "#DCA0A6",
  pin: "#FFD166",
  warningSurface: "#FFF4DF",
  warningOnCamera: "#FFD166",
  onCamera: "#FFFFFF",
} as const;

const dark = {
  navy: "#081F2E",
  teal: "#2D9D91",
  aqua: "#D8FFF8",
  mint: "#173E39",
  coral: "#F27983",
  amber: "#F2C66D",
  ink: "#F2FAF8",
  muted: "#B9CCCC",
  line: "#36535C",
  canvas: "#06171D",
  surface: "#0D222A",
  // Kept as a compatibility alias for existing button foreground usage.
  white: "#06171D",
  mapPending: "#E2A9AF",
  pin: "#FFD166",
  warningSurface: "#3A2A0B",
  warningOnCamera: "#FFD166",
  onCamera: "#FFFFFF",
} as const;

export function useAppTheme() {
  const settings = useStoma3DStore((state) => state.settings);
  // Keep everyday scanning in the agreed light visual system. High contrast
  // remains an explicit setting and system text scaling remains enabled.
  const colorScheme = "light" as "light" | "dark";
  const isDark = colorScheme === "dark";
  const palette = isDark ? dark : light;
  const highContrastPalette = isDark
    ? {
        ...palette,
        navy: "#000000",
        canvas: "#000000",
        surface: "#0B0B0B",
        ink: "#FFFFFF",
        muted: "#F2F2F2",
        line: "#FFFFFF",
        teal: "#49E5D3",
        aqua: "#D8FFF8",
        mint: "#143D38",
        coral: "#FF9AA2",
        amber: "#FFD166",
        warningSurface: "#241900",
        white: "#000000",
      }
    : {
        ...palette,
        canvas: "#FFFFFF",
        surface: "#FFFFFF",
        ink: "#000000",
        muted: "#111111",
        line: "#000000",
        teal: "#005F56",
        aqua: "#B9FFF3",
        mint: "#D5F4EC",
        coral: "#9D0000",
        amber: "#6B4300",
        warningSurface: "#FFF4DF",
      };
  const resolved = settings.highContrast ? highContrastPalette : palette;

  return {
    ...resolved,
    background: resolved.canvas,
    text: resolved.ink,
    secondaryText: resolved.muted,
    border: resolved.line,
    primary: resolved.teal,
    danger: resolved.coral,
    fontScale: settings.largeText ? 1.16 : 1,
    colorScheme,
    isDark,
    statusBarStyle: isDark ? ("light" as const) : ("dark" as const),
  };
}

export type AppTheme = ReturnType<typeof useAppTheme>;

export function useShouldReduceMotion(): boolean {
  const appPreference = useStoma3DStore(
    (state) => state.settings.reducedMotion,
  );
  // Start conservatively so first-paint motion never precedes the OS query.
  const [systemPreference, setSystemPreference] = useState(true);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setSystemPreference(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setSystemPreference,
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return appPreference || systemPreference;
}
