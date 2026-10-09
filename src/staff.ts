import type { ShopRoleName } from "./types";

export const STAFF_NAMES: Record<number, string> = {
  20: "林晓",
  21: "赵衡",
  22: "周予安",
  23: "许清禾",
  24: "陈见川",
};

export function staffName(personId: number) {
  return STAFF_NAMES[personId] ?? `人员 ${personId}`;
}

export function staffRoleLabel(role: ShopRoleName) {
  if (role === "matchmanager") return "红娘";
  if (role === "shop_manager") return "店长";
  return "总监";
}
