import React from "react";
import { Modal, KeyboardAvoidingView, Platform, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { c } from "./ui";
export type OverlayProps = React.PropsWithChildren<{
  onClose: () => void;
  label: string;
  center?: boolean;
  backgroundColor?: string;
}>;
export default function Overlay({
  children,
  onClose,
  backgroundColor = c.surface,
}: OverlayProps) {
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaProvider>
        <SafeAreaView style={{ flex: 1, backgroundColor }}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={{ flex: 1 }}
          >
            <View style={{ flex: 1 }}>{children}</View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}
