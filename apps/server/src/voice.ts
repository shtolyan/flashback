import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { pool, transaction } from "./database.ts";
import { actor } from "./auth-http.ts";
import { writeKey } from "./access.ts";
import { ApiError } from "./errors.ts";

// Audio is kept only until recognition; drafts expire in one day and never create a bug by themselves.
export function validateWav(data: Buffer) {
  if (
    data.length < 44 ||
    data.length > 3 * 1024 * 1024 ||
    data.toString("ascii", 0, 4) !== "RIFF" ||
    data.toString("ascii", 8, 12) !== "WAVE"
  )
    throw new ApiError(400, "Запишите WAV длительностью до 90 секунд.");
  let format = false,
    duration = 0;
  for (let pos = 12; pos + 8 <= data.length;) {
    const size = data.readUInt32LE(pos + 4),
      kind = data.toString("ascii", pos, pos + 4),
      start = pos + 8;
    if (start + size > data.length) throw new ApiError(400, "Запись обрезана.");
    if (kind === "fmt ") {
      if (
        size < 16 ||
        data.readUInt16LE(start) !== 1 ||
        data.readUInt16LE(start + 2) !== 1 ||
        data.readUInt32LE(start + 4) !== 16000 ||
        data.readUInt16LE(start + 14) !== 16
      )
        throw new ApiError(
          400,
          "Нужен монофонический PCM WAV, 16 кГц / 16 бит.",
        );
      format = true;
    }
    if (kind === "data") duration = size / 32000;
    pos = start + size + (size % 2);
  }
  if (!format || duration < 0.25 || duration > 90.1)
    throw new ApiError(
      400,
      "Длительность записи должна быть от 0,25 до 90 секунд.",
    );
  return duration;
}
export async function installVoice(
  app: FastifyInstance,
  project: (r: FastifyRequest) => string,
) {
  const attempts = new Map<string, { count: number; until: number }>();
  app.post("/api/bugs/v1/transcriptions", async (request, reply) => {
    if (!process.env.WHISPER_URL)
      throw new ApiError(
        503,
        "Распознавание сейчас недоступно. Можно написать текст вручную.",
      );
    const audio = Buffer.isBuffer(request.body)
      ? request.body
      : Buffer.alloc(0);
    validateWav(audio);
    const now = Date.now();
    for (const [k, v] of attempts) if (v.until < now) attempts.delete(k);
    const rate = attempts.get(request.ip) ?? { count: 0, until: now + 300000 };
    if (rate.count >= 6)
      throw new ApiError(
        429,
        "Слишком много записей. Подождите несколько минут.",
      );
    rate.count++;
    attempts.set(request.ip, rate);
    const key = actor(request),
      id = randomUUID();
    await transaction(async (db) => {
      await writeKey(db, key, "created", "bugs.create");
      // Bound the durable queue, including for distinct IPs sharing the game key.
      await db.query("SELECT pg_advisory_xact_lock(4310005)");
      if (
        Number(
          (
            await db.query(
              "SELECT count(*) FROM voice_transcriptions WHERE status IN ('queued','running')",
            )
          ).rows[0].count,
        ) >= 20
      )
        throw new ApiError(
          429,
          "Распознавание занято. Попробуйте ещё раз чуть позже.",
        );
      await db.query(
        "INSERT INTO voice_transcriptions(id,token_id,project,audio) VALUES($1,$2,$3,$4)",
        [id, key.id, project(request), audio],
      );
    });
    return reply.code(202).send({ id, status: "queued" });
  });
  app.get("/api/bugs/v1/transcriptions/:job", async (request) => {
    const id = z
      .string()
      .uuid()
      .parse((request.params as any).job);
    const r = await pool.query(
      "SELECT id,status,text,error FROM voice_transcriptions WHERE id=$1 AND token_id=$2 AND project=$3 AND created_at>now()-interval '1 day'",
      [id, actor(request).id, project(request)],
    );
    if (!r.rowCount) throw new ApiError(404, "Черновик не найден или истёк.");
    return r.rows[0];
  });
  let running = false,
    closing = false;
  const work = async () => {
    if (running || closing || !process.env.WHISPER_URL) return;
    running = true;
    try {
      const job = await transaction(async (db) => {
        await db.query(
          "DELETE FROM voice_transcriptions WHERE created_at<now()-interval '1 day'",
        );
        const r = await db.query(
          "SELECT * FROM voice_transcriptions WHERE status='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1",
        );
        if (!r.rowCount) return null;
        await db.query(
          "UPDATE voice_transcriptions SET status='running' WHERE id=$1",
          [r.rows[0].id],
        );
        return r.rows[0];
      });
      if (!job) return;
      try {
        const response = await fetch(
          process.env.WHISPER_URL.replace(/\/$/, "") + "/transcribe",
          {
            method: "POST",
            body: job.audio,
            headers: {
              "Content-Type": "audio/wav",
              ...(process.env.WHISPER_TOKEN
                ? { Authorization: "Bearer " + process.env.WHISPER_TOKEN }
                : {}),
            },
            signal: AbortSignal.timeout(240000),
          },
        );
        if (!response.ok) throw new Error("Whisper " + response.status);
        const result = (await response.json()) as { text?: string };
        const text = String(result.text ?? "")
          .trim()
          .slice(0, 20000);
        if (!text) throw new Error("No speech");
        await pool.query(
          "UPDATE voice_transcriptions SET status='complete',text=$2,audio=NULL WHERE id=$1",
          [job.id, text],
        );
      } catch {
        await pool.query(
          "UPDATE voice_transcriptions SET status='failed',error='Не удалось разобрать запись. Попробуйте ещё раз или напишите текст.',audio=NULL WHERE id=$1",
          [job.id],
        );
      }
    } finally {
      running = false;
    }
  };
  // The production app is a single queue consumer; resume interrupted work after a restart.
  await pool.query(
    "UPDATE voice_transcriptions SET status='queued' WHERE status='running'",
  );
  const timer = setInterval(() => work().catch((e) => app.log.error(e)), 1000);
  timer.unref();
  app.addHook("onClose", async () => {
    closing = true;
    clearInterval(timer);
    while (running) await new Promise((r) => setTimeout(r, 50));
  });
}
