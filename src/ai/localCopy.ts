import { suggestRecommendationCopy, type RecommendationCopy } from "../../web/src/draftCopy";

export type { RecommendationCopy };
export { suggestRecommendationCopy };

export const LOCAL_FAILURE_NOTICE = "这次没调通，已用本地写法";

export function clip(text: string, max: number) {
  const chars = Array.from(text.trim());
  if (chars.length <= max) return chars.join("");
  return chars.slice(0, max).join("");
}
