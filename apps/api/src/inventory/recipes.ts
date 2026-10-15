import { and, eq, inArray } from "drizzle-orm";
import { bundleItems, ingredients, itemVariants, items, modifierOptionIngredients, stockLevels, variantRecipeLines, type DbHandle } from "@naqdi/db";
import { mergeRequirements, recipeCost, SCALE, type Requirement } from "@naqdi/domain";

type Db = DbHandle["db"];

export interface CostLine {
  variantId?: string | null;
  bundleId?: string | null;
  optionIds: readonly (string | null)[];
  /** Modal manual varian (dipakai bila varian tidak punya resep). */
  manualCost: number;
}

export interface CostModel {
  /** Biaya pokok satu unit (satuan terkecil mata uang). */
  unitCost(line: CostLine): number;
  /** Kebutuhan stok untuk satu unit terjual (jumlah berskala 1000). Hanya objek yang dilacak stoknya. */
  unitRequirements(line: Omit<CostLine, "manualCost">): Requirement[];
}

interface RecipeLine {
  ingredientId: string;
  quantity: number;
}

/**
 * Memuat resep, stok modifier, komponen paket, dan biaya rata-rata bahan di sebuah outlet sekali jalan, lalu
 * menghitung biaya pokok dan kebutuhan stok untuk baris mana pun tanpa query tambahan.
 *
 * Biaya satu unit = (resep varian bila ada, kalau tidak modal manual varian) + bahan dari modifier yang dipilih.
 * Biaya paket = jumlah biaya komponennya. Biaya bahan = biaya rata-rata di outlet ini, atau biaya awal bahan bila belum ada saldo.
 */
export const buildCostModel = async (
  db: Db,
  outletId: string,
  want: { variantIds: readonly string[]; optionIds: readonly string[]; bundleIds: readonly string[] },
): Promise<CostModel> => {
  const bundleIds = [...new Set(want.bundleIds)];
  const comps = new Map<string, { variantId: string; quantity: number }[]>();
  if (bundleIds.length) {
    for (const r of await db.select().from(bundleItems).where(inArray(bundleItems.bundleId, bundleIds))) comps.set(r.bundleId, [...(comps.get(r.bundleId) ?? []), { variantId: r.variantId, quantity: r.quantity }]);
  }
  const variantIds = [...new Set([...want.variantIds, ...[...comps.values()].flat().map((c) => c.variantId)])];
  const optionIds = [...new Set(want.optionIds)];

  const variantInfo = new Map<string, { tracked: boolean; cost: number }>();
  const recipes = new Map<string, RecipeLine[]>();
  if (variantIds.length) {
    for (const r of await db
      .select({ id: itemVariants.id, cost: itemVariants.cost, track: items.trackStock })
      .from(itemVariants)
      .innerJoin(items, eq(itemVariants.itemId, items.id))
      .where(inArray(itemVariants.id, variantIds))) variantInfo.set(r.id, { tracked: r.track, cost: r.cost });
    for (const r of await db.select().from(variantRecipeLines).where(inArray(variantRecipeLines.variantId, variantIds))) recipes.set(r.variantId, [...(recipes.get(r.variantId) ?? []), { ingredientId: r.ingredientId, quantity: r.quantity }]);
  }
  const optionLines = new Map<string, RecipeLine[]>();
  if (optionIds.length) {
    for (const r of await db.select().from(modifierOptionIngredients).where(inArray(modifierOptionIngredients.optionId, optionIds))) optionLines.set(r.optionId, [...(optionLines.get(r.optionId) ?? []), { ingredientId: r.ingredientId, quantity: r.quantity }]);
  }

  const ingredientIds = [...new Set([...[...recipes.values()].flat(), ...[...optionLines.values()].flat()].map((l) => l.ingredientId))];
  const ing = new Map<string, { track: boolean; cost: number }>();
  if (ingredientIds.length) {
    for (const r of await db.select({ id: ingredients.id, track: ingredients.trackStock, cost: ingredients.defaultCost }).from(ingredients).where(inArray(ingredients.id, ingredientIds))) ing.set(r.id, { track: r.track, cost: r.cost });
    for (const r of await db
      .select({ id: stockLevels.subjectId, cost: stockLevels.avgCost })
      .from(stockLevels)
      .where(and(eq(stockLevels.outletId, outletId), eq(stockLevels.subjectType, "ingredient"), inArray(stockLevels.subjectId, ingredientIds)))) {
      const cur = ing.get(r.id);
      if (cur) ing.set(r.id, { ...cur, cost: r.cost });
    }
  }

  const costOfLines = (lines: readonly RecipeLine[]) => recipeCost(lines.map((l) => ({ quantity: l.quantity, cost: ing.get(l.ingredientId)?.cost ?? 0 })));
  const variantCost = (variantId: string, optionIdList: readonly (string | null)[], manual: number): number => {
    const recipe = recipes.get(variantId);
    const base = recipe && recipe.length ? costOfLines(recipe) : manual;
    const mods = costOfLines(optionIdList.flatMap((o) => (o ? (optionLines.get(o) ?? []) : [])));
    return base + mods;
  };
  const variantReqs = (variantId: string, optionIdList: readonly (string | null)[]): Requirement[] => {
    const out: Requirement[] = [];
    if (variantInfo.get(variantId)?.tracked) out.push({ subjectType: "variant", subjectId: variantId, quantity: SCALE });
    for (const l of [...(recipes.get(variantId) ?? []), ...optionIdList.flatMap((o) => (o ? (optionLines.get(o) ?? []) : []))]) {
      if (ing.get(l.ingredientId)?.track) out.push({ subjectType: "ingredient", subjectId: l.ingredientId, quantity: l.quantity });
    }
    return out;
  };

  return {
    unitCost(line) {
      if (line.bundleId) return (comps.get(line.bundleId) ?? []).reduce((a, c) => a + c.quantity * variantCost(c.variantId, [], variantInfo.get(c.variantId)?.cost ?? 0), 0);
      return line.variantId ? variantCost(line.variantId, line.optionIds, line.manualCost) : line.manualCost;
    },
    unitRequirements(line) {
      if (line.bundleId) {
        return mergeRequirements((comps.get(line.bundleId) ?? []).flatMap((c) => variantReqs(c.variantId, []).map((r) => ({ ...r, quantity: r.quantity * c.quantity }))));
      }
      return line.variantId ? mergeRequirements(variantReqs(line.variantId, line.optionIds)) : [];
    },
  };
};
