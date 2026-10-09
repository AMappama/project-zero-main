import { prepareServedDrafts } from "./drafts";
import type { Fulfillment } from "./fulfillment";

/** 演示日。启动时用现有写入铺开 2026-09-30 的服务跟进样本。 */
export const WORKBENCH = {
  today: "2026-09-30",
  tenantId: 1,
  shopId: 1,
  emptyShopId: 2,
  managerShopId: 3,
  servicePersonId: 20,
  shopManagerId: 21,
  reviewerId: 30,
  judgementMemberId: 101,
  exceptionMemberId: 102,
  reviewMemberId: 103,
  guestMemberId: 104,
  meetingMemberId: 105,
  expiryMemberId: 106,
  loveMemberId: 108,
  paymentMemberId: 109,
  futureMemberId: 110,
  managerMemberId: 111,
  pauseFileMemberId: 112,
  giftFileMemberId: 113,
  closeFileMemberId: 114,
  resumeMemberId: 115,
  pauseReviewMemberId: 116,
  closeSecondMemberId: 117,
  judgementOrderId: 201,
  exceptionOrderId: 202,
  reviewOrderId: 203,
  meetingOrderId: 205,
  expiryOrderId: 206,
  loveOrderId: 208,
  paymentOrderId: 209,
  futureOrderId: 210,
  managerOrderId: 211,
  pauseFileOrderId: 212,
  giftFileOrderId: 213,
  closeFileOrderId: 214,
  resumeOrderId: 215,
  pauseReviewOrderId: 216,
  closeSecondOrderId: 217,
} as const;

