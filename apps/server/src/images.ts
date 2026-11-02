import { randomUUID, createHash } from "node:crypto";
import type { PoolClient } from "pg";
import type { AccessKey } from "@flashback/contracts";
import { ApiError } from "./errors.ts";

export type ImageInput = {
  filename: string;
  contentType: string;
  dataBase64: string;
};
export const maxImageBytes = 4 * 1024 * 1024;
export function decodeImage(input: ImageInput) {
  if (
    !/^[A-Za-z0-9+/]*={0,2}$/.test(input.dataBase64) ||
    input.dataBase64.length % 4
  )
    throw new ApiError(400, "Неверное кодирование изображения.");
  const bytes = Buffer.from(input.dataBase64, "base64");
  if (!bytes.length || bytes.length > maxImageBytes)
    throw new ApiError(413, "Изображение должно быть не больше 4 МБ.");
  const png =
    bytes.length >= 33 &&
    bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.toString("ascii", 12, 16) === "IHDR";
  const jpeg =
    bytes.length >= 4 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[bytes.length - 2] === 255 &&
    bytes[bytes.length - 1] === 217;
  if (!(
    (input.contentType === "image/png" && png) ||
    (input.contentType === "image/jpeg" && jpeg)
  ))
    throw new ApiError(
      415,
      "Прикрепите PNG или JPEG, соответствующий типу файла.",
    );
  if (
    png &&
    (bytes.readUInt32BE(16) < 1 ||
      bytes.readUInt32BE(20) < 1 ||
      bytes.readUInt32BE(16) > 8192 ||
      bytes.readUInt32BE(20) > 8192)
  )
    throw new ApiError(400, "Размер изображения не поддерживается.");
  const filename =
    input.filename.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(-100) ||
    (png ? "screenshot.png" : "screenshot.jpg");
  return {
    bytes,
    filename,
    contentType: input.contentType,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
export async function insertAttachment(
  db: PoolClient,
  id: number,
  key: AccessKey,
  image: ReturnType<typeof decodeImage>,
) {
  if (
    Number(
      (
        await db.query(
          "SELECT count(*) FROM report_attachments WHERE report_id=$1",
          [id],
        )
      ).rows[0].count,
    ) >= 8
  )
    throw new ApiError(400, "В отчёте уже 8 вложений.");
  if (key.reporterProject) {
    await db.query("SELECT pg_advisory_xact_lock(4310006)");
    const used = Number(
      (
        await db.query(
          "SELECT COALESCE(sum(octet_length(bytes)),0) AS n FROM report_attachments a JOIN reports r ON r.id=a.report_id WHERE r.project=$1",
          [key.reporterProject],
        )
      ).rows[0].n,
    );
    if (used + image.bytes.length > 1024 * 1024 * 1024)
      throw new ApiError(
        507,
        "Хранилище скриншотов заполнено. Свяжитесь с разработчиком.",
      );
  }
  await db.query(
    "INSERT INTO report_attachments(id,report_id,filename,content_type,bytes,sha256,token_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [
      randomUUID(),
      id,
      image.filename,
      image.contentType,
      image.bytes,
      image.sha256,
      key.id,
    ],
  );
}
