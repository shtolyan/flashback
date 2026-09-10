import React from "react";
import { Modal, KeyboardAvoidingView, Platform, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { c } from "./ui";
export type OverlayProps = React.PropsWithChildren<{
  onClose: () => void;
  label: string;
  center?: boolean;
}>;
export default function Overlay({ children, onClose }: OverlayProps) {
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: c.surface }}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{ flex: 1 }}
        >
          <View style={{ flex: 1 }}>{children}</View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
