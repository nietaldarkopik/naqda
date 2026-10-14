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
    const { sub, bid, rid, acc, prv } = payload as Record<string, unknown>;
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
