import React, { useState } from "react";
import {
  View,
  Image,
  Pressable,
  Platform,
  useWindowDimensions,
} from "react-native";
import * as Picker from "expo-image-picker";
import type { Report, Attachment } from "@flashback/contracts";
import { apiOrigin, base, projectHeaders } from "./api";
import { getBearer } from "./credentials";
import { s, c, T, Button, Label } from "./ui";
import Overlay from "./Overlay";
export type ImageInput = {
  filename: string;
  contentType: string;
  dataBase64: string;
};
async function pick(): Promise<ImageInput | null> {
  const result = await Picker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    base64: true,
    quality: 0.85,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  let data = asset.base64;
  if (!data && Platform.OS === "web") {
    const blob = asset.file ?? (await (await fetch(asset.uri)).blob());
    data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.readAsDataURL(blob);
    });
  }
  if (!data)
    throw new Error("Не удалось прочитать фото. Выберите PNG или JPEG.");
  if (data.length > 5592408)
    throw new Error("Фото больше 4 МБ. Выберите изображение поменьше.");
  const png = data.startsWith("iVBOR"),
    jpeg = data.startsWith("/9j/");
  if (!png && !jpeg) throw new Error("Поддерживаются PNG и JPEG.");
  return {
    filename: asset.fileName ?? (png ? "screenshot.png" : "screenshot.jpg"),
    contentType: png ? "image/png" : "image/jpeg",
    dataBase64: data,
  };
}
export function ImageDrafts({
  images,
  onChange,
}: {
  images: ImageInput[];
  onChange: (images: ImageInput[]) => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <View style={{ gap: 12 }}>
      <Label>Скриншоты</Label>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        {images.map((image, i) => (
          <View key={i} style={{ gap: 4 }}>
            <Image
              accessibilityLabel={"Скриншот " + (i + 1)}
              source={{
                uri: `data:${image.contentType};base64,${image.dataBase64}`,
              }}
              style={{ width: 180, height: 110 }}
              resizeMode="contain"
            />
            <Button onPress={() => onChange(images.filter((_, n) => n !== i))}>
              Убрать
            </Button>
          </View>
        ))}
      </View>
      <Button
        disabled={busy || images.length >= 4}
        onPress={async () => {
          setBusy(true);
          setError("");
          try {
            const image = await pick();
            if (image) onChange([...images, image]);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Прикрепить скриншот
      </Button>
      {!!error && (
        <T accessibilityRole="alert" style={{ color: c.red }}>
          {error}
        </T>
      )}
    </View>
  );
}
export default function Attachments({
  report,
  onUpdated,
}: {
  report: Report;
  onUpdated: (r: Report) => void;
}) {
  const [selected, setSelected] = useState<Attachment | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const screen = useWindowDimensions();
  const source = (a: Attachment) => ({
    uri: apiOrigin() + a.url,
    headers: getBearer()
      ? { Authorization: "Bearer " + getBearer() }
      : undefined,
  });
  return (
    <View style={[s.section, { gap: 12 }]}>
      <Label>Скриншоты · {report.attachments?.length ?? 0}</Label>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        {report.attachments?.map((image) => (
          <Pressable
            key={image.id}
            accessibilityRole="button"
            accessibilityLabel={"Открыть " + image.filename}
            onPress={() => setSelected(image)}
          >
            <Image
              source={source(image)}
              style={{ width: 220, height: 135, backgroundColor: c.bg }}
              resizeMode="contain"
            />
            <T
              style={{ fontSize: 11, color: c.muted, maxWidth: 220 }}
              numberOfLines={1}
            >
              {image.filename}
            </T>
          </Pressable>
        ))}
      </View>
      <Button
        disabled={busy || (report.attachments?.length ?? 0) >= 8}
        onPress={async () => {
          setError("");
          setBusy(true);
          try {
            const image = await pick();
            if (!image) return;
            const bytes = Uint8Array.from(atob(image.dataBase64), (c) =>
              c.charCodeAt(0),
            );
            const response = await fetch(
              apiOrigin() +
                base +
                "/reports/" +
                report.id +
                "/attachments?filename=" +
                encodeURIComponent(image.filename) +
                "&expectedRevision=" +
                report.revision,
              {
                method: "POST",
                credentials: "include",
                headers: {
                  "Content-Type": image.contentType,
                  ...projectHeaders(),
                  ...(getBearer()
                    ? { Authorization: "Bearer " + getBearer() }
                    : {}),
                },
                body: bytes,
              },
            );
            const data = await response.json();
            if (!response.ok)
              throw new Error(data.error ?? "Не удалось прикрепить фото.");
            onUpdated(data);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Прикрепить скриншот
      </Button>
      {!!error && (
        <T accessibilityRole="alert" style={{ color: c.red }}>
          {error}
        </T>
      )}
      {selected && (
        <Overlay label="Скриншот бага" center onClose={() => setSelected(null)}>
          <View style={{ padding: 16, gap: 12 }}>
            <View style={s.row}>
              <T style={s.grow}>{selected.filename}</T>
              <Button onPress={() => setSelected(null)}>Закрыть</Button>
            </View>
            <Image
              source={source(selected)}
              style={{
                width: Math.min(screen.width - 64, 1100),
                height: Math.min(screen.height - 150, 700),
              }}
              resizeMode="contain"
            />
            <T selectable style={{ fontSize: 11, color: c.muted }}>
              Скриншот из отчёта ·{" "}
              {Math.max(1, Math.round(selected.size / 1024))} КБ
            </T>
          </View>
        </Overlay>
      )}
    </View>
  );
}
