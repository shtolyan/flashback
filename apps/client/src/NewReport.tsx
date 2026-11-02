import React, { useState } from "react";
import { View, ScrollView } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import X from "lucide-react-native/icons/x";
import Plus from "lucide-react-native/icons/plus";
import ArrowUpRight from "lucide-react-native/icons/arrow-up-right";
import type { Report } from "@flashback/contracts";
import { api, base, apiProject } from "./api";
import { c, s, T, Button, Input, Label } from "./ui";
import Overlay from "./Overlay";
import { ImageDrafts, type ImageInput } from "./Attachments";
import { authCleared } from "./credentials";
const drafts = new Map<
  string,
  { text: string; context: string; reportedInVersion: string }
>();
const pictureDrafts = new Map<string, ImageInput[]>();
authCleared.add(() => {
  drafts.clear();
  pictureDrafts.clear();
});
export default function NewReport({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (r: Report) => void;
}) {
  const project = apiProject();
  const [values, setValues] = useState(
    drafts.get(project) ?? { text: "", context: "", reportedInVersion: "" },
  );
  const [pictures, setPictures] = useState(pictureDrafts.get(project) ?? []);
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: () =>
      api<Report>(base + "/reports", { ...values, attachments: pictures }),
    onSuccess: (r) => {
      drafts.delete(project);
      pictureDrafts.delete(project);
      client.invalidateQueries({ queryKey: ["list"] });
      client.setQueryData(["report", r.id], r);
      onCreated(r);
    },
  });
  const change = (key: keyof typeof values, value: string) =>
    setValues((v) => {
      const next = { ...v, [key]: value };
      drafts.set(project, next);
      return next;
    });
  return (
    <Overlay
      label="Новый баг"
      center
      onClose={() => {
        if (!mutation.isPending) onClose();
      }}
    >
      <View style={[s.row, s.section]}>
        <View style={s.grow}>
          <T style={{ fontSize: 21, fontWeight: "600" }}>Новый баг</T>
          <T muted style={{ fontSize: 12, marginTop: 3 }}>
            Что пошло не так?
          </T>
        </View>
        <Button
          icon={X}
          label="Закрыть создание"
          disabled={mutation.isPending}
          onPress={onClose}
        />
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 24, gap: 20 }}
      >
        <View>
          <Label>ОПИСАНИЕ</Label>
          <Input
            autoFocus
            accessibilityLabel="Описание нового бага"
            multiline
            value={values.text}
            onChangeText={(v) => change("text", v)}
            placeholder="Что произошло и как это повторить?"
            style={{ minHeight: 170 }}
          />
        </View>
        <View>
          <Label>КОНТЕКСТ · НЕОБЯЗАТЕЛЬНО</Label>
          <Input
            accessibilityLabel="Контекст"
            value={values.context}
            onChangeText={(v) => change("context", v)}
            placeholder="seed=… tick=… npc=…"
          />
        </View>
        <View>
          <Label>ВЕРСИЯ СБОРКИ · НЕОБЯЗАТЕЛЬНО</Label>
          <Input
            accessibilityLabel="Версия сборки"
            value={values.reportedInVersion}
            onChangeText={(v) => change("reportedInVersion", v)}
            placeholder="Например, 0.1.105"
          />
        </View>
        <ImageDrafts
          images={pictures}
          onChange={(next) => {
            pictureDrafts.set(project, next);
            setPictures(next);
          }}
        />
        {mutation.error && (
          <T accessibilityRole="alert" style={{ color: c.red }}>
            {mutation.error.message}
          </T>
        )}
      </ScrollView>
      <View
        style={[
          s.row,
          s.section,
          { borderBottomWidth: 0, borderTopWidth: 1, borderTopColor: c.line },
        ]}
      >
        <T style={[s.grow, { fontSize: 11, color: c.dim }]}>
          Черновик сохраняется при закрытии
        </T>
        <Button disabled={mutation.isPending} onPress={onClose}>
          Отмена
        </Button>
        <Button
          variant="primary"
          icon={Plus}
          disabled={!values.text.trim()}
          loading={mutation.isPending}
          onPress={() => mutation.mutate()}
        >
          Создать баг
        </Button>
      </View>
    </Overlay>
  );
}
