import React, { useState } from "react";
import { View, ScrollView, TextInput } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AccessKey, Status } from "@flashback/contracts";
import { statuses, statusLabels } from "@flashback/contracts";
import X from "lucide-react-native/icons/x";
import Copy from "lucide-react-native/icons/copy";
import KeyRound from "lucide-react-native/icons/key-round";
import { api } from "./api";
import { useAccess } from "./Auth";
import Overlay from "./Overlay";
import { c, s, T, Button, Input, Label } from "./ui";
export default function AccessKeys({ onClose }: { onClose: () => void }) {
  const { key: current } = useAccess(),
    client = useQueryClient();
  const query = useQuery({
    queryKey: ["access-keys"],
    queryFn: () => api<AccessKey[]>("/api/access-keys"),
  });
  const [name, setName] = useState(""),
    [admin, setAdmin] = useState(false),
    [allowed, setAllowed] = useState<Status[]>(
      statuses.filter((s) => s !== "fixed"),
    );
  const [secret, setSecret] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState<string | null>(null),
    [copied, setCopied] = useState(false);
  const create = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await api<{ key: AccessKey; secret: string }>(
        "/api/access-keys",
        { name, isAdmin: admin, allowedStatuses: allowed },
      );
      setSecret(r.secret);
      setName("");
      setCopied(false);
      await query.refetch();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (id: string) => {
    setBusy(true);
    setError("");
    try {
      await api("/api/access-keys/" + id + "/revoke", {});
      setConfirm(null);
      await query.refetch();
      client.invalidateQueries({ queryKey: ["instance"] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Overlay label="Ключи доступа" onClose={onClose}>
      <View style={[s.row, s.section]}>
        <KeyRound color={c.accent} size={22} />
        <T
          accessibilityRole="header"
          style={{ flex: 1, fontSize: 22, fontWeight: "600" }}
        >
          Ключи доступа
        </T>
        <Button icon={X} label="Закрыть ключи доступа" onPress={onClose} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 24, gap: 22 }}>
        <View style={{ gap: 12 }}>
          <T style={{ fontSize: 17, fontWeight: "600" }}>Новый ключ</T>
          <Label>Название — кто будет пользоваться</Label>
          <Input
            accessibilityLabel="Название ключа"
            value={name}
            onChangeText={setName}
            placeholder="Например, Codex — интерфейс"
          />
          <View style={[s.row, { flexWrap: "wrap" }]}>
            {["Агент", "Пользователь", "Администратор"].map((label, i) => (
              <Button
                key={label}
                variant={
                  (
                    i === 2
                      ? admin
                      : !admin &&
                        (i === 1 ? allowed.length === 5 : allowed.length !== 5)
                  )
                    ? "primary"
                    : "outline"
                }
                onPress={() => {
                  setAdmin(i === 2);
                  setAllowed(
                    i === 0
                      ? statuses.filter((s) => s !== "fixed")
                      : [...statuses],
                  );
                }}
              >
                {label}
              </Button>
            ))}
          </View>
          <T muted style={{ fontSize: 12 }}>
            {admin
              ? "Может управлять ключами и устанавливать любые статусы."
              : "Выберите статусы, которые этот ключ сможет устанавливать."}
          </T>
          {!admin ? (
            <View style={[s.row, { flexWrap: "wrap" }]}>
              {statuses.map((status) => (
                <Button
                  key={status}
                  label={"Разрешить статус: " + statusLabels[status]}
                  variant={allowed.includes(status) ? "primary" : "outline"}
                  onPress={() =>
                    setAllowed((a) =>
                      a.includes(status)
                        ? a.filter((x) => x !== status)
                        : [...a, status],
                    )
                  }
                >
                  {statusLabels[status]}
                </Button>
              ))}
            </View>
          ) : null}
          {!admin ? (
            <T muted style={{ fontSize: 11 }}>
              Архив и удаление доступны ключам с правом «Исправлен». Ключ без
              статусов может читать и редактировать текст, но не создавать баги
              и не менять их статус.
            </T>
          ) : null}
          <Button
            variant="primary"
            disabled={!name.trim() || busy}
            loading={busy}
            onPress={create}
          >
            Создать ключ
          </Button>
        </View>
        {secret ? (
          <View
            style={{
              gap: 12,
              padding: 16,
              backgroundColor: c.accentBg,
              borderRadius: 10,
            }}
          >
            <T style={{ fontWeight: "600" }}>Скопируйте ключ сейчас</T>
            <T muted style={{ fontSize: 12 }}>
              Повторно показать секрет нельзя. Передайте его только получателю.
            </T>
            <TextInput
              accessibilityLabel="Созданный токен"
              value={secret}
              editable={false}
              multiline
              style={{ color: c.text, fontSize: 13, fontFamily: "monospace" }}
            />
            <Button
              icon={Copy}
              onPress={async () => {
                try {
                  await Clipboard.setStringAsync(secret);
                  setCopied(true);
                } catch {
                  setError("Не удалось скопировать. Выделите ключ вручную.");
                }
              }}
            >
              {copied ? "Скопировано" : "Скопировать ключ"}
            </Button>
            <Button onPress={() => setSecret("")}>Готово, скрыть ключ</Button>
          </View>
        ) : null}
        {error || query.error ? (
          <T style={{ color: c.red }}>{error || query.error?.message}</T>
        ) : null}
        <T style={{ fontSize: 17, fontWeight: "600" }}>Выданные ключи</T>
        {query.data?.map((k) => (
          <View
            key={k.id}
            style={{
              padding: 16,
              borderWidth: 1,
              borderColor: c.line,
              borderRadius: 10,
              gap: 9,
              opacity: k.revokedAt ? 0.5 : 1,
            }}
          >
            <T style={{ fontWeight: "600" }}>
              {k.name}
              {k.id === current.id ? " · текущий" : ""}
            </T>
            <T muted style={{ fontSize: 11 }}>
              #{k.id.slice(0, 8)} ·{" "}
              {k.revokedAt
                ? "Отозван"
                : k.isAdmin
                  ? "Администратор"
                  : k.allowedStatuses.map((s) => statusLabels[s]).join(", ") ||
                    "Без смены статуса"}
            </T>
            <T muted style={{ fontSize: 11 }}>
              Создан {new Date(k.createdAt).toLocaleDateString("ru-RU")}
              {k.lastUsedAt
                ? " · Использован " +
                  new Date(k.lastUsedAt).toLocaleDateString("ru-RU")
                : ""}
            </T>
            {!k.revokedAt ? (
              confirm === k.id ? (
                <View style={{ gap: 8 }}>
                  <T>Отозвать ключ? Все его подключения завершатся.</T>
                  <View style={s.row}>
                    <Button
                      variant="danger"
                      disabled={busy}
                      onPress={() => revoke(k.id)}
                    >
                      Да, отозвать
                    </Button>
                    <Button onPress={() => setConfirm(null)}>Отмена</Button>
                  </View>
                </View>
              ) : (
                <Button
                  label={"Отозвать ключ " + k.name}
                  onPress={() => setConfirm(k.id)}
                >
                  Отозвать
                </Button>
              )
            ) : null}
          </View>
        ))}
      </ScrollView>
    </Overlay>
  );
}