export async function seedWorkbench(crm: Fulfillment) {
  if (await crm.getMember(WORKBENCH.judgementMemberId)) return { seeded: false as const };
  const today = WORKBENCH.today;
  const tenantId = WORKBENCH.tenantId;

  await crm.registerShopRole({ tenantId, shopId: WORKBENCH.shopId, personId: WORKBENCH.servicePersonId, role: "matchmanager" });
  await crm.registerShopRole({ tenantId, shopId: WORKBENCH.shopId, personId: 22, role: "matchmanager" });
  await crm.registerShopRole({ tenantId, shopId: WORKBENCH.shopId, personId: 23, role: "matchmanager" });
  await crm.registerShopRole({ tenantId, shopId: WORKBENCH.shopId, personId: 24, role: "director" });
  await crm.registerShopRole({ tenantId, shopId: WORKBENCH.managerShopId, personId: WORKBENCH.shopManagerId, role: "shop_manager" });

  const member = async (id: number, shopId: number) => await crm.registerMember({ id, tenantId, shopId, createdAt: today });
  await member(WORKBENCH.judgementMemberId, WORKBENCH.shopId);
  await member(WORKBENCH.exceptionMemberId, WORKBENCH.emptyShopId);
  await member(WORKBENCH.reviewMemberId, WORKBENCH.shopId);
  await member(WORKBENCH.guestMemberId, WORKBENCH.shopId);
  await member(WORKBENCH.meetingMemberId, WORKBENCH.shopId);
  await member(WORKBENCH.expiryMemberId, WORKBENCH.shopId);
  await member(WORKBENCH.loveMemberId, WORKBENCH.shopId);
  await member(WORKBENCH.paymentMemberId, WORKBENCH.shopId);
  await member(WORKBENCH.futureMemberId, WORKBENCH.shopId);
  await member(WORKBENCH.managerMemberId, WORKBENCH.managerShopId);
  await member(WORKBENCH.pauseFileMemberId, WORKBENCH.shopId);
  await member(WORKBENCH.giftFileMemberId, WORKBENCH.shopId);
  await member(WORKBENCH.closeFileMemberId, WORKBENCH.shopId);
  await member(WORKBENCH.resumeMemberId, WORKBENCH.shopId);
  await member(WORKBENCH.pauseReviewMemberId, WORKBENCH.shopId);
  await member(WORKBENCH.closeSecondMemberId, WORKBENCH.shopId);

  const order = async (input: {
    id: number;
    memberId: number;
    shopId: number;
    paymentStatus?: "unpaid" | "payable" | "paid";
    contractCheckStatus?: number;
    plannedStart?: string;
    durationMonths?: number;
  }) =>
    await crm.registerOrderFact({
      id: input.id,
      tenantId,
      shopId: input.shopId,
      memberId: input.memberId,
      orderTime: `${input.plannedStart ?? "2026-09-01"}T09:00:00`,
      paymentStatus: input.paymentStatus ?? "paid",
      contractCheckStatus: input.contractCheckStatus ?? 1,
      durationMonths: input.durationMonths ?? 6,
      plannedStart: input.plannedStart ?? "2026-09-01",
      activityTotal: 2,
      emotionTotal: 4,
      oneOnOneTotal: 2,
      imageTotal: 1,
    });

  await order({ id: WORKBENCH.judgementOrderId, memberId: WORKBENCH.judgementMemberId, shopId: WORKBENCH.shopId });
  await order({ id: WORKBENCH.exceptionOrderId, memberId: WORKBENCH.exceptionMemberId, shopId: WORKBENCH.emptyShopId });
  await order({ id: WORKBENCH.reviewOrderId, memberId: WORKBENCH.reviewMemberId, shopId: WORKBENCH.shopId });
  await order({ id: WORKBENCH.meetingOrderId, memberId: WORKBENCH.meetingMemberId, shopId: WORKBENCH.shopId });
  await order({
    id: WORKBENCH.expiryOrderId,
    memberId: WORKBENCH.expiryMemberId,
    shopId: WORKBENCH.shopId,
    plannedStart: "2025-01-01",
    durationMonths: 6,
  });
  await order({ id: WORKBENCH.loveOrderId, memberId: WORKBENCH.loveMemberId, shopId: WORKBENCH.shopId });
  await order({
    id: WORKBENCH.paymentOrderId,
    memberId: WORKBENCH.paymentMemberId,
    shopId: WORKBENCH.shopId,
    paymentStatus: "unpaid",
    contractCheckStatus: 0,
  });
  await order({
    id: WORKBENCH.futureOrderId,
    memberId: WORKBENCH.futureMemberId,
    shopId: WORKBENCH.shopId,
    plannedStart: "2026-12-01",
  });
  await order({ id: WORKBENCH.managerOrderId, memberId: WORKBENCH.managerMemberId, shopId: WORKBENCH.managerShopId });
  await order({ id: WORKBENCH.pauseFileOrderId, memberId: WORKBENCH.pauseFileMemberId, shopId: WORKBENCH.shopId });
  await order({ id: WORKBENCH.giftFileOrderId, memberId: WORKBENCH.giftFileMemberId, shopId: WORKBENCH.shopId });
  await order({ id: WORKBENCH.closeFileOrderId, memberId: WORKBENCH.closeFileMemberId, shopId: WORKBENCH.shopId });
  await order({
    id: WORKBENCH.resumeOrderId,
    memberId: WORKBENCH.resumeMemberId,
    shopId: WORKBENCH.shopId,
    plannedStart: "2026-06-01",
    durationMonths: 6,
  });
  await order({ id: WORKBENCH.pauseReviewOrderId, memberId: WORKBENCH.pauseReviewMemberId, shopId: WORKBENCH.shopId });
  await order({ id: WORKBENCH.closeSecondOrderId, memberId: WORKBENCH.closeSecondMemberId, shopId: WORKBENCH.shopId });

  await crm.assignServicePerson({
    tenantId,
    memberId: WORKBENCH.paymentMemberId,
    orderId: WORKBENCH.paymentOrderId,
    servicePersonId: WORKBENCH.servicePersonId,
    today,
  });

  await crm.runAutomatic({ today, tenantId });

  const drafted = (await crm.listApplications({ tenantId })).find(
    (app) => app.orderId === WORKBENCH.expiryOrderId && app.type === "关单",
  );
  if (!drafted) throw new Error("到期关单没有起草");
  await crm.setCloseConsent({ applicationId: drafted.id, consent: true });

  await crm.confirmMeeting({
    tenantId,
    serviceMemberId: WORKBENCH.meetingMemberId,
    memberId: WORKBENCH.guestMemberId,
    meetOn: "2026-09-20",
    place: "门店会客室",
    today,
  });
  await crm.confirmMeeting({
    tenantId,
    serviceMemberId: WORKBENCH.loveMemberId,
    memberId: WORKBENCH.guestMemberId,
    meetOn: "2026-10-15",
    result: "恋爱",
    today,
  });
  await crm.runAutomatic({ today, tenantId });

  await crm.fileGift({
    orderId: WORKBENCH.reviewOrderId,
    reason: "恋爱指导次数不够用",
    quotaKind: "恋爱指导",
    quotaAdd: 2,
    today,
  });
  await crm.filePause({
    orderId: WORKBENCH.pauseReviewOrderId,
    reason: "会员出差",
    pauseStart: "2026-09-30",
    pauseEnd: "2026-11-30",
    today,
  });
  const resumeId = await crm.filePause({
    orderId: WORKBENCH.resumeOrderId,
    reason: "回老家一个月",
    pauseStart: "2026-08-01",
    pauseEnd: "2026-11-30",
    today,
  });
  await crm.reviewPause({ applicationId: resumeId, decision: "通过", today });
  const secondCloseId = await crm.fileClose({
    orderId: WORKBENCH.closeSecondOrderId,
    reason: "双方同意提前结束",
    consent: true,
    today,
  });
  await crm.reviewCloseFirst({ applicationId: secondCloseId, decision: "通过", today });

  await prepareServedDrafts(crm, { tenantId, servicePersonId: WORKBENCH.servicePersonId, today });

  return { seeded: true as const };
}
