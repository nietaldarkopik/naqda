import { Hono } from "hono";
import { newId } from "@naqdi/db";
import { AppError } from "../errors";
import { requirePrivilege, type AppEnv } from "../http";
import { mimeForExt, sniffImage, type Storage } from "../storage";

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/** Awalan URL gambar milik sebuah bisnis; dipakai untuk memvalidasi `imageUrl` item. */
export const imagePrefix = (businessId: string) => `/api/v1/files/${businessId}/`;

/** POST /uploads/image (multipart, bidang "file"). Hak: library.manage. */
export const uploadRoutes = (storage: Storage) => {
  const app = new Hono<AppEnv>();

  app.post("/image", requirePrivilege("library.manage"), async (c) => {
    const declared = Number(c.req.header("content-length") ?? "0");
    if (declared > MAX_IMAGE_BYTES + 64 * 1024) throw new AppError("validation", { fields: { file: "catalog.imageTooLarge" } });

    let form: Record<string, unknown>;
    try {
      form = await c.req.parseBody();
    } catch {
      throw new AppError("validation", { fields: { file: "errors.validation" } });
    }
    const file = form.file;
    if (!(file instanceof File)) throw new AppError("validation", { fields: { file: "common.required" } });
    if (file.size > MAX_IMAGE_BYTES) throw new AppError("validation", { fields: { file: "catalog.imageTooLarge" } });

    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = sniffImage(bytes);
    if (!type) throw new AppError("validation", { fields: { file: "catalog.imageType" } });

    const businessId = c.get("auth").businessId;
    const name = `${newId()}.${type.ext}`;
    await storage.save(`${businessId}/${name}`, bytes);
    return c.json({ url: `${imagePrefix(businessId)}${name}`, size: bytes.length, type: type.mime }, 201);
  });

  return app;
};

/**
 * GET /files/:businessId/:name. Publik karena dipakai <img>; keamanannya dari nama berkas UUID yang tidak bisa ditebak
 * dan dari jenis berkas yang dibatasi pada gambar (bukan data pelanggan).
 */
export const fileRoutes = (storage: Storage) => {
  const app = new Hono();
  app.get("/:businessId/:name", async (c) => {
    const { businessId, name } = c.req.param();
    const m = /^([0-9a-f-]{36})\.(png|jpg|webp)$/.exec(name);
    if (!m || !/^[0-9a-f-]{36}$/.test(businessId)) throw new AppError("not_found");
    const bytes = await storage.read(`${businessId}/${name}`);
    if (!bytes) throw new AppError("not_found");
    return new Response(Buffer.from(bytes), {
      headers: {
        "content-type": mimeForExt(m[2]!),
        "x-content-type-options": "nosniff",
        "cache-control": "public, max-age=31536000, immutable",
        "content-security-policy": "default-src 'none'; sandbox",
      },
    });
  });
  return app;
};
