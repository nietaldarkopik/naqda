import { hash } from "bcryptjs";

export const hashPasswordWith = (plain: string, cost: number): Promise<string> => hash(plain, cost);
