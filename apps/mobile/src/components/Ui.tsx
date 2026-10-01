import type { PropsWithChildren, ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
  type AccessibilityRole,
  type PressableProps,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useAppTheme } from "@/theme";

interface ButtonProps extends Omit<PressableProps, "children"> {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  loading?: boolean;
  loadingLabel?: string;
}

export function Button({
  label,
  icon,
  variant = "primary",
  loading = false,
  loadingLabel = "Working...",
  disabled,
  style,
  ...props
}: ButtonProps) {
  const theme = useAppTheme();
  const background =
    variant === "primary"
      ? theme.primary
      : variant === "danger"
        ? theme.danger
        : variant === "secondary"
          ? theme.mint
          : "transparent";
  const color =
    variant === "primary" || variant === "danger" ? theme.white : theme.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel ?? label}
      accessibilityState={{
        disabled: Boolean(disabled || loading),
        busy: loading,
      }}
      disabled={disabled || loading}
      style={(pressableState) => [
        styles.button,
        {
          backgroundColor: background,
          borderColor: variant === "ghost" ? theme.border : background,
        },
        pressableState.pressed && styles.pressed,
        (disabled || loading) && styles.disabled,
        typeof style === "function" ? style(pressableState) : style,
      ]}
      {...props}
    >
      {icon ? <Ionicons name={icon} size={19} color={color} /> : null}
      <Text
        style={[styles.buttonLabel, { color, fontSize: 15 * theme.fontScale }]}
      >
        {loading ? loadingLabel : label}
      </Text>
    </Pressable>
  );
}

interface CardProps extends PropsWithChildren {
  accent?: "teal" | "amber" | "coral";
  accessibilityLabel?: string;
}

export function Card({ children, accent, accessibilityLabel }: CardProps) {
  const theme = useAppTheme();
  const accentColor =
    accent === "amber"
      ? theme.amber
      : accent === "coral"
        ? theme.coral
        : theme.primary;
  return (
    <View
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.card,
        {
          backgroundColor: theme.surface,
          borderColor: accent ? accentColor : theme.border,
          borderWidth: accent ? 1.5 : 1,
        },
      ]}
    >
      {children}
    </View>
  );
}

interface SectionTitleProps {
  title: string;
  subtitle?: string;
  icon?: keyof typeof Ionicons.glyphMap;
}

export function SectionTitle({ title, subtitle, icon }: SectionTitleProps) {
  const theme = useAppTheme();
  return (
    <View style={styles.sectionTitle}>
      {icon ? <Ionicons name={icon} color={theme.primary} size={21} /> : null}
      <View style={styles.sectionCopy}>
        <Text
          accessibilityRole="header"
          style={[
            styles.sectionHeading,
            { color: theme.text, fontSize: 18 * theme.fontScale },
          ]}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            style={[
              styles.body,
              { color: theme.secondaryText, fontSize: 13 * theme.fontScale },
            ]}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

interface ToggleRowProps {
  label: string;
  description?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}

export function ToggleRow({
  label,
  description,
  value,
  onValueChange,
  disabled = false,
}: ToggleRowProps) {
  const theme = useAppTheme();
  return (
    <View
      style={[
        styles.toggleRow,
        { borderBottomColor: theme.border },
        disabled && styles.disabled,
      ]}
    >
      <View style={styles.toggleCopy}>
        <Text
          style={[
            styles.toggleLabel,
            { color: theme.text, fontSize: 15 * theme.fontScale },
          ]}
        >
          {label}
        </Text>
        {description ? (
          <Text
            style={[
              styles.body,
              { color: theme.secondaryText, fontSize: 12 * theme.fontScale },
            ]}
          >
            {description}
          </Text>
        ) : null}
      </View>
      <Switch
        accessibilityLabel={label}
        accessibilityState={{ disabled, checked: value }}
        disabled={disabled}
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: theme.line, true: theme.aqua }}
        thumbColor={value ? theme.primary : theme.surface}
      />
    </View>
  );
}

