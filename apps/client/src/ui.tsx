import React from "react";
import {
  Pressable,
  Text,
  TextInput,
  View,
  StyleSheet,
  ActivityIndicator,
  type TextInputProps,
  type ViewStyle,
  type StyleProp,
} from "react-native";
import Circle from "lucide-react-native/icons/circle";
import LoaderCircle from "lucide-react-native/icons/loader-circle";
import FlaskConical from "lucide-react-native/icons/flask-conical";
import CheckCircle2 from "lucide-react-native/icons/circle-check";
import RotateCcw from "lucide-react-native/icons/rotate-ccw";
import type { LucideIcon } from "lucide-react-native";
import { statusLabels, type Status } from "@flashback/contracts";
export const c = {
  bg: "#111216",
  sidebar: "#0d0e12",
  surface: "#191a21",
  hover: "#23242e",
  line: "#2a2b35",
  text: "#f0f0f5",
  muted: "#989aa9",
  dim: "#6f7284",
  accent: "#b2a2ff",
  accentBg: "#2c2643",
  green: "#78cfab",
  red: "#ee929f",
};
export const colors: Record<Status, string> = {
  created: "#a5adc2",
  in_progress: "#d4ae65",
  ready_for_test: "#b2a2ff",
  fixed: "#78cfab",
  rework: "#ee929f",
};
export const statusIcons: Record<Status, LucideIcon> = {
  created: Circle,
  in_progress: LoaderCircle,
  ready_for_test: FlaskConical,
  fixed: CheckCircle2,
  rework: RotateCcw,
};
export function T({
  children,
  style,
  muted = false,
  ...props
}: React.ComponentProps<typeof Text> & { muted?: boolean }) {
  return (
    <Text
      {...props}
      style={[
        { color: muted ? c.muted : c.text, fontSize: 14, lineHeight: 21 },
        style,
      ]}
    >
      {children}
    </Text>
  );
}
export function Button({
  children,
  onPress,
  icon: Icon,
  variant = "ghost",
  disabled = false,
  loading = false,
  label,
  style,
  testID,
}: React.PropsWithChildren<{
  onPress: () => void;
  icon?: LucideIcon;
  variant?: "ghost" | "primary" | "outline" | "danger";
  disabled?: boolean;
  loading?: boolean;
  label?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}>) {
  const primary = variant === "primary";
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={
        label ?? (typeof children === "string" ? children : undefined)
      }
      accessibilityState={{ disabled: disabled || loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed, hovered }: any) => [
        s.button,
        variant === "outline" && { borderWidth: 1, borderColor: c.line },
        primary && { backgroundColor: c.accent },
        variant === "danger" && { backgroundColor: "#3a2129" },
        (hovered || pressed) && {
          backgroundColor: primary ? "#c4b7ff" : c.hover,
        },
        (disabled || loading) && { opacity: 0.45 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={primary ? c.bg : c.accent} />
      ) : Icon ? (
        <Icon
          size={16}
          strokeWidth={1.8}
          color={primary ? c.bg : variant === "danger" ? c.red : c.muted}
        />
      ) : null}
      {children ? (
        <T
          style={{
            fontSize: 13,
            fontWeight: "600",
            color: primary ? c.bg : variant === "danger" ? c.red : c.text,
          }}
        >
          {children}
        </T>
      ) : null}
    </Pressable>
  );
}
export function Badge({
  status,
  compact = false,
}: {
  status: Status;
  compact?: boolean;
}) {
  const Icon = statusIcons[status] ?? Circle;
  const color = colors[status] ?? c.muted;
  return (
    <View
      style={[
        s.row,
        {
          gap: 6,
          backgroundColor: color + "12",
          paddingHorizontal: compact ? 0 : 9,
          paddingVertical: 4,
          borderRadius: 6,
        },
        compact && { backgroundColor: "transparent" },
      ]}
    >
      <Icon size={14} color={color} />
      <T style={{ fontSize: 12, color }}>{statusLabels[status] ?? status}</T>
    </View>
  );
}
export function Input(props: TextInputProps) {
  return (
    <TextInput
      placeholderTextColor={c.dim}
      selectionColor={c.accent}
      {...props}
      style={[
        s.input,
        props.multiline && { textAlignVertical: "top", minHeight: 120 },
        props.style,
      ]}
    />
  );
}
export function Label({ children }: React.PropsWithChildren) {
  return (
    <T
      style={{
        fontSize: 11,
        fontWeight: "600",
        letterSpacing: 1,
        color: c.dim,
        marginBottom: 10,
      }}
    >
      {children}
    </T>
  );
}
export const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  button: {
    minHeight: 38,
    minWidth: 38,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: 9,
    padding: 12,
    color: c.text,
    fontSize: 14,
    backgroundColor: c.bg,
    lineHeight: 22,
  },
  line: { height: 1, backgroundColor: c.line },
  card: {
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: 12,
  },
  grow: { flex: 1, minWidth: 0 },
  mono: { fontFamily: "monospace", fontSize: 12 },
  section: { padding: 24, borderBottomWidth: 1, borderBottomColor: c.line },
});
