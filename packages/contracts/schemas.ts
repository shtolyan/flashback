import { z } from "zod";
import { statuses } from "./index";
const text = z.string().trim().min(1, "Текст не может быть пустым");
export const createSchema = z.object({
  text,
  context: z.string().nullish(),
  reportedInVersion: z.string().nullish(),
  requestId: z.string().uuid().optional(),
  attachments: z
    .array(
      z.object({
        filename: z.string().min(1).max(150),
        contentType: z.enum(["image/png", "image/jpeg"]),
        dataBase64: z.string().max(5592416),
      }),
    )
    .max(4)
    .optional(),
});
export const updateSchema = z.object({
  text: text.nullish(),
  status: z.enum(statuses).nullish(),
  assignedAgent: z.string().nullish(),
  agentHandoff: z.string().nullish(),
  fixCommits: z.array(z.string()).nullish(),
  readyForTestInVersion: z.string().nullish(),
  fixedInVersion: z.string().nullish(),
  archived: z.boolean().nullish(),
  expectedRevision: z.number().int().nonnegative().nullish(),
});
export const commentSchema = z.object({ text, author: z.string().nullish() });
export const patchSchema = z.object({
  sha: z.string().optional(),
  subject: z.string().nullish(),
  message: z.string().nullish(),
  author: z.string().nullish(),
  whenUtc: z.string().nullish(),
  files: z
    .array(
      z.object({
        path: z.string(),
        added: z.number().int().nonnegative(),
        deleted: z.number().int().nonnegative(),
        binary: z.boolean().default(false),
      }),
    )
    .nullish(),
  patch: z.string().nullish(),
  truncated: z.boolean().optional(),
});
export type Update = z.infer<typeof updateSchema>;
