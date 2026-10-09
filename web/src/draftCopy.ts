/** 系统起草推荐时写下的占位理由，补写时可以换成完整说明。 */
export const STUB_REASON = "同在服务库，尚未推荐";

export type RecommendationCopy = {
  progress: string;
  reason: string;
  highlights: string;
  hiddenPoints: string;
};

export function isUnwritten(value: string, field: keyof RecommendationCopy) {
  const text = value.trim();
  if (!text) return true;
  return field === "reason" && text === STUB_REASON;
}

/** 模型没调通时的本地四套话术兜底。页面先请求建议接口，接口失败才用这里。 */
export function suggestRecommendationCopy(memberName: string, guestName: string, seed: number): RecommendationCopy {
  const index = Math.abs(seed) % 4;
  const progress = [
    `已把${guestName}介绍给${memberName}，还没约见面`,
    `${memberName}愿意先认识${guestName}，等对方回时间`,
    `双方都知道这次推荐，见面时间还没定`,
    `红娘已说明来意，${guestName}还没回复是否见面`,
  ][index];
  const reason = [
    `${memberName}和${guestName}都在同一服务库，生活节奏接近，适合先见面再判断。`,
    `${guestName}的相处方式和${memberName}现在想找的人比较接近，值得安排一次认识。`,
    `两人不急着定结论，先见面看感觉，比继续空着更合适。`,
    `${memberName}近期在看同城、作息稳定的对象，${guestName}符合这几个条件。`,
  ][index];
  const highlights = [
    `${guestName}说话具体，作息稳定，聊到周末安排时比较清楚。`,
    `${guestName}态度稳，不催进度，适合先从一次见面开始。`,
    `${guestName}表达直接，家庭情况说得明白。`,
    `${guestName}工作时间比较固定，见面时间好约。`,
  ][index];
  const hiddenPoints = [
    `先不要提${memberName}之前没约成的对象，也不要说还在同时看别人。`,
    `不要主动讲收入细节，也不要把${memberName}家里的催促说出去。`,
    `见面之前不要提上次推荐没成的原因。`,
    `先不要说${memberName}还在比较另外几位，等见面后再看要不要讲。`,
  ][index];
  return { progress, reason, highlights, hiddenPoints };
}
