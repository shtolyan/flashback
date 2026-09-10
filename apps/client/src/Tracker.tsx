import React, { useEffect, useRef, useState } from "react";
import {
  View,
  ScrollView,
  Pressable,
  ActivityIndicator,
  useWindowDimensions,
  Platform,
  TextInput,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import Archive from "lucide-react-native/icons/archive";
import Inbox from "lucide-react-native/icons/inbox";
import CheckCheck from "lucide-react-native/icons/check-check";
import Plus from "lucide-react-native/icons/plus";
import Search from "lucide-react-native/icons/search";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import Menu from "lucide-react-native/icons/menu";
import PanelLeftClose from "lucide-react-native/icons/panel-left-close";
import MessageSquare from "lucide-react-native/icons/message-square";
import GitCommitHorizontal from "lucide-react-native/icons/git-commit-horizontal";
import ArrowUpRight from "lucide-react-native/icons/arrow-up-right";
import Command from "lucide-react-native/icons/command";
import Radio from "lucide-react-native/icons/radio";
import RefreshCw from "lucide-react-native/icons/refresh-cw";
import X from "lucide-react-native/icons/x";
import FlaskConical from "lucide-react-native/icons/flask-conical";
import ArrowDown from "lucide-react-native/icons/arrow-down";
import ArrowLeft from "lucide-react-native/icons/arrow-left";
import Layers from "lucide-react-native/icons/layers";
import KeyRound from "lucide-react-native/icons/key-round";
import LogOut from "lucide-react-native/icons/log-out";
import { useAccess } from "./Auth";
import AccessKeys from "./AccessKeys";
import type {
  Page,
  View as ViewName,
  Status,
  ReportSummary,
} from "@flashback/contracts";
import { statusLabels } from "@flashback/contracts";
import { api, base, useLive } from "./api";
import { useLocation } from "./navigation";
import { c, s, T, Button, Badge, colors, statusIcons } from "./ui";
import Detail from "./Detail";
import NewReport from "./NewReport";
import Overlay from "./Overlay";

let returnPosition: { key: string; y: number } | null = null;
const headings: Record<ViewName, string> = {
  open: "Открытые баги",
  fixed: "Исправленные",
  archive: "Архив",
};
export default function Tracker() {
  const { key: accessKey, logout, canStatus } = useAccess();
  const [accessOpen, setAccessOpen] = useState(false);
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(false);
  const mobile = !mounted || width < 820;
  const { location, set, close } = useLocation();
  const online = useLive();
  const [collapsed, setCollapsed] = useState(false),
    [menu, setMenu] = useState(false),
    [creating, setCreating] = useState(false),
    [toast, setToast] = useState("");
  useEffect(() => {
    if (Platform.OS === "web") {
      try {
        setCollapsed(
          localStorage.getItem("flashback.sidebar.collapsed") === "true",
        );
      } catch {}
    }
    setMounted(true);
  }, []);
  function toggleMenu() {
    if (mobile) {
      setMenu(true);
      return;
    }
    const next = !collapsed;
    setCollapsed(next);
    if (Platform.OS === "web") {
      try {
        localStorage.setItem("flashback.sidebar.collapsed", String(next));
      } catch {}
    }
  }
  const [search, setSearch] = useState(location.q);
  const searchRef = useRef<TextInput>(null);
  const scroll = useRef<ScrollView>(null);
  const lastSelected = useRef<number | null>(null);
  const scrollY = useRef(0);
  useEffect(() => setSearch(location.q), [location.q]);
  useEffect(() => {
    if (search === location.q) return;
    const timer = setTimeout(() => set({ q: search, page: 1 }), 180);
    return () => clearTimeout(timer);
  }, [search, location.q]);
  const params = new URLSearchParams({
    view: location.view,
    status: location.status,
    q: location.q,
    page: String(location.page),
  }).toString();
  const query = useQuery({
    queryKey: ["list", params],
    queryFn: ({ signal }) =>
      api<Page>(base + "/query?" + params, undefined, undefined, signal),
    placeholderData: keepPreviousData,
    refetchInterval: online ? false : 10000,
  });
  const instance = useQuery({
    queryKey: ["instance"],
    queryFn: () => api<{ name: string }>("/api/instance"),
  });
  const data = query.data;
  useEffect(() => {
    if (
      data &&
      !location.bug &&
      returnPosition?.key === params &&
      !query.isPlaceholderData
    ) {
      const pos = returnPosition;
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (scroll.current) {
            scroll.current.scrollTo({ y: pos.y, animated: false });
            returnPosition = null;
          }
        }),
      );
    }
  }, [location.bug, params, query.isPlaceholderData, !!data]);
  useEffect(() => {
    if (data && !query.isPlaceholderData && data.page !== location.page)
      set({ page: data.page });
  }, [data?.page, query.isPlaceholderData, location.page]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        location.bug ||
        creating ||
        ["INPUT", "TEXTAREA"].includes(target.tagName) ||
        target.isContentEditable
      )
        return;
      if (
        event.key === "/" ||
        (event.key === "k" && (event.metaKey || event.ctrlKey))
      ) {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "n") {
        event.preventDefault();
        setCreating(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [location.bug, creating]);
  function choose(view: ViewName) {
    set({ view, status: "", page: 1, bug: null });
    setMenu(false);
    scroll.current?.scrollTo({ y: 0, animated: false });
  }
  function page(n: number) {
    set({ page: n });
    scroll.current?.scrollTo({ y: 0, animated: false });
  }
  function open(r: ReportSummary) {
    const node =
      Platform.OS === "web" ? scroll.current?.getScrollableNode() : null;
    returnPosition = { key: params, y: node?.scrollTop ?? scrollY.current };
    lastSelected.current = r.id;
    set({ bug: r.id }, true);
  }
  const sidebar = (drawer = false) => (
    <View
      testID="sidebar"
      style={{
        width: drawer ? undefined : 234,
        flexGrow: drawer ? 1 : undefined,
        flexShrink: 0,
        backgroundColor: c.sidebar,
        padding: 18,
        borderRightWidth: 1,
        borderRightColor: c.line,
      }}
    >
      <View style={[s.row, { height: 45, marginBottom: 30 }]}>
        <View
          style={{
            backgroundColor: c.accent,
            width: 32,
            height: 32,
            borderRadius: 10,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Layers size={20} color={c.bg} />
        </View>
        <T style={{ fontSize: 21, fontWeight: "700", letterSpacing: -0.7 }}>
          flashback<T style={{ color: c.accent }}>＊</T>
        </T>
        {drawer && (
          <Button
            label="Закрыть меню"
            icon={X}
            onPress={() => setMenu(false)}
          />
        )}
      </View>
      <View
        style={[
          s.row,
          {
            padding: 11,
            borderWidth: 1,
            borderColor: c.line,
            borderRadius: 9,
            marginBottom: 30,
          },
        ]}
      >
        <View
          style={{
            width: 28,
            height: 28,
            borderRadius: 7,
            backgroundColor: "#28352f",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <T style={{ color: c.green, fontWeight: "700" }}>
            {(instance.data?.name ?? "F")[0].toUpperCase()}
          </T>
        </View>
        <View>
          <T style={{ fontSize: 13, fontWeight: "600" }}>
            {instance.data?.name ?? "Flashback"}
          </T>
          <T style={{ fontSize: 10, color: c.dim }}>БАГ-ТРЕКЕР</T>
        </View>
        <View style={s.grow} />
        <View
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: c.green,
          }}
        />
      </View>
      <T
        style={{
          fontSize: 10,
          letterSpacing: 1.5,
          color: c.dim,
          marginLeft: 10,
          marginBottom: 12,
        }}
      >
        РАБОЧЕЕ ПРОСТРАНСТВО
      </T>
      {(["open", "fixed", "archive"] as ViewName[]).map((view) => {
        const active = location.view === view,
          Icon =
            view === "open" ? Inbox : view === "fixed" ? CheckCheck : Archive;
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={headings[view]}
            key={view}
            onPress={() => choose(view)}
            style={({ hovered }: any) => [
              s.row,
              {
                paddingHorizontal: 12,
                paddingVertical: 12,
                borderRadius: 8,
                marginBottom: 4,
                backgroundColor: active
                  ? c.accentBg
                  : hovered
                    ? c.hover
                    : "transparent",
              },
            ]}
          >
            <Icon size={17} color={active ? c.accent : c.muted} />
            <T
              style={[
                s.grow,
                {
                  fontSize: 13,
                  color: active ? c.accent : c.muted,
                  fontWeight: active ? "600" : "400",
                },
              ]}
            >
              {view === "open" ? "Открытые" : headings[view]}
            </T>
            <T style={{ fontSize: 11, color: active ? c.accent : c.dim }}>
              {data?.counts[view] ?? "—"}
            </T>
          </Pressable>
        );
      })}
      <View style={{ marginTop: 20, gap: 8 }}>
        {accessKey.isAdmin && (
          <Button
            icon={KeyRound}
            onPress={() => {
              setMenu(false);
              setAccessOpen(true);
            }}
          >
            Ключи доступа
          </Button>
        )}
        <T style={{ fontSize: 11, color: c.dim }}>{accessKey.name}</T>
        <Button
          icon={LogOut}
          onPress={() => {
            void logout().catch(() => {});
          }}
        >
          Выйти
        </Button>
      </View>
      <View style={{ flex: 1, minHeight: 36 }} />
      <View
        style={{
          padding: 12,
          borderRadius: 10,
          backgroundColor: "#17161f",
          borderWidth: 1,
          borderColor: "#292536",
          marginBottom: 18,
        }}
      >
        <FlaskConical size={18} color={c.accent} />
        <T style={{ fontSize: 12, fontWeight: "600", marginTop: 8 }}>
          Меньше багов.{"\n"}Больше хорошего продукта.
        </T>
        <T style={{ fontSize: 11, color: c.dim, marginTop: 8 }}>
          Всё нужное — в одном месте.
        </T>
      </View>
      <View style={[s.row, { paddingHorizontal: 8 }]}>
        <View
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: online ? c.green : c.dim,
          }}
        />
        <T style={{ fontSize: 11, color: c.dim }}>
          {online ? "Обновляется в реальном времени" : "Подключение…"}
        </T>
      </View>
    </View>
  );
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: c.bg }}
      edges={["top", "left", "right"]}
    >
      <View style={{ flex: 1, flexDirection: "row" }}>
        {!mobile && !collapsed && sidebar()}
        <View style={{ flex: 1, minWidth: 0 }}>
          <View
            style={[
              s.row,
              {
                height: 64,
                paddingHorizontal: mobile ? 16 : 30,
                borderBottomWidth: 1,
                borderBottomColor: c.line,
              },
            ]}
          >
            <Button
              icon={mobile || collapsed ? Menu : PanelLeftClose}
              label={
                mobile
                  ? "Меню"
                  : collapsed
                    ? "Развернуть меню"
                    : "Свернуть меню"
              }
              expanded={mobile ? menu : !collapsed}
              variant="outline"
              onPress={toggleMenu}
            >
              {!mobile && "Меню"}
            </Button>
            <T style={{ fontSize: 12, color: c.dim }}>
              {instance.data?.name ?? "Flashback"}
            </T>
            <T style={{ color: c.dim }}>/</T>
            <T accessibilityRole="header" style={{ fontSize: 12 }}>
              {location.view === "open" ? "Открытые" : headings[location.view]}
            </T>
            <View style={s.grow} />
            {!mobile && (
              <View style={s.row}>
                <Radio size={13} color={online ? c.green : c.dim} />
                <T style={{ fontSize: 11, color: online ? c.green : c.muted }}>
                  {online ? "Live" : "Переподключение"}
                </T>
              </View>
            )}
            <Button
              icon={Plus}
              variant="primary"
              disabled={!canStatus("created")}
              onPress={() => setCreating(true)}
            >
              {mobile ? "Новый" : "Новый баг"}
            </Button>
          </View>
          <View
            style={{
              paddingHorizontal: mobile ? 16 : 38,
              flexDirection: mobile ? "column" : "row",
              alignItems: mobile ? "stretch" : "center",
              gap: 10,
              paddingVertical: 12,
            }}
          >
            <ScrollView
              horizontal
              style={{ flex: mobile ? undefined : 1, minWidth: 0 }}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 7, alignItems: "center" }}
            >
              {(
                [
                  "",
                  ...(location.view === "open"
                    ? ["ready_for_test", "in_progress", "rework", "created"]
                    : []),
                ] as (Status | "")[]
              ).map((status) => {
                const active = location.status === status,
                  Icon = status ? statusIcons[status] : Inbox;
                const count = status
                  ? data?.statuses[status]
                  : Object.values(data?.statuses ?? {}).reduce(
                      (a, b) => a + b,
                      0,
                    );
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      status ? statusLabels[status] : "Все статусы"
                    }
                    accessibilityState={{ selected: active }}
                    key={status}
                    onPress={() => {
                      set({ status, page: 1 });
                      scroll.current?.scrollTo({ y: 0, animated: false });
                    }}
                    style={({ hovered }: any) => [
                      s.row,
                      {
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                        borderRadius: 7,
                        borderWidth: 1,
                        borderColor: active ? "#534969" : c.line,
                        backgroundColor: active
                          ? c.accentBg
                          : hovered
                            ? c.hover
                            : "transparent",
                        gap: 7,
                      },
                    ]}
                  >
                    <Icon
                      size={13}
                      color={
                        active ? c.accent : status ? colors[status] : c.muted
                      }
                    />
                    <T
                      style={{
                        fontSize: 12,
                        color: active ? c.accent : c.muted,
                      }}
                    >
                      {status ? statusLabels[status] : "Все"}
                    </T>
                    <T
                      style={{ fontSize: 11, color: active ? c.accent : c.dim }}
                    >
                      {count ?? 0}
                    </T>
                  </Pressable>
                );
              })}
            </ScrollView>
            <View
              style={[
                s.row,
                {
                  width: mobile ? "100%" : Math.min(320, width * 0.24),
                  flexShrink: 0,
                  backgroundColor: c.surface,
                  borderWidth: 1,
                  borderColor: c.line,
                  borderRadius: 9,
                  paddingHorizontal: 12,
                },
              ]}
            >
              <Search size={16} color={c.dim} />
              <TextInput
                ref={searchRef}
                accessibilityLabel="Поиск багов"
                value={search}
                onChangeText={setSearch}
                placeholder="Поиск по тексту или номеру…"
                placeholderTextColor={c.dim}
                style={{
                  flex: 1,
                  minWidth: 0,
                  color: c.text,
                  height: 38,
                  fontSize: 13,
                }}
              />
              {search ? (
                <Button
                  icon={X}
                  label="Очистить поиск"
                  onPress={() => setSearch("")}
                />
              ) : !mobile ? (
                <View
                  style={[
                    s.row,
                    {
                      gap: 3,
                      borderWidth: 1,
                      borderColor: c.line,
                      paddingHorizontal: 5,
                      borderRadius: 4,
                    },
                  ]}
                >
                  <Command size={11} color={c.dim} />
                  <T style={{ fontSize: 10, color: c.dim }}>K</T>
                </View>
              ) : null}
            </View>
          </View>
          <View
            style={[
              s.row,
              {
                paddingHorizontal: mobile ? 20 : 50,
                height: 36,
                backgroundColor: "#15161b",
                borderTopWidth: 1,
                borderBottomWidth: 1,
                borderColor: c.line,
              },
            ]}
          >
            <T
              style={{
                fontSize: 10,
                color: c.dim,
                letterSpacing: 1,
                width: 58,
              }}
            >
              НОМЕР
            </T>
            <T
              style={[s.grow, { fontSize: 10, color: c.dim, letterSpacing: 1 }]}
            >
              ОПИСАНИЕ
            </T>
            {!mobile && (
              <>
                <T
                  style={{
                    width: 145,
                    fontSize: 10,
                    color: c.dim,
                    letterSpacing: 1,
                  }}
                >
                  СТАТУС
                </T>
                <T
                  style={{
                    width: 96,
                    fontSize: 10,
                    color: c.dim,
                    letterSpacing: 1,
                  }}
                >
                  АКТИВНОСТЬ
                </T>
              </>
            )}
            <ArrowDown size={12} color={c.dim} />
          </View>
          {query.isError && (
            <View style={[s.row, { padding: 14, backgroundColor: "#321e28" }]}>
              <T style={[s.grow, { color: c.red, fontSize: 12 }]}>
                Не удалось обновить список. Проверьте соединение.
              </T>
              <Button icon={RefreshCw} onPress={() => query.refetch()}>
                Повторить
              </Button>
            </View>
          )}
          <ScrollView
            ref={scroll}
            onScroll={(e) => {
              scrollY.current = e.nativeEvent.contentOffset.y;
            }}
            scrollEventThrottle={16}
            testID="bug-list"
            style={{ flex: 1 }}
            contentContainerStyle={{ flexGrow: 1 }}
            keyboardShouldPersistTaps="handled"
          >
            {!data ? (
              <View
                style={{
                  flex: 1,
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 48,
                }}
              >
                {query.isPending ? (
                  <ActivityIndicator color={c.accent} />
                ) : (
                  <T muted>Сервер пока недоступен</T>
                )}
              </View>
            ) : data.items.length === 0 ? (
              <View
                style={{
                  flex: 1,
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 48,
                  gap: 12,
                }}
              >
                <Inbox size={36} strokeWidth={1.2} color={c.dim} />
                <T style={{ fontSize: 18 }}>Здесь пока нет багов</T>
                <T muted style={{ textAlign: "center", fontSize: 13 }}>
                  {search || location.status
                    ? "Попробуйте другой запрос или сбросьте фильтры."
                    : "Новые отчёты появятся здесь автоматически."}
                </T>
                {search || location.status ? (
                  <Button
                    variant="outline"
                    onPress={() => {
                      setSearch("");
                      set({ q: "", status: "", page: 1 });
                    }}
                  >
                    Сбросить фильтры
                  </Button>
                ) : (
                  <Button icon={Plus} onPress={() => setCreating(true)}>
                    Создать баг
                  </Button>
                )}
              </View>
            ) : (
              data.items.map((r) => (
                <Pressable
                  key={r.id}
                  disabled={query.isPlaceholderData}
                  testID={"bug-" + r.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Баг ${r.id}: ${r.text.slice(0, 100)}`}
                  onPress={() => open(r)}
                  style={({ hovered, pressed }: any) => ({
                    paddingHorizontal: mobile ? 20 : 50,
                    paddingVertical: 17,
                    borderBottomWidth: 1,
                    borderBottomColor: "#24252d",
                    backgroundColor:
                      location.bug === r.id
                        ? c.accentBg
                        : hovered || pressed
                          ? "#1b1c24"
                          : lastSelected.current === r.id
                            ? "#181720"
                            : "transparent",
                    opacity: query.isPlaceholderData ? 0.7 : 1,
                  })}
                >
                  <View style={[s.row, { alignItems: "flex-start", gap: 10 }]}>
                    <T
                      style={[
                        s.mono,
                        { color: c.dim, width: 58, paddingTop: 1 },
                      ]}
                    >
                      #{r.id}
                    </T>
                    <View style={s.grow}>
                      <T
                        numberOfLines={2}
                        style={{
                          fontSize: 14,
                          lineHeight: 22,
                          fontWeight: "500",
                          letterSpacing: -0.1,
                        }}
                      >
                        {r.text}
                      </T>
                      <View style={[s.row, { marginTop: 8, gap: 8 }]}>
                        {r.reportedInVersion ? (
                          <T
                            style={{
                              fontSize: 10,
                              color: c.dim,
                              backgroundColor: "#22232b",
                              paddingHorizontal: 5,
                              borderRadius: 3,
                            }}
                          >
                            v{r.reportedInVersion}
                          </T>
                        ) : null}
                        <T
                          numberOfLines={1}
                          style={{ fontSize: 11, color: c.dim, flex: 1 }}
                        >
                          {r.assignedAgent
                            ? r.assignedAgent.split("/").filter(Boolean).pop()
                            : r.context || "Без контекста"}
                        </T>
                      </View>
                      {mobile && (
                        <View style={[s.row, { marginTop: 8 }]}>
                          <Badge status={r.status} compact />
                          <View style={s.grow} />
                          <MessageSquare size={12} color={c.dim} />
                          <T style={{ fontSize: 11, color: c.dim }}>
                            {r.commentCount}
                          </T>
                        </View>
                      )}
                    </View>
                    {!mobile && (
                      <>
                        <View style={{ width: 145, paddingTop: 0 }}>
                          <Badge status={r.status} />
                        </View>
                        <View
                          style={[s.row, { width: 96, paddingTop: 6, gap: 6 }]}
                        >
                          <MessageSquare size={13} color={c.dim} />
                          <T style={{ fontSize: 11, color: c.muted }}>
                            {r.commentCount}
                          </T>
                          <GitCommitHorizontal
                            size={14}
                            color={c.dim}
                            style={{ marginLeft: 5 }}
                          />
                          <T style={{ fontSize: 11, color: c.muted }}>
                            {r.commitCount}
                          </T>
                        </View>
                      </>
                    )}
                    <ArrowUpRight
                      size={14}
                      color={c.dim}
                      style={{ marginTop: 5 }}
                    />
                  </View>
                </Pressable>
              ))
            )}
          </ScrollView>
          <View
            testID="pagination"
            style={[
              s.row,
              {
                paddingHorizontal: mobile ? 16 : 38,
                paddingTop: mobile ? 2 : 12,
                paddingBottom: mobile
                  ? Math.max(2, Math.min(insets.bottom, 12))
                  : 12,
                borderTopWidth: 1,
                borderTopColor: c.line,
                minHeight: mobile ? 44 : 62,
              },
            ]}
          >
            <T style={{ fontSize: 12, color: c.dim }}>
              {data && data.total
                ? `${(data.page - 1) * 24 + 1}–${Math.min(data.page * 24, data.total)} из ${data.total}`
                : "0 багов"}
            </T>
            {query.isFetching && (
              <ActivityIndicator size="small" color={c.dim} />
            )}
            <View style={s.grow} />
            <Button
              icon={ChevronLeft}
              label="Предыдущая страница"
              disabled={!data || data.page <= 1 || query.isPlaceholderData}
              onPress={() => page(location.page - 1)}
            />
            {!mobile &&
              data &&
              Array.from({ length: data.pages }, (_, i) => i + 1)
                .filter(
                  (n) =>
                    n === 1 || n === data.pages || Math.abs(n - data.page) <= 1,
                )
                .map((n, i, arr) => (
                  <React.Fragment key={n}>
                    {i > 0 && n - arr[i - 1] > 1 && <T muted>…</T>}
                    <Button
                      label={`Страница ${n}`}
                      onPress={() => page(n)}
                      style={
                        n === data.page
                          ? { backgroundColor: c.accentBg }
                          : undefined
                      }
                    >
                      {String(n)}
                    </Button>
                  </React.Fragment>
                ))}
            {mobile && (
              <T style={{ fontSize: 12 }}>
                {data?.page ?? 1} / {data?.pages ?? 1}
              </T>
            )}
            <Button
              icon={ChevronRight}
              label="Следующая страница"
              disabled={
                !data || data.page >= data.pages || query.isPlaceholderData
              }
              onPress={() => page(location.page + 1)}
            />
          </View>
        </View>
        {mobile && menu && (
          <Overlay label="Навигация" onClose={() => setMenu(false)}>
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ flexGrow: 1 }}
            >
              {sidebar(true)}
            </ScrollView>
          </Overlay>
        )}
        {accessOpen && <AccessKeys onClose={() => setAccessOpen(false)} />}
        {location.bug && (
          <Detail
            key={location.bug}
            id={location.bug}
            onClose={close}
            notify={setToast}
          />
        )}
        {creating && (
          <NewReport
            onClose={() => setCreating(false)}
            onCreated={(r) => {
              setCreating(false);
              set({ bug: r.id }, true);
              setToast("Баг создан");
            }}
          />
        )}
        {!!toast && (
          <Pressable
            accessibilityRole="alert"
            onPress={() => setToast("")}
            style={{
              position: "absolute",
              bottom: 78,
              left: mobile ? 20 : 270,
              right: mobile ? 20 : undefined,
              backgroundColor: "#302a45",
              borderColor: "#534969",
              borderWidth: 1,
              borderRadius: 10,
              paddingVertical: 12,
              paddingHorizontal: 18,
              maxWidth: 460,
            }}
          >
            <T style={{ fontSize: 13, color: "#e0d8ff" }}>{toast}</T>
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}
