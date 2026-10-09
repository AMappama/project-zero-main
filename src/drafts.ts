import type { Fulfillment } from "./fulfillment";

/** 不打分。只说明这位客人已在同一服务库、还没有推荐事实。 */
export const LIBRARY_DRAFT_REASON = "同在服务库，尚未推荐";

export function chooseLibraryGuest(memberId: number, libraryIds: number[], alreadyRecommended: Iterable<number>) {
  const taken = new Set(alreadyRecommended);
  for (const guestId of libraryIds) {
    if (guestId !== memberId && !taken.has(guestId)) return guestId;
  }
  return null;
}

/**
 * 给这位红娘名下、仍在服务库里的每位会员准备一条待确认推荐。
 * 客人取库内会员编号最小、且不是本人、也还没有推荐事实的一位。
 * 只写待确认草稿，不写推荐事实。已有待确认草稿的会员不再补一条。
 */
export async function prepareServedDrafts(
  crm: Fulfillment,
  input: { tenantId: number; servicePersonId: number; today: string },
) {
  const libraryIds = (await crm.listServiceLibrary({ tenantId: input.tenantId, servicePersonId: input.servicePersonId }))
    .map((row) => row.memberId)
    .sort((left, right) => left - right);
  const open = new Set(
    (await crm.listOpenRecommendationDrafts({ tenantId: input.tenantId })).map((row) => row.memberId),
  );
  const prepared: { memberId: number; guestMemberId: number }[] = [];
  for (const memberId of libraryIds) {
    if (open.has(memberId)) continue;
    const guestMemberId = chooseLibraryGuest(
      memberId,
      libraryIds,
      (await crm.listRecommendations(memberId)).map((row) => row.guestMemberId),
    );
    if (guestMemberId == null) continue;
    const result = await crm.prepareRecommendationDraft({
      tenantId: input.tenantId,
      memberId,
      guestMemberId,
      servicePersonId: input.servicePersonId,
      reason: LIBRARY_DRAFT_REASON,
      today: input.today,
    });
    if (result.id) {
      open.add(memberId);
      prepared.push({ memberId, guestMemberId });
    }
  }
  return prepared;
}
