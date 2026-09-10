export const statuses = [
  "created",
  "in_progress",
  "ready_for_test",
  "fixed",
  "rework",
] as const;
export type Status = (typeof statuses)[number];
export const statusLabels: Record<Status, string> = {
  created: "Новый",
  in_progress: "В работе",
  ready_for_test: "На проверке",
  fixed: "Исправлен",
  rework: "На доработку",
};
export interface Comment {
  whenUtc: string;
  author: string;
  text: string;
}
export interface Report {
  id: number;
  createdUtc: string;
  status: Status;
  text: string;
  context: string;
  assignedAgent: string;
  agentHandoff: string;
  fixCommits: string[];
  fixCommit: string;
  reportedInVersion: string;
  readyForTestInVersion: string;
  fixedInVersion: string;
  archived: boolean;
  comments: Comment[];
  revision: number;
}
export interface CommitPatch {
  sha: string;
  subject: string;
  message: string;
  author: string;
  whenUtc: string;
  files: { path: string; added: number; deleted: number; binary: boolean }[];
  patch: string;
  truncated: boolean;
  storedUtc: string;
}
export type ReportSummary = Omit<
  Report,
  "comments" | "agentHandoff" | "fixCommits"
> & { commentCount: number; commitCount: number };
export type View = "open" | "fixed" | "archive";
export interface Page {
  items: ReportSummary[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
  counts: Record<View, number>;
  statuses: Record<Status, number>;
}
export type ChangeEvent =
  | { type: "report.changed" | "report.deleted"; id: number; revision?: number }
  | { type: "commit.changed"; sha: string }
  | { type: "connected" };
export type { Update } from "./schemas";
