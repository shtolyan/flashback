import { z } from "zod";
import {
  createSchema,
  updateSchema,
  commentSchema,
  patchSchema,
} from "@flashback/contracts/schemas";
import { statuses } from "@flashback/contracts";
const string = { type: "string" };
const report = {
  type: "object",
  properties: Object.fromEntries(
    ["id", "revision"]
      .map((k) => [k, { type: "integer" }])
      .concat(
        [
          "createdUtc",
          "text",
          "context",
          "assignedAgent",
          "agentHandoff",
          "fixCommit",
          "reportedInVersion",
          "readyForTestInVersion",
          "fixedInVersion",
        ].map((k) => [k, string]) as any,
      ),
  ),
  required: [
    "id",
    "revision",
    "text",
    "status",
    "comments",
    "fixCommits",
    "archived",
  ],
};
Object.assign(report.properties, {
  status: { type: "string", enum: statuses },
  archived: { type: "boolean" },
  comments: {
    type: "array",
    items: {
      type: "object",
      properties: { author: string, text: string, whenUtc: string },
    },
  },
  fixCommits: { type: "array", items: string },
});
const response = (schema: any) => ({
  "200": {
    description: "Success",
    content: { "application/json": { schema } },
  },
  "400": { description: "Invalid request" },
  "401": { description: "Missing, expired or revoked access" },
  "403": { description: "Insufficient permission or invalid origin" },
  "404": { description: "Not found" },
  "409": {
    description: "Revision conflict; body includes error and actualRevision",
  },
});
const operation = (
  summary: string,
  input?: z.ZodType,
  output: any = report,
) => ({
  summary,
  ...(input
    ? {
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: z.toJSONSchema(input, { target: "openapi-3.0" }),
            },
          },
        },
      }
    : {}),
  responses: response(output),
});
const id = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "integer" },
};
const base = "/api/bugs/v1";
export const openapi = {
  openapi: "3.0.3",
  info: {
    title: "Flashback / HexLive-compatible bug API",
    version: "1.0.0",
    description:
      "One instance, one database. Every API read/write requires a Bearer access key or browser session. Tokens control allowed target statuses; administrators manage keys. PATCH semantics use POST; omitted/null fields preserve existing values. fixCommits replaces the array. Comments are addressed by zero-based ordinal. WebSocket /api/bugs/v1/events emits report.changed, report.deleted and commit.changed after commit; refresh queries after reconnect.",
  },
  security: [{ bearerAuth: [] }, { sessionCookie: [] }],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer" },
      sessionCookie: {
        type: "apiKey",
        in: "cookie",
        name: "flashback_session",
      },
    },
  },
  paths: {
    "/api/auth/session": {
      post: {
        ...operation(
          "Exchange a token for a 30-day HttpOnly session",
          z.object({ token: z.string() }),
          { type: "object" },
        ),
        security: [],
      },
    },
    "/api/auth/me": {
      get: operation("Current key and permissions", undefined, {
        type: "object",
      }),
    },
    "/api/auth/logout": {
      post: {
        ...operation("Invalidate current browser session"),
        responses: { "204": { description: "Signed out" } },
      },
    },
    "/api/auth/socket-ticket": {
      post: operation(
        "Issue a one-use WebSocket ticket valid for 30 seconds",
        undefined,
        { type: "object" },
      ),
    },
    "/api/access-keys": {
      get: operation("List key metadata; administrator only", undefined, {
        type: "array",
        items: { type: "object" },
      }),
      post: {
        ...operation(
          "Create key; administrator only; secret returned once",
          z.object({
            name: z.string().min(1).max(80),
            isAdmin: z.boolean().optional(),
            allowedStatuses: z.array(z.enum(statuses)).optional(),
          }),
          { type: "object" },
        ),
        responses: {
          "201": { description: "Created; key metadata and secret" },
        },
      },
    },
    "/api/access-keys/{keyId}/revoke": {
      parameters: [
        {
          name: "keyId",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      post: {
        ...operation("Revoke key, sessions and sockets; administrator only"),
        responses: {
          "204": { description: "Revoked" },
          "409": { description: "Last administrator cannot be revoked" },
        },
      },
    },
    [base + "/reports/{id}/access"]: {
      parameters: [id],
      get: operation("Trusted token attribution; no raw secrets", undefined, {
        type: "object",
      }),
    },
    [base + "/reports"]: {
      get: {
        ...operation("List all reports; ascending ID", undefined, {
          type: "array",
          items: report,
        }),
        parameters: [
          { name: "status", in: "query", schema: string },
          {
            name: "archived",
            in: "query",
            description:
              "false excludes archived reports; default includes them",
            schema: { type: "boolean" },
          },
        ],
      },
      post: {
        ...operation("Create report", createSchema),
        responses: {
          "201": {
            description: "Created",
            content: { "application/json": { schema: report } },
          },
          "400": { description: "Invalid request" },
        },
      },
    },
    [base + "/reports/{id}"]: {
      parameters: [id],
      get: operation("Read report"),
      post: operation("Update report", updateSchema),
      delete: {
        summary: "Delete report",
        responses: {
          "204": { description: "Deleted" },
          "404": { description: "Not found" },
        },
      },
    },
    [base + "/reports/{id}/delete"]: {
      parameters: [id],
      post: {
        summary: "Delete report (legacy POST)",
        responses: {
          "204": { description: "Deleted" },
          "404": { description: "Not found" },
        },
      },
    },
    [base + "/reports/{id}/comments"]: {
      parameters: [id],
      post: operation("Append comment", commentSchema),
    },
    [base + "/reports/{id}/comments/{ordinal}"]: {
      parameters: [
        id,
        {
          name: "ordinal",
          in: "path",
          required: true,
          schema: { type: "integer" },
        },
      ],
      post: operation("Edit comment; preserves original author", commentSchema),
    },
    [base + "/commits"]: {
      get: operation("List stored patch SHAs", undefined, {
        type: "array",
        items: string,
      }),
    },
    [base + "/commits/{sha}"]: {
      parameters: [{ name: "sha", in: "path", required: true, schema: string }],
      get: operation(
        "Get patch by SHA or unambiguous prefix",
        undefined,
        z.toJSONSchema(patchSchema),
      ),
      put: operation(
        "Upload patch, max 1,000,000 UTF-16 code units",
        patchSchema,
        z.toJSONSchema(patchSchema),
      ),
    },
    [base + "/query"]: {
      get: {
        ...operation(
          "Paginated summaries, counts and status facets",
          undefined,
          { type: "object" },
        ),
        parameters: ["view", "status", "q", "page"].map((name) => ({
          name,
          in: "query",
          schema: string,
        })),
      },
    },
    [base + "/reports/{id}/transition"]: {
      parameters: [id],
      post: operation(
        "Atomic player confirmation/rework with comment",
        z.object({
          action: z.enum(["confirm", "rework"]),
          expectedRevision: z.number().int(),
          text: z.string().optional(),
        }),
      ),
    },
  },
};

const attachmentSchema = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid" },
    filename: string,
    contentType: { type: "string", enum: ["image/png", "image/jpeg"] },
    size: { type: "integer" },
    sha256: string,
    createdAt: string,
    url: string,
  },
};
Object.assign(report.properties, {
  project: string,
  attachments: { type: "array", items: attachmentSchema },
});
const mediaPaths = openapi.paths as Record<string, any>;
mediaPaths["/api/projects"] = {
  get: operation("List game projects", undefined, {
    type: "array",
    items: {
      type: "object",
      properties: { slug: string, name: string, repository: string },
    },
  }),
};
mediaPaths[base + "/reports/{id}/attachments"] = {
  parameters: [id],
  get: operation("List private screenshot metadata", undefined, {
    type: "array",
    items: attachmentSchema,
  }),
  post: {
    summary:
      "Attach a PNG or JPEG; increments revision. Up to 4 MiB and 8 files per report.",
    parameters: [
      { name: "filename", in: "query", schema: string },
      { name: "expectedRevision", in: "query", schema: { type: "integer" } },
    ],
    requestBody: {
      required: true,
      content: {
        "image/png": { schema: { type: "string", format: "binary" } },
        "image/jpeg": { schema: { type: "string", format: "binary" } },
      },
    },
    responses: response(report),
  },
};
mediaPaths[base + "/reports/{id}/attachments/{attachment}"] = {
  parameters: [
    id,
    {
      name: "attachment",
      in: "path",
      required: true,
      schema: { type: "string", format: "uuid" },
    },
  ],
  get: {
    summary:
      "Download screenshot bytes with Bearer authentication or browser cookie",
    responses: {
      "200": {
        description: "Private image",
        content: {
          "image/png": { schema: { type: "string", format: "binary" } },
          "image/jpeg": { schema: { type: "string", format: "binary" } },
        },
      },
      "401": { description: "Authentication required" },
      "404": { description: "Attachment or report not in this project" },
    },
  },
};
mediaPaths[base + "/transcriptions"] = {
  post: {
    summary: "Queue a private Russian speech draft; does not create a bug",
    requestBody: {
      required: true,
      content: {
        "audio/wav": {
          schema: {
            type: "string",
            format: "binary",
            description: "PCM mono 16 kHz / 16 bit, 0.25–90 seconds",
          },
        },
      },
    },
    responses: {
      "202": {
        description: "Queued draft",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                id: { type: "string", format: "uuid" },
                status: string,
              },
            },
          },
        },
      },
      "429": { description: "Queue or rate limit reached" },
      "503": { description: "Whisper unavailable; manual text still works" },
    },
  },
};
mediaPaths[base + "/transcriptions/{job}"] = {
  parameters: [
    {
      name: "job",
      in: "path",
      required: true,
      schema: { type: "string", format: "uuid" },
    },
  ],
  get: operation(
    "Read own private transcription draft; expires in one day",
    undefined,
    {
      type: "object",
      properties: {
        id: string,
        status: {
          type: "string",
          enum: ["queued", "running", "complete", "failed"],
        },
        text: string,
        error: string,
      },
    },
  ),
};
for (const [route, value] of Object.entries(mediaPaths))
  if (route.startsWith(base) && !route.endsWith("/events"))
    value.parameters = [
      ...(value.parameters ?? []),
      {
        name: "X-Flashback-Project",
        in: "header",
        required: false,
        schema: { type: "string", default: "hexlive" },
        description:
          "first-signal or hexlive. Legacy callers retain HexLive; reporter keys are locked to their project.",
      },
    ];
