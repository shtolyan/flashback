import React, { useState } from "react";
import {
  View,
  ScrollView,
  ActivityIndicator,
  Pressable,
  Platform,
  Share,
  Linking,
} from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import X from "lucide-react-native/icons/x";
import ArrowLeft from "lucide-react-native/icons/arrow-left";
import Check from "lucide-react-native/icons/check";
import RotateCcw from "lucide-react-native/icons/rotate-ccw";
import Archive from "lucide-react-native/icons/archive";
import ArchiveRestore from "lucide-react-native/icons/archive-restore";
import Pencil from "lucide-react-native/icons/pencil";
import Send from "lucide-react-native/icons/send";
import Trash2 from "lucide-react-native/icons/trash";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import GitCommitHorizontal from "lucide-react-native/icons/git-commit-horizontal";
import MessageSquare from "lucide-react-native/icons/message-square";
import LinkIcon from "lucide-react-native/icons/link";
import Copy from "lucide-react-native/icons/copy";
import User from "lucide-react-native/icons/user";
import Code2 from "lucide-react-native/icons/code-xml";
import RefreshCw from "lucide-react-native/icons/refresh-cw";
import {
  statuses,
  statusLabels,
  type Report,
  type Status,
  type CommitPatch,
} from "@flashback/contracts";
import { api, base, apiOrigin, RequestError } from "./api";
import { c, s, T, Button, Badge, Input, Label } from "./ui";
import Overlay from "./Overlay";
import { useAccess } from "./Auth";
import { authCleared } from "./credentials";
import type { ReportAccess } from "@flashback/contracts";

