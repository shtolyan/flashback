import React, { createContext, useContext, useEffect, useState } from "react";
import { View, TextInput, Platform, ActivityIndicator } from "react-native";
import * as SecureStore from "expo-secure-store";
import { useQueryClient } from "@tanstack/react-query";
import KeyRound from "lucide-react-native/icons/key-round";
import Layers from "lucide-react-native/icons/layers";
import type { AccessKey, Status } from "@flashback/contracts";
import { api, apiOrigin, RequestError } from "./api";
import { authInvalidated, authCleared, setBearer } from "./credentials";
import { c, s, T, Button } from "./ui";
const Context = createContext<{
  key: AccessKey;
  logout: () => Promise<void>;
  canStatus: (status: Status) => boolean;
}>(null!);
export const useAccess = () => useContext(Context);
export function AuthGate({ children }: React.PropsWithChildren) {
  const [key, setKey] = useState<AccessKey | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [token, setToken] = useState(""),
    [busy, setBusy] = useState(false);
  const client = useQueryClient();
  const storageKey = () =>
    "flashback." + apiOrigin().replace(/[^a-zA-Z0-9._-]/g, "_");
  const clear = () => {
    setKey(null);
    setToken("");
    client.clear();
    for (const fn of authCleared) fn();
  };
  const restore = async () => {
    setLoading(true);
    setError("");
    try {
      if (
        Platform.OS === "web" &&
        localStorage.getItem("flashback.signedout") === "true"
      )
        return;
      if (Platform.OS !== "web")
        setBearer(await SecureStore.getItemAsync(storageKey()));
      setKey(await api<AccessKey>("/api/auth/me"));
    } catch (e) {
      if (!(e instanceof RequestError && e.status === 401))
        setError("Нет соединения с трекером. Повторите подключение.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    const invalid = () => {
      clear();
      setBearer(null);
      if (Platform.OS !== "web") void SecureStore.deleteItemAsync(storageKey());
    };
    authInvalidated.add(invalid);
    void restore();
    return () => {
      authInvalidated.delete(invalid);
    };
  }, []);
  const login = async () => {
    if (!token.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      let result: AccessKey;
      if (Platform.OS === "web")
        result = await api<AccessKey>("/api/auth/session", {
          token: token.trim(),
        });
      else {
        setBearer(token.trim());
        result = await api<AccessKey>("/api/auth/me");
        await SecureStore.setItemAsync(storageKey(), token.trim());
      }
      if (Platform.OS === "web") localStorage.removeItem("flashback.signedout");
      client.clear();
      setToken("");
      setKey(result);
    } catch (e) {
      setBearer(null);
      setError(e instanceof Error ? e.message : "Не удалось войти.");
    } finally {
      setBusy(false);
    }
  };
  const logout = async () => {
    // Remember local sign-out even if the server is temporarily unreachable.
    if (Platform.OS === "web")
      localStorage.setItem("flashback.signedout", "true");
    try {
      await api("/api/auth/logout", {});
    } catch {
      // The local lock survives reload; a retained server session still expires normally.
    } finally {
      setBearer(null);
      if (Platform.OS !== "web")
        await SecureStore.deleteItemAsync(storageKey());
      clear();
    }
  };
  if (loading)
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: c.bg,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ActivityIndicator color={c.accent} />
      </View>
    );
  if (key)
    return (
      <Context.Provider
        value={{
          key,
          logout,
          canStatus: (status) =>
            key.isAdmin || key.allowedStatuses.includes(status),
        }}
      >
        {children}
      </Context.Provider>
    );
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: c.bg,
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <View style={{ width: "100%", maxWidth: 400, gap: 20 }}>
        <View style={s.row}>
          <Layers color={c.accent} size={30} />
          <T style={{ fontSize: 28, fontWeight: "700" }}>flashback</T>
        </View>
        <View style={{ gap: 8 }}>
          <T
            accessibilityRole="header"
            style={{ fontSize: 24, fontWeight: "600" }}
          >
            Вход по ключу
          </T>
          <T muted>Введите ключ доступа к этому трекеру.</T>
        </View>
        <View
          style={[
            s.row,
            {
              backgroundColor: c.surface,
              borderWidth: 1,
              borderColor: c.line,
              borderRadius: 10,
              paddingHorizontal: 14,
            },
          ]}
        >
          <KeyRound size={18} color={c.muted} />
          <TextInput
            accessibilityLabel="Ключ доступа"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            value={token}
            onChangeText={setToken}
            onSubmitEditing={login}
            placeholder="Вставьте токен"
            placeholderTextColor={c.dim}
            style={{
              flex: 1,
              minWidth: 0,
              height: 48,
              color: c.text,
              fontSize: 14,
            }}
          />
        </View>
        {error ? <T style={{ color: c.red }}>{error}</T> : null}
        <Button
          variant="primary"
          onPress={login}
          loading={busy}
          disabled={!token.trim()}
        >
          Войти
        </Button>
        {error.startsWith("Нет соединения") ? (
          <Button onPress={restore}>Повторить подключение</Button>
        ) : null}
        <T muted style={{ fontSize: 12 }}>
          Вход сохранится на этом устройстве. Запросите ключ у администратора.
        </T>
      </View>
    </View>
  );
}
