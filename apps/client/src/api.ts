import { Platform, AppState } from "react-native";
import Constants from "expo-constants";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ChangeEvent } from "@flashback/contracts";
import { getBearer, invalidateAuth } from "./credentials";
export function apiOrigin() {
  const configured = process.env.EXPO_PUBLIC_API_URL;
  if (configured) return configured.replace(/\/$/, "");
  if (Platform.OS === "web" && typeof window !== "undefined")
    return __DEV__
      ? `${window.location.protocol}//${window.location.hostname}:4310`
      : window.location.origin;
  const host = Constants.expoConfig?.hostUri?.split(":")[0];
  return host ? `http://${host}:4310` : "";
}
export class RequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  body?: unknown,
  method?: string,
  signal?: AbortSignal,
): Promise<T> {
  const origin = apiOrigin();
  if (Platform.OS !== "web" && !origin)
    throw new Error(
      "Укажите EXPO_PUBLIC_API_URL вашего экземпляра перед сборкой приложения.",
    );
  const response = await fetch(origin + path, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: {
      "Content-Type": "application/json",
      ...(getBearer() ? { Authorization: `Bearer ${getBearer()}` } : {}),
    },
    credentials: "include",
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: signal ?? AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    if (response.status === 401 && path !== "/api/auth/session")
      invalidateAuth();
    const data = await response.json().catch(() => ({}));
    throw new RequestError(
      response.status,
      response.status === 409 && path.startsWith("/api/bugs/v1/reports/")
        ? "Баг уже изменился. Ваш текст сохранён в редакторе. Обновите версию перед повторным сохранением."
        : (data.error ?? `Ошибка ${response.status}`),
    );
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
export const base = "/api/bugs/v1";
export function useLive() {
  const client = useQueryClient();
  const [online, setOnline] = useState(false);
  useEffect(() => {
    let socket: WebSocket | undefined,
      timer: ReturnType<typeof setTimeout>,
      stopped = false;
    const refresh = () =>
      client.invalidateQueries({
        predicate: (q) =>
          ["list", "report", "commit"].includes(String(q.queryKey[0])),
      });
    async function connect() {
      if (stopped) return;
      const origin = apiOrigin();
      if (!origin) return;
      clearTimeout(timer);
      let ticket: string;
      try {
        ticket = (await api<{ ticket: string }>("/api/auth/socket-ticket", {}))
          .ticket;
      } catch {
        if (!stopped) timer = setTimeout(connect, 2000);
        return;
      }
      if (stopped) return;
      const next = new WebSocket(
        origin.replace(/^http/, "ws") +
          base +
          "/events?ticket=" +
          encodeURIComponent(ticket),
      );
      socket = next;
      next.onmessage = (e) => {
        const event = JSON.parse(e.data) as ChangeEvent;
        if (event.type === "connected") {
          setOnline(true);
          refresh();
          return;
        }
        if (event.type === "commit.changed") {
          client.invalidateQueries({ queryKey: ["commit"] });
          return;
        }
        client.invalidateQueries({ queryKey: ["list"] });
        client.invalidateQueries({ queryKey: ["report", event.id] });
        client.invalidateQueries({ queryKey: ["report-access", event.id] });
      };
      next.onclose = (event) => {
        if (next !== socket) return;
        if (event.code === 4401) {
          invalidateAuth();
          return;
        }
        setOnline(false);
        if (!stopped) timer = setTimeout(connect, 2000);
      };
      next.onerror = () => next.close();
    }
    connect();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        refresh();
        if (socket?.readyState !== 1) {
          clearTimeout(timer);
          socket?.close();
          connect();
        }
      }
    });
    const focus = () => refresh();
    if (Platform.OS === "web") {
      window.addEventListener("focus", focus);
      if (!__DEV__ && "serviceWorker" in navigator)
        navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    return () => {
      stopped = true;
      clearTimeout(timer);
      socket?.close();
      sub.remove();
      if (Platform.OS === "web") window.removeEventListener("focus", focus);
    };
  }, [client]);
  return online;
}