const textDrafts = new Map<number, { text: string; revision: number }>();
const commentDrafts = new Map<number, string>();
authCleared.add(() => {
  textDrafts.clear();
  commentDrafts.clear();
});
export default function Detail({
  id,
  onClose,
  notify,
}: {
  id: number;
  onClose: () => void;
  notify: (text: string) => void;
}) {
  const client = useQueryClient();
  const { canStatus } = useAccess();
  const accessQuery = useQuery({
    queryKey: ["report-access", id],
    queryFn: () => api<ReportAccess>(base + "/reports/" + id + "/access"),
  });
  const query = useQuery({
    queryKey: ["report", id],
    queryFn: ({ signal }) =>
      api<Report>(base + "/reports/" + id, undefined, undefined, signal),
  });
  const r = query.data;
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [editing, setEditing] = useState(textDrafts.has(id)),
    [text, setText] = useState(textDrafts.get(id)?.text ?? ""),
    [editRevision, setEditRevision] = useState(
      textDrafts.get(id)?.revision ?? 0,
    );
  const [comment, setComment] = useState(commentDrafts.get(id) ?? ""),
    [commentIndex, setCommentIndex] = useState<number | null>(null),
    [confirmDelete, setConfirmDelete] = useState(false),
    [rework, setRework] = useState(false),
    [reason, setReason] = useState("");
  const [agentEdit, setAgentEdit] = useState(false),
    [agent, setAgent] = useState(""),
    [handoff, setHandoff] = useState(""),
    [agentRevision, setAgentRevision] = useState(0);
  async function perform(
    name: string,
    path: string,
    body: unknown,
    success?: () => void,
  ) {
    if (busy) return;
    setBusy(name);
    setError("");
    try {
      const updated = await api<Report | undefined>(
        base + "/reports/" + id + path,
        body,
      );
      if (updated) client.setQueryData(["report", id], updated);
      client.invalidateQueries({ queryKey: ["list"] });
      client.invalidateQueries({ queryKey: ["report-access", id] });
      success?.();
      notify(name === "delete" ? "Баг удалён" : "Сохранено");
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof RequestError && e.status === 409) await query.refetch();
    } finally {
      setBusy("");
    }
  }
  const close = () => {
    if (busy) return;
    onClose();
  };
  function changeText(value: string) {
    setText(value);
    textDrafts.set(id, { text: value, revision: editRevision });
  }
  async function copyLink() {
    try {
      const url =
        Platform.OS === "web"
          ? window.location.href
          : apiOrigin() + "/?bug=" + id;
      if (Platform.OS === "web") {
        await navigator.clipboard.writeText(url);
        notify("Ссылка скопирована");
      } else await Share.share({ message: url });
    } catch {
      setError("Не удалось скопировать ссылку.");
    }
  }
  return (
    <Overlay label={`Баг #${id}`} onClose={close}>
      <View
        style={[
          s.row,
          {
            paddingHorizontal: 22,
            paddingVertical: 16,
            borderBottomWidth: 1,
            borderBottomColor: c.line,
          },
        ]}
      >
        <Button
          icon={ArrowLeft}
          label="Назад к списку"
          disabled={!!busy}
          onPress={close}
        />
        <T style={[s.mono, { color: c.muted }]}>БАГ #{id}</T>
        {r && <Badge status={r.status} />}
        <View style={s.grow} />
        <Button label="Скопировать ссылку" icon={LinkIcon} onPress={copyLink} />
        <Button
          label="Закрыть карточку"
          icon={X}
          disabled={!!busy}
          onPress={close}
        />
      </View>
      {error && (
        <View style={{ padding: 16, backgroundColor: "#35232d" }}>
          <T accessibilityRole="alert" style={{ color: c.red, fontSize: 12 }}>
            {error}
          </T>
        </View>
      )}
      {!r ? (
        <View style={{ padding: 40, alignItems: "center", gap: 16 }}>
          {query.isPending ? (
            <ActivityIndicator color={c.accent} />
          ) : (
            <>
              <T muted>{query.error?.message ?? "Баг не найден"}</T>
              <Button icon={RefreshCw} onPress={() => query.refetch()}>
                Повторить
              </Button>
            </>
          )}
        </View>
      ) : (
        <>
          {query.isError && (
            <View style={{ padding: 16, backgroundColor: "#35232d" }}>
              <T style={{ color: c.red, fontSize: 12 }}>
                {query.error instanceof RequestError &&
                query.error.status === 404
                  ? "Этот баг удалён в другом клиенте."
                  : "Не удалось обновить карточку."}
              </T>
              <Button onPress={close}>Вернуться к списку</Button>
            </View>
          )}
          <ScrollView
            style={{ flex: 1 }}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 24 }}
          >
            <View style={s.section}>
              <View style={[s.row, { marginBottom: 14 }]}>
                <Label>ОПИСАНИЕ</Label>
                <View style={s.grow} />
                {!editing && (
                  <Button
                    icon={Pencil}
                    label="Редактировать описание"
                    onPress={() => {
                      setText(r.text);
                      setEditRevision(r.revision);
                      setEditing(true);
                    }}
                  />
                )}
              </View>
              {editing ? (
                <>
                  <Input
                    accessibilityLabel="Описание бага"
                    multiline
                    value={text}
                    onChangeText={changeText}
                    style={{ minHeight: 180 }}
                  />
                  {editRevision !== r.revision && (
                    <View
                      style={{
                        marginTop: 12,
                        padding: 12,
                        backgroundColor: c.accentBg,
                        borderRadius: 8,
                      }}
                    >
                      <T style={{ fontSize: 12, color: c.accent }}>
                        Баг изменился во время редактирования. Текущий текст:
                      </T>
                      <T selectable style={{ fontSize: 12, marginTop: 8 }}>
                        {r.text}
                      </T>
                      <Button
                        onPress={() => {
                          setText(r.text);
                          setEditRevision(r.revision);
                          textDrafts.delete(id);
                        }}
                      >
                        Использовать свежий текст
                      </Button>
                    </View>
                  )}
                  <View
                    style={[
                      s.row,
                      { marginTop: 12, justifyContent: "flex-end" },
                    ]}
                  >
                    <Button
                      disabled={!!busy}
                      onPress={() => {
                        setEditing(false);
                        textDrafts.delete(id);
                      }}
                    >
                      Отменить правки
                    </Button>
                    <Button
                      icon={Check}
                      variant="primary"
                      disabled={!text.trim()}
                      loading={busy === "text"}
                      onPress={() =>
                        perform(
                          "text",
                          "",
                          {
                            text,
                            expectedRevision:
                              editRevision === r.revision
                                ? editRevision
                                : r.revision,
                          },
                          () => {
                            textDrafts.delete(id);
                            setEditing(false);
                          },
                        )
                      }
                    >
                      {editRevision !== r.revision
                        ? "Сохранить мой вариант"
                        : "Сохранить"}
                    </Button>
                  </View>
                </>
              ) : (
                <T
                  selectable
                  style={{
                    fontSize: 19,
                    lineHeight: 29,
                    fontWeight: "500",
                    letterSpacing: -0.2,
                  }}
                >
                  {r.text}
                </T>
              )}
              <View style={[s.row, { marginTop: 18, flexWrap: "wrap" }]}>
                <T style={{ fontSize: 11, color: c.dim }}>
                  Создан {r.createdUtc || "—"}
                </T>
                <T style={{ fontSize: 11, color: c.dim }}>·</T>
                <T style={{ fontSize: 11, color: c.dim }}>
                  Версия записи {r.revision}
                </T>
                {r.archived && (
                  <T style={{ fontSize: 11, color: c.accent }}>· В архиве</T>
                )}
              </View>
            </View>
            {r.status === "ready_for_test" && !r.archived && (
              <View style={[s.section, { backgroundColor: "#211e2e" }]}>
                <T style={{ fontSize: 15, fontWeight: "600" }}>
                  Готов к вашей проверке
                </T>
                <T
                  style={{
                    fontSize: 12,
                    color: c.muted,
                    marginTop: 5,
                    marginBottom: 15,
                  }}
                >
                  {r.readyForTestInVersion
                    ? `Исправление в сборке ${r.readyForTestInVersion}. Проверьте результат в игре.`
                    : "Агент завершил работу. Сборка с исправлением пока не указана."}
                </T>
                <View style={[s.row, { flexWrap: "wrap" }]}>
                  <Button
                    icon={Check}
                    variant="primary"
                    disabled={!!busy || !canStatus("fixed")}
                    loading={busy === "confirm"}
                    onPress={() =>
                      perform(
                        "confirm",
                        "/transition",
                        {
                          action: "confirm",
                          expectedRevision: r.revision,
                        },
                        onClose,
                      )
                    }
                  >
                    Всё исправлено
                  </Button>
                  <Button
                    icon={RotateCcw}
                    variant="outline"
                    disabled={!!busy || !canStatus("rework")}
                    onPress={() => setRework(!rework)}
                  >
                    На доработку
                  </Button>
                </View>
                {rework && (
                  <View style={{ marginTop: 16, gap: 10 }}>
                    <Input
                      multiline
                      accessibilityLabel="Причина доработки"
                      placeholder="Что ещё не работает?"
                      value={reason}
                      onChangeText={setReason}
                    />
                    <Button
                      variant="primary"
                      loading={busy === "rework"}
                      onPress={() =>
                        perform(
                          "rework",
                          "/transition",
                          {
                            action: "rework",
                            expectedRevision: r.revision,
                            text: reason,
                          },
                          () => {
                            setRework(false);
                            setReason("");
                          },
                        )
                      }
                    >
                      Вернуть на доработку
                    </Button>
                  </View>
                )}
              </View>
            )}
            <View style={s.section}>
              <Label>СТАТУС</Label>
              <View style={[s.row, { flexWrap: "wrap", gap: 7 }]}>
                {statuses.map((status) => (
                  <Pressable
                    key={status}
                    accessibilityRole="button"
                    accessibilityLabel={`Статус: ${statusLabels[status]}`}
                    disabled={
                      !!busy ||
                      r.status === status ||
                      r.archived ||
                      !canStatus(status)
                    }
                    accessibilityState={{
                      disabled:
                        !!busy ||
                        r.status === status ||
                        r.archived ||
                        !canStatus(status),
                    }}
                    onPress={() =>
                      perform(
                        "status",
                        "",
                        {
                          status,
                          expectedRevision: r.revision,
                        },
                        status === "fixed" ? onClose : undefined,
                      )
                    }
                    style={{
                      borderWidth: 1,
                      borderColor: r.status === status ? "#6c5d91" : c.line,
                      padding: 3,
                      borderRadius: 8,
                      opacity: busy || !canStatus(status) ? 0.5 : 1,
                    }}
                  >
                    <Badge status={status} />
                  </Pressable>
                ))}
              </View>
            </View>
            {!!r.context && (
              <View style={s.section}>
                <Label>КОНТЕКСТ ВОСПРОИЗВЕДЕНИЯ</Label>
                <T
                  selectable
                  style={[s.mono, { lineHeight: 20, color: c.muted }]}
                >
                  {r.context}
                </T>
              </View>
            )}
            <View style={s.section}>
              <View style={[s.row, { marginBottom: 8 }]}>
                <Label>АГЕНТ И ПЕРЕДАЧА РАБОТЫ</Label>
                <View style={s.grow} />
                <Button
                  icon={Pencil}
                  label="Редактировать агента"
                  onPress={() => {
                    setAgent(r.assignedAgent);
                    setHandoff(r.agentHandoff);
                    setAgentRevision(r.revision);
                    setAgentEdit(!agentEdit);
                  }}
                />
              </View>
              {agentEdit ? (
                <View style={{ gap: 12 }}>
                  <Input
                    accessibilityLabel="Назначенный агент"
                    value={agent}
                    onChangeText={setAgent}
                    placeholder="Имя потока агента"
                  />
                  <Input
                    accessibilityLabel="Передача работы"
                    multiline
                    value={handoff}
                    onChangeText={setHandoff}
                    placeholder="Диагноз, файлы, проверка, оставшиеся риски"
                  />
                  {agentRevision !== r.revision && (
                    <T style={{ color: c.accent, fontSize: 12 }}>
                      Запись обновилась. Отмените редактор и сравните актуальные
                      данные.
                    </T>
                  )}
                  <View style={[s.row, { justifyContent: "flex-end" }]}>
                    <Button onPress={() => setAgentEdit(false)}>Отмена</Button>
                    <Button
                      variant="primary"
                      loading={busy === "agent"}
                      disabled={agentRevision !== r.revision}
                      onPress={() =>
                        perform(
                          "agent",
                          "",
                          {
                            assignedAgent: agent,
                            agentHandoff: handoff,
                            expectedRevision: agentRevision,
                          },
                          () => setAgentEdit(false),
                        )
                      }
                    >
                      Сохранить
                    </Button>
                  </View>
                </View>
              ) : (
                <>
                  <View style={[s.row, { marginBottom: 10 }]}>
                    <Code2 size={16} color={c.accent} />
                    <T selectable style={[s.mono, { color: c.accent }]}>
                      {r.assignedAgent || "Пока не назначен"}
                    </T>
                  </View>
                  {r.agentHandoff ? (
                    <T
                      selectable
                      style={{ fontSize: 13, lineHeight: 22, color: c.muted }}
                    >
                      {r.agentHandoff}
                    </T>
                  ) : null}
                </>
              )}
            </View>
            <View style={s.section}>
              <Label>ВЕРСИИ СБОРОК</Label>
              <View style={[s.row, { flexWrap: "wrap", gap: 22 }]}>
                {[
                  ["Обнаружен", r.reportedInVersion],
                  ["На проверке", r.readyForTestInVersion],
                  ["Подтверждён", r.fixedInVersion],
                ].map(([title, value]) => (
                  <View key={title}>
                    <T style={{ fontSize: 11, color: c.dim }}>{title}</T>
                    <T
                      style={[
                        s.mono,
                        { marginTop: 4, color: value ? c.text : c.dim },
                      ]}
                    >
                      {value || "—"}
                    </T>
                  </View>
                ))}
              </View>
            </View>
            <View style={s.section}>
              <Label>
                КОММИТЫ · {r.fixCommits.length || Number(!!r.fixCommit)}
              </Label>
              {(r.fixCommits.length
                ? r.fixCommits
                : r.fixCommit
                  ? [r.fixCommit]
                  : []
              ).map((sha) => (
                <Patch key={sha} sha={sha} />
              ))}
              {!r.fixCommits.length && !r.fixCommit && (
                <T muted style={{ fontSize: 12 }}>
                  Агент ещё не прикрепил коммиты.
                </T>
              )}
            </View>
            <View style={[s.section, { borderBottomWidth: 0 }]}>
              <View style={[s.row, { marginBottom: 20 }]}>
                <MessageSquare size={17} color={c.muted} />
                <T style={{ fontSize: 16, fontWeight: "600" }}>Обсуждение</T>
                <T muted style={{ fontSize: 12 }}>
                  {r.comments.length}
                </T>
              </View>
              {r.comments.length === 0 && (
                <T muted style={{ fontSize: 12, marginBottom: 20 }}>
                  Здесь будут комментарии и ответы агента.
                </T>
              )}
              {r.comments.map((comment, i) => (
                <View
                  key={i}
                  style={{
                    paddingLeft: 18,
                    borderLeftWidth: 1,
                    borderLeftColor: c.line,
                    marginLeft: 13,
                    paddingBottom: 24,
                  }}
                >
                  <View
                    style={{
                      position: "absolute",
                      left: -12,
                      top: 0,
                      width: 24,
                      height: 24,
                      borderRadius: 7,
                      backgroundColor:
                        comment.author === "user" ? "#2a3031" : c.accentBg,
                      justifyContent: "center",
                      alignItems: "center",
                    }}
                  >
                    {comment.author === "user" ? (
                      <User size={13} color={c.green} />
                    ) : (
                      <Code2 size={13} color={c.accent} />
                    )}
                  </View>
                  <View style={[s.row, { paddingLeft: 4, marginBottom: 6 }]}>
                    <T
                      style={{
                        fontSize: 12,
                        fontWeight: "600",
                        color: comment.author === "user" ? c.green : c.accent,
                      }}
                    >
                      {comment.author === "user" ? "Вы" : comment.author}
                    </T>
                    <T style={{ fontSize: 10, color: c.dim, flex: 1 }}>
                      {comment.whenUtc || "Дата не указана"}
                    </T>
                    {comment.author === "user" && (
                      <Button
                        label={`Редактировать комментарий ${i + 1}`}
                        icon={Pencil}
                        style={{ minHeight: 28, minWidth: 28, padding: 5 }}
                        onPress={() => {
                          setCommentIndex(i);
                          setComment(comment.text);
                        }}
                      />
                    )}
                  </View>
                  <T
                    selectable
                    style={{
                      fontSize: 13,
                      lineHeight: 22,
                      color: "#c9cad5",
                      paddingLeft: 4,
                    }}
                  >
                    {comment.text}
                  </T>
                </View>
              ))}
              <View style={[s.card, { padding: 14 }]}>
                {commentIndex !== null && (
                  <View style={s.row}>
                    <T muted style={{ fontSize: 11 }}>
                      Редактирование комментария {commentIndex + 1}
                    </T>
                    <Button
                      icon={X}
                      label="Отменить редактирование комментария"
                      onPress={() => {
                        setCommentIndex(null);
                        setComment(commentDrafts.get(id) ?? "");
                      }}
                    />
                  </View>
                )}
                <Input
                  accessibilityLabel="Комментарий"
                  multiline
                  value={comment}
                  onChangeText={(v) => {
                    setComment(v);
                    if (commentIndex === null) commentDrafts.set(id, v);
                  }}
                  placeholder="Добавить комментарий…"
                  style={{
                    minHeight: 92,
                    borderWidth: 0,
                    backgroundColor: "transparent",
                    padding: 0,
                  }}
                />
                <View
                  style={[s.row, { justifyContent: "flex-end", marginTop: 8 }]}
                >
                  <Button
                    icon={Send}
                    variant="primary"
                    disabled={!comment.trim() || !!busy}
                    loading={busy === "comment"}
                    onPress={() =>
                      perform(
                        "comment",
                        "/comments" +
                          (commentIndex === null ? "" : "/" + commentIndex),
                        { author: "user", text: comment },
                        () => {
                          setComment("");
                          setCommentIndex(null);
                          commentDrafts.delete(id);
                        },
                      )
                    }
                  >
                    {commentIndex === null ? "Отправить" : "Сохранить"}
                  </Button>
                </View>
              </View>
            </View>
            <View
              style={[
                s.section,
                {
                  borderBottomWidth: 0,
                  borderTopWidth: 1,
                  borderTopColor: c.line,
                },
              ]}
            >
              <View style={{ gap: 5, marginBottom: 16 }}>
                {(["created", "ready", "fixed", "updated"] as const).map(
                  (field) => {
                    const stamp = accessQuery.data?.[field];
                    return stamp ? (
                      <T key={field} style={{ fontSize: 11, color: c.dim }}>
                        {
                          {
                            created: "Создан",
                            ready: "На проверку",
                            fixed: "Подтверждён",
                            updated: "Последняя правка",
                          }[field]
                        }{" "}
                        · {stamp.name} · #{stamp.tokenId.slice(0, 8)}
                      </T>
                    ) : null;
                  },
                )}
                {accessQuery.data && !accessQuery.data.updated ? (
                  <T style={{ fontSize: 11, color: c.dim }}>
                    История до введения ключей доступа
                  </T>
                ) : null}
              </View>
              <View style={[s.row, { flexWrap: "wrap" }]}>
                {(r.status === "fixed" || r.archived) && (
                  <Button
                    icon={r.archived ? ArchiveRestore : Archive}
                    variant="outline"
                    disabled={!!busy || !canStatus("fixed")}
                    onPress={() =>
                      perform("archive", "", {
                        archived: !r.archived,
                        expectedRevision: r.revision,
                      })
                    }
                  >
                    {r.archived ? "Восстановить из архива" : "В архив"}
                  </Button>
                )}
                <View style={s.grow} />
                <Button
                  icon={Trash2}
                  disabled={!!busy || !canStatus("fixed")}
                  onPress={() => setConfirmDelete(!confirmDelete)}
                >
                  Удалить
                </Button>
              </View>
              {confirmDelete && (
                <View
                  style={{
                    padding: 14,
                    marginTop: 12,
                    borderRadius: 9,
                    backgroundColor: "#35232d",
                    gap: 10,
                  }}
                >
                  <T style={{ fontSize: 13 }}>
                    Удалить баг #{id} и его комментарии? Это действие нельзя
                    отменить.
                  </T>
                  <View style={s.row}>
                    <Button onPress={() => setConfirmDelete(false)}>
                      Отмена
                    </Button>
                    <Button
                      variant="danger"
                      loading={busy === "delete"}
                      onPress={() =>
                        perform("delete", "/delete", {}, () => {
                          client.removeQueries({ queryKey: ["report", id] });
                          onClose();
                        })
                      }
                    >
                      Удалить навсегда
                    </Button>
                  </View>
                </View>
              )}
            </View>
          </ScrollView>
        </>
      )}
    </Overlay>
  );
}
function Patch({ sha }: { sha: string }) {
  const instance = useQuery({
    queryKey: ["instance"],
    queryFn: () => api<{ name: string; repository: string }>("/api/instance"),
  });
  const [open, setOpen] = useState(false);
  const [visibleLines, setVisibleLines] = useState(400);
  const query = useQuery({
    queryKey: ["commit", sha],
    queryFn: () => api<CommitPatch>(base + "/commits/" + sha),
    enabled: open,
    retry: false,
  });
  const patch = query.data;
  return (
    <View style={[s.card, { marginBottom: 8, overflow: "hidden" }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Коммит ${sha.slice(0, 8)}`}
        onPress={() => setOpen(!open)}
        style={[s.row, { padding: 12 }]}
      >
        {open ? (
          <ChevronDown size={14} color={c.dim} />
        ) : (
          <ChevronRight size={14} color={c.dim} />
        )}
        <GitCommitHorizontal size={16} color={c.accent} />
        <T style={[s.mono, { color: c.accent }]}>{sha.slice(0, 8)}</T>
        <T numberOfLines={1} style={[s.grow, { fontSize: 11, color: c.muted }]}>
          {patch?.subject ?? "Изменения в коде"}
        </T>
      </Pressable>
      {open && (
        <View
          style={{ padding: 14, borderTopWidth: 1, borderTopColor: c.line }}
        >
          {instance.data?.repository && (
            <Button
              icon={LinkIcon}
              onPress={() =>
                Linking.openURL(instance.data!.repository + "/commit/" + sha)
              }
            >
              Открыть в репозитории
            </Button>
          )}
          {query.isPending ? (
            <ActivityIndicator color={c.accent} />
          ) : patch ? (
            <>
              <T style={{ fontSize: 13, fontWeight: "600" }}>{patch.subject}</T>
              <T style={{ fontSize: 11, color: c.dim, marginVertical: 7 }}>
                {patch.author} · {patch.whenUtc}
              </T>
              <T selectable style={{ fontSize: 12, color: c.muted }}>
                {patch.message}
              </T>
              <View style={{ marginVertical: 12, gap: 5 }}>
                {patch.files.map((f) => (
                  <T
                    key={f.path}
                    selectable
                    style={[s.mono, { fontSize: 10, color: c.muted }]}
                  >
                    {f.path}{" "}
                    <T style={{ color: c.green, fontSize: 10 }}>+{f.added}</T>{" "}
                    <T style={{ color: c.red, fontSize: 10 }}>−{f.deleted}</T>
                    {f.binary ? " · binary" : ""}
                  </T>
                ))}
              </View>
              <ScrollView
                horizontal
                style={{
                  backgroundColor: c.bg,
                  borderRadius: 7,
                  padding: 10,
                  maxHeight: 380,
                }}
              >
                <ScrollView nestedScrollEnabled>
                  <T
                    selectable
                    style={{
                      fontFamily: "monospace",
                      fontSize: 10,
                      lineHeight: 17,
                    }}
                  >
                    {patch.patch
                      .split("\n")
                      .slice(0, visibleLines)
                      .map((line, i) => (
                        <T
                          key={i}
                          style={{
                            fontFamily: "monospace",
                            fontSize: 10,
                            lineHeight: 17,
                            color: line.startsWith("+")
                              ? c.green
                              : line.startsWith("-")
                                ? c.red
                                : line.startsWith("@@")
                                  ? c.accent
                                  : c.muted,
                          }}
                        >
                          {line + "\n"}
                        </T>
                      ))}
                  </T>
                </ScrollView>
              </ScrollView>
              {patch.patch.split("\n").length > visibleLines && (
                <Button onPress={() => setVisibleLines((n) => n + 400)}>
                  Показать ещё 400 строк
                </Button>
              )}
              {patch.truncated && (
                <T style={{ color: c.accent, fontSize: 11, marginTop: 8 }}>
                  Патч обрезан сервером до 1 000 000 символов.
                </T>
              )}
            </>
          ) : (
            <T muted style={{ fontSize: 12 }}>
              {query.error instanceof RequestError && query.error.status === 404
                ? "Дифф ещё не загружен агентом."
                : query.error?.message}
            </T>
          )}
        </View>
      )}
    </View>
  );
}
