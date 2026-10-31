import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { menuItemChoices, optionChoices, optionGroups } from "@/db/schema";
import type { OptionGroup } from "./pricing";

/** Opsi satu menu (master + selisih harga khusus menu), terurut grup lalu pilihan. */
export async function getMenuOptions(menuItemId: string): Promise<OptionGroup[]> {
  const rows = await db
    .select({
      gid: optionGroups.id, gname: optionGroups.name, required: optionGroups.required, maxSelect: optionGroups.maxSelect,
      cid: optionChoices.id, label: optionChoices.label, priceDelta: menuItemChoices.priceDelta, isDefault: menuItemChoices.isDefault,
    })
    .from(menuItemChoices)
    .innerJoin(optionChoices, eq(optionChoices.id, menuItemChoices.choiceId))
    .innerJoin(optionGroups, eq(optionGroups.id, menuItemChoices.groupId))
    .where(eq(menuItemChoices.menuItemId, menuItemId))
    .orderBy(asc(optionGroups.sortOrder), asc(optionGroups.name), asc(optionChoices.sortOrder), asc(optionChoices.label));
  const groups = new Map<string, OptionGroup>();
  for (const r of rows) {
    const g = groups.get(r.gid) ?? { id: r.gid, name: r.gname, required: r.required, maxSelect: r.maxSelect, choices: [] };
    g.choices.push({ id: r.cid, label: r.label, priceDelta: r.priceDelta, isDefault: r.isDefault });
    groups.set(r.gid, g);
  }
  return [...groups.values()];
}
