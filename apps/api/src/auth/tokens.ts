import { createHash, randomBytes } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { accessTypes, isPrivilege, type AccessType, type Privilege } from "@naqdi/domain";

export interface AuthContext {
  userId: string;
  businessId: string;
  roleId: string;
  accessType: AccessType;
  privileges: Privilege[];
}

const encoder = new TextEncoder();

/**
 * Token akses berumur pendek. Hak akses ikut di dalam token; perubahan peran berlaku
 * paling lambat sebesar umur token (default 15 menit) atau saat token diperbarui.
 */
export const signAccessToken = async (ctx: AuthContext, secret: string, ttlSeconds: number): Promise<string> =>
  new SignJWT({ bid: ctx.businessId, rid: ctx.roleId, acc: ctx.accessType, prv: ctx.privileges })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(ctx.userId)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(encoder.encode(secret));

export const verifyAccessToken = async (token: string, secret: string): Promise<AuthContext | null> => {
  try {
    const { payload } = await jwtVerify(token, encoder.encode(secret), { algorithms: ["HS256"] });
    const { sub, bid, rid, acc, prv, kind } = payload as Record<string, unknown>;
    // Token kasir (POS) dan token pengelola platform tidak boleh dipakai di API Back Office.
    if (kind === "pos" || kind === "platform") return null;
    if (typeof sub !== "string" || typeof bid !== "string" || typeof rid !== "string") return null;
    if (!(accessTypes as readonly unknown[]).includes(acc)) return null;
    if (!Array.isArray(prv)) return null;
    return {
      userId: sub,
      businessId: bid,
      roleId: rid,
      accessType: acc as AccessType,
      privileges: prv.filter(isPrivilege),
    };
  } catch {
    return null;
  }
};

export const newRefreshToken = (): string => randomBytes(32).toString("base64url");

export const hashRefreshToken = (token: string): string => createHash("sha256").update(token).digest("hex");

export interface PosAuthContext {
  userId: string;
  businessId: string;
  roleId: string;
  outletId: string;
  deviceId: string;
  privileges: Privilege[];
}

/** Token sesi kasir: terikat ke satu outlet dan satu perangkat, dan ditandai `kind: "pos"` agar tidak bisa dipakai di Back Office. */
export const signPosToken = async (ctx: PosAuthContext, secret: string, ttlSeconds: number): Promise<string> =>
  new SignJWT({ kind: "pos", bid: ctx.businessId, rid: ctx.roleId, out: ctx.outletId, dev: ctx.deviceId, prv: ctx.privileges })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(ctx.userId)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(encoder.encode(secret));

export const verifyPosToken = async (token: string, secret: string): Promise<PosAuthContext | null> => {
  try {
    const { payload } = await jwtVerify(token, encoder.encode(secret), { algorithms: ["HS256"] });
    const { sub, bid, rid, out, dev, prv, kind } = payload as Record<string, unknown>;
    if (kind !== "pos") return null;
    if (typeof sub !== "string" || typeof bid !== "string" || typeof rid !== "string" || typeof out !== "string" || typeof dev !== "string") return null;
    if (!Array.isArray(prv)) return null;
    return { userId: sub, businessId: bid, roleId: rid, outletId: out, deviceId: dev, privileges: prv.filter(isPrivilege) };
  } catch {
    return null;
  }
};

export interface PlatformAuthContext {
  adminId: string;
  role: "owner" | "support";
}

/**
 * Token pengelola platform: ditandai `kind: "platform"`, ditandatangani dengan kunci TURUNAN yang berbeda dari token toko,
 * sehingga token toko tidak mungkin lolos sebagai pengelola walau bidangnya dipalsukan. Berumur pendek, tanpa pembaruan:
 * habis berarti masuk lagi.
 */
const platformKey = (secret: string) => encoder.encode(`${secret}::platform`);

export const signPlatformToken = async (ctx: PlatformAuthContext, secret: string, ttlSeconds: number): Promise<string> =>
  new SignJWT({ kind: "platform", role: ctx.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(ctx.adminId)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(platformKey(secret));

export const verifyPlatformToken = async (token: string, secret: string): Promise<PlatformAuthContext | null> => {
  try {
    const { payload } = await jwtVerify(token, platformKey(secret), { algorithms: ["HS256"] });
    const { sub, kind, role } = payload as Record<string, unknown>;
    if (kind !== "platform" || typeof sub !== "string" || (role !== "owner" && role !== "support")) return null;
    return { adminId: sub, role };
  } catch {
    return null;
  }
};