interface ChoiceChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  accessibilityRole?: AccessibilityRole;
  disabled?: boolean;
  fullWidth?: boolean;
}

export function ChoiceChip({
  label,
  selected,
  onPress,
  accessibilityRole = "button",
  disabled = false,
  fullWidth = false,
}: ChoiceChipProps) {
  const theme = useAppTheme();
  return (
    <Pressable
      accessibilityRole={accessibilityRole}
      accessibilityLabel={label}
      accessibilityState={{
        selected,
        checked:
          accessibilityRole === "checkbox" || accessibilityRole === "radio"
            ? selected
            : undefined,
        disabled,
      }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        fullWidth && styles.chipFullWidth,
        {
          borderColor: selected ? theme.primary : theme.border,
          backgroundColor: selected ? theme.mint : theme.surface,
        },
        pressed && styles.chipPressed,
        disabled && styles.chipDisabled,
      ]}
    >
      {selected ? (
        <Ionicons name="checkmark-circle" color={theme.primary} size={17} />
      ) : null}
      <Text
        style={[
          styles.chipText,
          { color: theme.text, fontSize: 13 * theme.fontScale },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

interface MetricBarProps {
  label: string;
  value: number;
  hint?: string;
}

export function MetricBar({ label, value, hint }: MetricBarProps) {
  const theme = useAppTheme();
  const percent = Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${percent} percent${hint ? `. ${hint}` : ""}`}
      style={styles.metric}
    >
      <View style={styles.metricHeading}>
        <Text style={[styles.metricLabel, { color: theme.text }]}>{label}</Text>
        <Text style={[styles.metricValue, { color: theme.primary }]}>
          {percent}%
        </Text>
      </View>
      <View style={[styles.track, { backgroundColor: theme.line }]}>
        <View
          style={[
            styles.fill,
            { backgroundColor: theme.primary, width: `${percent}%` },
          ]}
        />
      </View>
      {hint ? (
        <Text style={[styles.hint, { color: theme.secondaryText }]}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

interface EmptyStateProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, body, action }: EmptyStateProps) {
  const theme = useAppTheme();
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: theme.mint }]}>
        <Ionicons name={icon} size={30} color={theme.primary} />
      </View>
      <Text
        style={[
          styles.emptyTitle,
          { color: theme.text, fontSize: 19 * theme.fontScale },
        ]}
      >
        {title}
      </Text>
      <Text
        style={[
          styles.emptyBody,
          { color: theme.secondaryText, fontSize: 14 * theme.fontScale },
        ]}
      >
        {body}
      </Text>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 50,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 9,
  },
  buttonLabel: { fontWeight: "700", textAlign: "center" },
  pressed: { opacity: 0.84, transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.45 },
  card: {
    borderRadius: 16,
    padding: 17,
    gap: 12,
  },
  sectionTitle: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  sectionCopy: { flex: 1, gap: 2 },
  sectionHeading: { fontWeight: "700" },
  body: { lineHeight: 19 },
  toggleRow: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  toggleCopy: { flex: 1, gap: 3 },
  toggleLabel: { fontWeight: "700" },
  chip: {
    minHeight: 48,
    maxWidth: "100%",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  chipFullWidth: {
    width: "100%",
    alignSelf: "stretch",
    borderRadius: 12,
  },
  chipPressed: { opacity: 0.82, transform: [{ scale: 0.98 }] },
  chipDisabled: { opacity: 0.42 },
  chipText: { flexShrink: 1, fontWeight: "700" },
  metric: { gap: 6 },
  metricHeading: { flexDirection: "row", justifyContent: "space-between" },
  metricLabel: { fontSize: 13, fontWeight: "700" },
  metricValue: {
    fontSize: 13,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  track: { height: 7, borderRadius: 999, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 999 },
  hint: { fontSize: 11, lineHeight: 15 },
  empty: { alignItems: "center", gap: 10, padding: 28 },
  emptyIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: { fontWeight: "800", textAlign: "center" },
  emptyBody: { textAlign: "center", lineHeight: 21 },
});
