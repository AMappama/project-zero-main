import { and, asc, eq, inArray, isNull, lte, or, type SQL } from "drizzle-orm";
import { addDays, addMonths, remainingServiceMonths } from "./calendar";
import { closeFulfillmentDb, drizzleFromPool, openFulfillmentDb, resetSchema, type AppDb } from "./db";
import type { Pool } from "mysql2/promise";
import {
  applications,
  closeVipContract,
  dealAssignments,
  meetings,
  members,
  notes,
  orderFacts,
  outboxEvents,
  recommendations,
  serviceInstances,
  serviceOwnerships,
  shopRoles,
  tasks,
  tenantSettings,
  writeGuard,
} from "./schema";
import { scoreServicePeople, type ServicePersonOption, type ServicePersonStats } from "./staffScore";
import {
  FulfillmentError,
  QUALIFIED_PAYMENTS,
  ROLE_PRIORITY,
  SALES_INVITE_NOT_IN_SERVICE_LIBRARY,
  type ApplicationStatus,
  type ApplicationType,
  type AssignDefaultResult,
  type DealRole,
  type DealSource,
  type MemberIdentity,
  type OpenedBy,
  type OpenGap,
  type OpenResult,
  type OwnershipSource,
  type PaymentStatus,
  type QuotaKind,
  type ShopRoleName,
} from "./types";

type Executor = AppDb;
type Tx = Parameters<Parameters<AppDb["transaction"]>[0]>[0];
type StaffRole = "matchmanager" | "shop_manager" | "director";

const IN_SERVICE_STATUSES = ["启用中", "暂停"] as const;
const BLOCKING_CLOSE = ["待审", "待二审", "通过"] as const;

type Settings = { autoStart: boolean; loveDraft: boolean; compatClear: boolean };

export function createFulfillment(db: AppDb) {
  return bind(db);
}

export async function openFulfillment(options?: { reset?: boolean }) {
  const { db, pool } = await openFulfillmentDb({ reset: options?.reset ?? false });
  return { crm: createFulfillment(db), pool };
}

export async function createTestFulfillment(pool: Pool) {
  await resetSchema(pool);
  return createFulfillment(drizzleFromPool(pool));
}

export { closeFulfillmentDb };

function bind(db: AppDb) {
  async function inTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return db.transaction(async (tx) => fn(tx));
  }

  return {
    async registerMember(input: { id?: number; tenantId: number; shopId: number; createdAt: string }) {
      return inTx(async (tx) => {
        const inserted = await insertId(tx.insert(members).values({
            id: input.id,
            tenantId: input.tenantId,
            shopId: input.shopId,
            maturity: null,
            memberType: "普通",
            createdAt: input.createdAt,
          }));
        return await requireMember(tx, input.id ?? inserted);
      });
    },

    async registerOrderFact(input: {
      id?: number;
      tenantId: number;
      shopId: number;
      memberId: number;
      orderTime: string;
      paymentStatus: PaymentStatus;
      contractCheckStatus: number;
      durationMonths: number;
      plannedStart: string;
      activityTotal?: number;
      emotionTotal?: number;
      oneOnOneTotal?: number;
      imageTotal?: number;
    }) {
      return inTx(async (tx) => {
        const member = await requireMember(tx, input.memberId);
        if (member.tenantId !== input.tenantId) {
          throw new FulfillmentError("订单租户和会员不一致");
        }
        const inserted = await insertId(tx.insert(orderFacts).values({
            id: input.id,
            tenantId: input.tenantId,
            shopId: input.shopId,
            memberId: input.memberId,
            orderTime: input.orderTime,
            paymentStatus: input.paymentStatus,
            contractCheckStatus: input.contractCheckStatus,
            durationMonths: input.durationMonths,
            plannedStart: input.plannedStart,
            activityTotal: input.activityTotal ?? 0,
            emotionTotal: input.emotionTotal ?? 0,
            oneOnOneTotal: input.oneOnOneTotal ?? 0,
            imageTotal: input.imageTotal ?? 0,
            refundStatus: "none",
          }));
        return await requireOrder(tx, input.id ?? inserted);
      });
    },

    async registerShopRole(input: { tenantId: number; shopId: number; personId: number; role: ShopRoleName }) {
      return inTx(async (tx) => {
        await tx.insert(shopRoles).values(input);
      });
    },

    async setTenantSettings(input: {
      tenantId: number;
      autoStartService?: boolean;
      autoDraftCloseOnInLove?: boolean;
      compatClearDealOwnership?: boolean;
    }) {
      return inTx(async (tx) => {
        const current = await readSettings(tx, input.tenantId);
        const next = {
          autoStartService: input.autoStartService ?? current.autoStart ? 1 : 0,
          autoDraftCloseOnInLove: input.autoDraftCloseOnInLove ?? current.loveDraft ? 1 : 0,
          compatClearDealOwnership: input.compatClearDealOwnership ?? current.compatClear ? 1 : 0,
        };
        const existing = await firstRow(tx.select().from(tenantSettings).where(eq(tenantSettings.tenantId, input.tenantId)).limit(1));
        if (existing) {
          await tx.update(tenantSettings).set(next).where(eq(tenantSettings.tenantId, input.tenantId));
        } else {
          await tx.insert(tenantSettings).values({ tenantId: input.tenantId, ...next });
        }
        return await readSettings(tx, input.tenantId);
      });
    },

    async registerDealAssignment(input: {
      tenantId: number;
      memberId: number;
      personId: number;
      role: DealRole;
      source?: DealSource;
      today: string;
    }) {
      return inTx(async (tx) =>
        await insertDealAssignment(tx, {
          ...input,
          source: input.source ?? "成交遗留",
        }),
      );
    },

    async addManualNote(input: { tenantId: number; memberId: number; body: string; createdAt: string }) {
      return inTx(async (tx) => {
        const member = await requireMember(tx, input.memberId);
        if (member.tenantId !== input.tenantId) {
          throw new FulfillmentError("小记租户和会员不一致");
        }
        const info = await firstRow(tx
          .insert(notes)
          .values({
            tenantId: input.tenantId,
            memberId: input.memberId,
            body: input.body,
            createdAt: input.createdAt,
          })
          );
      });
    },

    async assignServicePerson(input: {
      tenantId: number;
      memberId: number;
      orderId?: number | null;
      servicePersonId: number;
      today: string;
    }) {
      return inTx(async (tx) => {
        const member = await requireMember(tx, input.memberId);
        return await assignServicePersonTx(tx, {
          ...input,
          source: "指定",
          assignedViaRole: await staffRoleFor(tx, input.tenantId, member.shopId, input.servicePersonId),
        });
      });
    },

    async assignDefaultServicePerson(input: {
      tenantId: number;
      shopId: number;
      memberId: number;
      orderId?: number | null;
      today: string;
    }): Promise<AssignDefaultResult> {
      return inTx(async (tx) => await assignDefaultServicePersonTx(tx, input));
    },

    async openService(input: { orderId: number; today: string; openedBy: OpenedBy }): Promise<OpenResult> {
      return inTx(async (tx) => await openServiceTx(tx, input));
    },

    async prepareRecommendationDraft(input: {
      tenantId: number;
      memberId: number;
      guestMemberId: number;
      servicePersonId?: number;
      reason?: string | null;
      highlights?: string | null;
      hiddenPoints?: string | null;
      progress?: string | null;
      today: string;
    }) {
      return inTx(async (tx) => await prepareRecommendationDraftTx(tx, input));
    },

    async confirmRecommendation(input: {
      tenantId: number;
      memberId: number;
      guestMemberId: number;
      draftId?: number;
      progress?: string | null;
      reason?: string | null;
      highlights?: string | null;
      hiddenPoints?: string | null;
      today: string;
    }) {
      return inTx(async (tx) => {
        const member = await requireMember(tx, input.memberId);
        if (member.tenantId !== input.tenantId) {
          throw new FulfillmentError("推荐租户和会员不一致");
        }
        await requireMember(tx, input.guestMemberId);
        let progress = input.progress ?? null;
        let reason = input.reason ?? null;
        let highlights = input.highlights ?? null;
        let hiddenPoints = input.hiddenPoints ?? null;
        if (input.draftId != null) {
          const draft = await firstRow(tx.select().from(tasks).where(eq(tasks.id, input.draftId)).limit(1));
          if (!draft || draft.kind !== "推荐草稿" || draft.status !== "待确认") {
            throw new FulfillmentError("没有可确认的推荐草稿");
          }
          if (draft.memberId !== input.memberId || draft.guestMemberId !== input.guestMemberId) {
            throw new FulfillmentError("推荐草稿和会员或嘉宾不一致");
          }
          progress = progress ?? draft.progress;
          reason = reason ?? draft.reason;
          highlights = highlights ?? draft.highlights;
          hiddenPoints = hiddenPoints ?? draft.hiddenPoints;
        }
        let recommendationId: number;
        try {
          recommendationId = await insertId(tx.insert(recommendations).values({
              tenantId: input.tenantId,
              memberId: input.memberId,
              guestMemberId: input.guestMemberId,
              progress,
              reason,
              highlights,
              hiddenPoints,
              createdAt: input.today,
            }));
        } catch (error) {
          if (isUniqueViolation(error)) {
            throw new FulfillmentError("该会员与嘉宾已有推荐");
          }
          throw error;
        }
        if (input.draftId != null) {
          await tx.update(tasks)
            .set({ status: "已确认", closedAt: input.today })
            .where(eq(tasks.id, input.draftId));
        }
        return recommendationId;
      });
    },

    async confirmMeeting(input: {
      tenantId: number;
      serviceMemberId: number;
      memberId?: number | null;
      externalName?: string | null;
      meetOn?: string | null;
      place?: string | null;
      memberStatus?: string | null;
      objectStatus?: string | null;
      result?: string | null;
      feedback?: string | null;
      today: string;
    }) {
      return inTx(async (tx) => {
        const member = await requireMember(tx, input.serviceMemberId);
        if (member.tenantId !== input.tenantId) {
          throw new FulfillmentError("约会租户和会员不一致");
        }
        if (input.memberId != null) {
          await requireMember(tx, input.memberId);
        }
        if (input.memberId == null && !input.externalName) {
          throw new FulfillmentError("约会对象需要会员或外部姓名");
        }
        return await insertId(tx
          .insert(meetings)
          .values({
            tenantId: input.tenantId,
            serviceMemberId: input.serviceMemberId,
            memberId: input.memberId ?? null,
            externalName: input.externalName ?? null,
            meetOn: input.meetOn ?? null,
            place: input.place ?? null,
            memberStatus: input.memberStatus ?? null,
            objectStatus: input.objectStatus ?? null,
            result: input.result ?? null,
            feedback: input.feedback ?? null,
            createdAt: input.today,
          })
          );
      });
    },

    async recordMeetingResult(input: {
      meetingId: number;
      result?: string | null;
      feedback?: string | null;
      memberStatus?: string | null;
      objectStatus?: string | null;
    }) {
      return inTx(async (tx) => {
        const meeting = await firstRow(tx.select().from(meetings).where(eq(meetings.id, input.meetingId)).limit(1));
        if (!meeting) {
          throw new FulfillmentError("约会不存在");
        }
        await tx.update(meetings)
          .set({
            result: input.result === undefined ? meeting.result : input.result,
            feedback: input.feedback === undefined ? meeting.feedback : input.feedback,
            memberStatus: input.memberStatus === undefined ? meeting.memberStatus : input.memberStatus,
            objectStatus: input.objectStatus === undefined ? meeting.objectStatus : input.objectStatus,
          })
          .where(eq(meetings.id, input.meetingId))
          ;
      });
    },

    async filePause(input: { orderId: number; reason: string; pauseStart: string; pauseEnd: string; today: string }) {
      return inTx(async (tx) => {
        const instance = await requireInstanceByOrder(tx, input.orderId);
        if (instance.status !== "启用中") {
          throw new FulfillmentError("只有启用中的服务可以暂停");
        }
        if (!input.reason.trim()) {
          throw new FulfillmentError("暂停需要原因");
        }
        if (input.pauseEnd < input.pauseStart) {
          throw new FulfillmentError("暂停结束日不能早于开始日");
        }
        if (!instance.startedOn || input.pauseStart < instance.startedOn) {
          throw new FulfillmentError("暂停日不能早于服务开始日");
        }
        await assertNoUnfinished(tx, input.orderId, "暂停");
        return await insertApplication(tx, {
          tenantId: instance.tenantId,
          memberId: instance.memberId,
          orderId: input.orderId,
          type: "暂停",
          reason: input.reason,
          pauseStart: input.pauseStart,
          pauseEnd: input.pauseEnd,
          today: input.today,
        });
      });
    },

    async fileGift(input: {
      orderId: number;
      reason: string;
      endDays?: number;
      totalEndDays?: number;
      quotaKind?: QuotaKind;
      quotaAdd?: number;
      today: string;
    }) {
      return inTx(async (tx) => {
        const instance = await requireInstanceByOrder(tx, input.orderId);
        assertInService(instance.status, "赠送");
        if (!input.reason.trim()) {
          throw new FulfillmentError("赠送需要原因");
        }
        const hasDays = (input.endDays ?? 0) > 0 || (input.totalEndDays ?? 0) > 0;
        const hasQuota = (input.quotaAdd ?? 0) > 0;
        if (!hasDays && !hasQuota) {
          throw new FulfillmentError("赠送需要天数或某一类次数");
        }
        if (hasQuota && !input.quotaKind) {
          throw new FulfillmentError("赠送次数需要指定类别");
        }
        await assertNoUnfinished(tx, input.orderId, "赠送");
        return await insertApplication(tx, {
          tenantId: instance.tenantId,
          memberId: instance.memberId,
          orderId: input.orderId,
          type: "赠送",
          reason: input.reason,
          giftEndDays: input.endDays && input.endDays > 0 ? input.endDays : null,
          giftTotalEndDays: input.totalEndDays && input.totalEndDays > 0 ? input.totalEndDays : null,
          giftQuotaKind: hasQuota ? input.quotaKind : null,
          giftQuotaAdd: hasQuota ? input.quotaAdd : null,
          today: input.today,
        });
      });
    },

    async fileClose(input: { orderId: number; reason: string; consent?: boolean | null; today: string }) {
      return inTx(async (tx) => await fileCloseTx(tx, input));
    },

    async setCloseConsent(input: { applicationId: number; consent: boolean }) {
      return inTx(async (tx) => {
        const app = await requireApplication(tx, input.applicationId);
        if (app.type !== "关单") {
          throw new FulfillmentError("只有关单申请记录是否同意");
        }
        if (app.status !== "待审" && app.status !== "待二审") {
          throw new FulfillmentError("关单已经结束，不能再改是否同意");
        }
        await tx.update(applications)
          .set({ consent: input.consent ? 1 : 0 })
          .where(eq(applications.id, app.id))
          ;
      });
    },

    async reviewCloseFirst(input: { applicationId: number; decision: "通过" | "驳回"; today: string }) {
      return inTx(async (tx) => {
        const app = await requireApplication(tx, input.applicationId);
        if (app.type !== "关单" || app.status !== "待审") {
          throw new FulfillmentError("关单一审只处理待审的关单");
        }
        await tx.update(applications)
          .set({
            status: input.decision === "通过" ? "待二审" : "驳回",
            decidedAt: input.decision === "驳回" ? input.today : null,
          })
          .where(eq(applications.id, app.id))
          ;
      });
    },

    async reviewCloseSecond(input: { applicationId: number; decision: "通过" | "驳回"; today: string; closedBy?: number }) {
      return inTx(async (tx) => {
        const app = await requireApplication(tx, input.applicationId);
        if (app.type !== "关单" || app.status !== "待二审") {
          throw new FulfillmentError("关单二审只处理待二审的关单");
        }
        if (input.decision === "驳回") {
          await tx.update(applications)
            .set({ status: "驳回", decidedAt: input.today, closedBy: input.closedBy ?? null })
            .where(eq(applications.id, app.id))
            ;
          return;
        }
        if (app.consent === null) {
          throw new FulfillmentError("关单需要用户是否同意");
        }
        if (!app.reason?.trim()) {
          throw new FulfillmentError("关单需要原因");
        }
        if (!input.closedBy) {
          throw new FulfillmentError("关单需要关单人");
        }
        const ownership = await ownershipByMember(tx, app.memberId);
        const servicePersonId = ownership?.active ? ownership.servicePersonId : app.servicePersonId;
        if (!servicePersonId) {
          throw new FulfillmentError("关单时没有服务人");
        }
        await tx.update(applications)
          .set({
            status: "通过",
            servicePersonId,
            closedBy: input.closedBy,
            decidedAt: input.today,
          })
          .where(eq(applications.id, app.id))
          ;
        await tx.update(serviceInstances).set({ status: "完成" }).where(eq(serviceInstances.orderId, app.orderId));
        if (ownership?.active) {
          await tx.update(serviceOwnerships)
            .set({ active: 0, deactivatedAt: input.today })
            .where(eq(serviceOwnerships.id, ownership.id))
            ;
        }
        await tx.update(members).set({ maturity: "已关单" }).where(eq(members.id, app.memberId));
        await refreshIdentityCache(tx, app.memberId);
      });
    },

    async reviewPause(input: { applicationId: number; decision: "通过" | "驳回"; today: string }) {
      return inTx(async (tx) => {
        const app = await requireApplication(tx, input.applicationId);
        if (app.type !== "暂停" || app.status !== "待审") {
          throw new FulfillmentError("暂停审核只处理待审的暂停");
        }
        if (input.decision === "驳回") {
          await tx.update(applications)
            .set({ status: "驳回", decidedAt: input.today })
            .where(eq(applications.id, app.id))
            ;
          return;
        }
        const instance = await requireInstanceByOrder(tx, app.orderId);
        if (!instance.startedOn || !instance.durationMonths || !app.pauseStart) {
          throw new FulfillmentError("暂停时缺少服务起止或暂停日");
        }
        const remainingMonths = remainingServiceMonths(instance.startedOn, app.pauseStart, instance.durationMonths);
        await tx.update(applications)
          .set({ status: "通过", remainingMonths, decidedAt: input.today })
          .where(eq(applications.id, app.id))
          ;
        await tx.update(serviceInstances).set({ status: "暂停" }).where(eq(serviceInstances.id, instance.id));
        await tx.update(members).set({ maturity: "暂停" }).where(eq(members.id, instance.memberId));
        await refreshIdentityCache(tx, instance.memberId);
      });
    },

    async reviewGift(input: { applicationId: number; decision: "通过" | "驳回"; today: string }) {
      return inTx(async (tx) => {
        const app = await requireApplication(tx, input.applicationId);
        if (app.type !== "赠送" || app.status !== "待审") {
          throw new FulfillmentError("赠送审核只处理待审的赠送");
        }
        if (input.decision === "驳回") {
          await tx.update(applications)
            .set({ status: "驳回", decidedAt: input.today })
            .where(eq(applications.id, app.id))
            ;
          return;
        }
        const instance = await requireInstanceByOrder(tx, app.orderId);
        const before = quotaSnapshot(instance);
        const patch: {
          endedOn?: string;
          totalEnd?: string;
          activityTotal?: number;
          emotionTotal?: number;
          oneOnOneTotal?: number;
          imageTotal?: number;
        } = {};
        if (app.giftEndDays) {
          if (!instance.endedOn) {
            throw new FulfillmentError("实例没有结束日");
          }
          patch.endedOn = addDays(instance.endedOn, app.giftEndDays);
        }
        if (app.giftTotalEndDays) {
          const base = instance.totalEnd ?? instance.endedOn;
          if (!base) {
            throw new FulfillmentError("实例没有总结束日");
          }
          patch.totalEnd = addDays(base, app.giftTotalEndDays);
        }
        if (app.giftQuotaKind && app.giftQuotaAdd) {
          if (app.giftQuotaKind === "活动") patch.activityTotal = instance.activityTotal + app.giftQuotaAdd;
          else if (app.giftQuotaKind === "恋爱指导") patch.emotionTotal = instance.emotionTotal + app.giftQuotaAdd;
          else if (app.giftQuotaKind === "一对一") patch.oneOnOneTotal = instance.oneOnOneTotal + app.giftQuotaAdd;
          else if (app.giftQuotaKind === "形象") patch.imageTotal = instance.imageTotal + app.giftQuotaAdd;
        }
        if (Object.keys(patch).length > 0) {
          await tx.update(serviceInstances).set(patch).where(eq(serviceInstances.id, instance.id));
        }
        const afterInstance = await requireInstanceByOrder(tx, app.orderId);
        await tx.update(applications)
          .set({
            status: "通过",
            decidedAt: input.today,
            payload: JSON.stringify({ before, after: quotaSnapshot(afterInstance) }),
          })
          .where(eq(applications.id, app.id))
          ;
      });
    },

    async resumeService(input: { applicationId: number; resumeDate: string }) {
      return inTx(async (tx) => await resumeServiceTx(tx, input));
    },

    async recordExpiryLetter(input: {
      orderId: number;
      today: string;
      letterUrl?: string | null;
      status?: string;
      remark?: string | null;
    }) {
      return inTx(async (tx) => await recordExpiryLetterTx(tx, input));
    },

    async updateExpiryLetterStatus(input: { orderId: number; status: string; remark?: string | null }) {
      return inTx(async (tx) => {
        const letter = await firstRow(tx.select().from(closeVipContract).where(eq(closeVipContract.orderId, input.orderId)).limit(1));
        if (!letter) {
          throw new FulfillmentError("到期函不存在");
        }
        await tx.update(closeVipContract)
          .set({
            status: input.status,
            remark: input.remark === undefined ? letter.remark : input.remark,
          })
          .where(eq(closeVipContract.id, letter.id))
          ;
      });
    },

    async applyRefundCompleted(input: { orderId: number; today: string }) {
      return inTx(async (tx) => {
        const order = await requireOrder(tx, input.orderId);
        await tx.update(orderFacts).set({ refundStatus: "completed" }).where(eq(orderFacts.id, order.id));
        const instance = await instanceByOrder(tx, order.id);
        if (instance) {
          await tx.update(serviceInstances).set({ status: "失效" }).where(eq(serviceInstances.id, instance.id));
        }
        const ownership = await ownershipByMember(tx, order.memberId);
        if (ownership?.active && ownership.orderId === order.id) {
          await tx.update(serviceOwnerships)
            .set({ active: 0, deactivatedAt: input.today })
            .where(eq(serviceOwnerships.id, ownership.id))
            ;
        }
        await refreshIdentityCache(tx, order.memberId);
      });
    },

    async claimByMatchmaker(input: { tenantId: number; memberId: number; servicePersonId: number; today: string }) {
      return inTx(async (tx) => {
        const member = await requireMember(tx, input.memberId);
        if (member.tenantId !== input.tenantId) {
          throw new FulfillmentError("领取租户和会员不一致");
        }
        if (!await isOverdueMember(tx, input.memberId)) {
          throw new FulfillmentError("当前不在可领取的过期名单");
        }
        return await assignServicePersonTx(tx, {
          tenantId: input.tenantId,
          memberId: input.memberId,
          orderId: null,
          servicePersonId: input.servicePersonId,
          today: input.today,
          source: "红娘领取",
          assignedViaRole: "红娘领取",
        });
      });
    },

    async claimBySalesOrInvite(input: { tenantId: number; memberId: number; personId: number; role: DealRole; today: string }) {
      return inTx(async (tx) => {
        const member = await requireMember(tx, input.memberId);
        if (member.tenantId !== input.tenantId) {
          throw new FulfillmentError("领取租户和会员不一致");
        }
        if (input.role !== "销售" && input.role !== "邀约") {
          throw new FulfillmentError("销售或邀约领取才走这个入口");
        }
        if (!await isOverdueMember(tx, input.memberId)) {
          throw new FulfillmentError("当前不在可领取的过期名单");
        }
        const dealAssignmentId = await insertDealAssignment(tx, {
          tenantId: input.tenantId,
          memberId: input.memberId,
          personId: input.personId,
          role: input.role,
          source: "关单后领取",
          today: input.today,
        });
        return {
          accepted: true as const,
          inServiceLibrary: false as const,
          dealAssignmentId,
          reason: SALES_INVITE_NOT_IN_SERVICE_LIBRARY,
        };
      });
    },

    async consumeServiceStarted(input: { eventId: number; today: string }) {
      return inTx(async (tx) => {
        const event = await firstRow(tx.select().from(outboxEvents).where(eq(outboxEvents.id, input.eventId)).limit(1));
        if (!event || event.type !== "ServiceStarted") {
          throw new FulfillmentError("ServiceStarted 事件不存在");
        }
        if (!event.consumedAt) {
          await tx.update(outboxEvents).set({ consumedAt: input.today }).where(eq(outboxEvents.id, event.id));
        }
      });
    },

    async memberIdentity(memberId: number): Promise<MemberIdentity> {
      return inTx(async (tx) => await memberIdentityTx(tx, memberId));
    },

    async listServiceLibrary(input: { tenantId: number; servicePersonId: number; shopId?: number }) {
      return inTx(async (tx) => {
        const filters: SQL[] = [
          eq(serviceOwnerships.tenantId, input.tenantId),
          eq(serviceOwnerships.servicePersonId, input.servicePersonId),
          eq(serviceOwnerships.active, 1),
          eq(serviceOwnerships.assignRole, "服务"),
        ];
        if (input.shopId !== undefined) {
          filters.push(eq(serviceOwnerships.shopId, input.shopId));
        }
        const ownershipRows = await tx.select().from(serviceOwnerships).where(and(...filters));
        const out = [];
        for (const ownership of ownershipRows) {
          const rows = await instancesOfMember(tx, ownership.memberId);
          const live = rows.some((row) => row.status === "待启用" || row.status === "启用中" || row.status === "暂停");
          if (!live && ownership.source !== "红娘领取") continue;
          out.push({
            memberId: ownership.memberId,
            servicePersonId: ownership.servicePersonId,
            shopId: ownership.shopId,
            tenantId: ownership.tenantId,
            source: ownership.source,
          });
        }
        return out;
      });
    },

    async listOverdueVip(input: { tenantId: number; shopId?: number }) {
      return inTx(async (tx) => await listOverdueVipTx(tx, input));
    },

    async listInProgress(input: { tenantId: number }) {
      return inTx(async (tx) => {
        const apps = await tx
          .select()
          .from(applications)
          .where(
            and(
              eq(applications.tenantId, input.tenantId),
              or(eq(applications.status, "待审"), and(eq(applications.type, "关单"), eq(applications.status, "待二审"))),
            ),
          );
        return apps.map((app) => ({
          id: app.id,
          type: app.type as ApplicationType,
          status: app.status as ApplicationStatus,
          memberId: app.memberId,
          orderId: app.orderId,
        }));
      });
    },

    async listPendingOpen(input: { tenantId: number; servicePersonId?: number }) {
      return inTx(async (tx) => await listByStatus(tx, input, ["待启用"]));
    },

    async listInService(input: { tenantId: number; servicePersonId?: number }) {
      return inTx(async (tx) => await listByStatus(tx, input, ["启用中", "暂停"]));
    },

    async listApproachingEnd(input: { tenantId: number; today: string; withinDays?: number }) {
      return inTx(async (tx) => {
        const until = addDays(input.today, input.withinDays ?? 7);
        const instances = await tx
          .select()
          .from(serviceInstances)
          .where(and(eq(serviceInstances.tenantId, input.tenantId), inArray(serviceInstances.status, [...IN_SERVICE_STATUSES])));
        return instances
          .filter((instance) => instance.totalEnd != null && instance.totalEnd >= input.today && instance.totalEnd <= until)
          .map(toInstanceSummary);
      });
    },

    async listMeetingsMissingResult(input: { tenantId: number; today: string }) {
      return inTx(async (tx) => {
        const rows = await tx.select().from(meetings).where(eq(meetings.tenantId, input.tenantId));
        return rows
          .filter(
            (meeting) =>
              meeting.meetOn != null &&
              meeting.meetOn <= input.today &&
              (meeting.result == null || meeting.result === "待确认" || meeting.result === "待见面"),
          )
          .map((meeting) => ({
            id: meeting.id,
            serviceMemberId: meeting.serviceMemberId,
            meetOn: meeting.meetOn,
            result: meeting.result,
          }));
      });
    },

    async listAssignableServicePeople(input: { tenantId: number; roles: ShopRoleName[] }): Promise<ServicePersonOption[]> {
      return inTx(async (tx) => {
        if (input.roles.length === 0) return [];
        const roleRows = await tx
          .select()
          .from(shopRoles)
          .where(and(eq(shopRoles.tenantId, input.tenantId), inArray(shopRoles.role, input.roles)));
        const roleRank: Record<ShopRoleName, number> = { matchmanager: 0, shop_manager: 1, director: 2 };
        const chosen = new Map<number, ShopRoleName>();
        for (const row of roleRows) {
          const role = row.role as ShopRoleName;
          const current = chosen.get(row.personId);
          if (!current || roleRank[role] < roleRank[current]) chosen.set(row.personId, role);
        }
        const ownerships = await tx.select().from(serviceOwnerships).where(eq(serviceOwnerships.tenantId, input.tenantId));
        const instances = await tx.select().from(serviceInstances).where(eq(serviceInstances.tenantId, input.tenantId));
        const closes = await tx
          .select()
          .from(applications)
          .where(and(eq(applications.tenantId, input.tenantId), eq(applications.type, "关单")));
        const stats: ServicePersonStats[] = [...chosen.entries()].map(([personId, role]) => {
          const active = ownerships.filter((row) => row.active === 1 && row.servicePersonId === personId);
          const memberIds = new Set(active.map((row) => row.memberId));
          const theirs = instances.filter((row) => memberIds.has(row.memberId));
          const ownCloses = closes.filter((row) => row.servicePersonId === personId);
          return {
            personId,
            role,
            servedCount: active.length,
            activeCount: theirs.filter((row) => row.status === "启用中").length,
            pausedCount: theirs.filter((row) => row.status === "暂停").length,
            pendingCount: theirs.filter((row) => row.status === "待启用").length,
            approvedCloses: ownCloses.filter((row) => row.status === "通过").length,
            rejectedCloses: ownCloses.filter((row) => row.status === "驳回").length,
          };
        });
        return scoreServicePeople(stats);
      });
    },

    async listStaffingExceptions(input: { tenantId: number }) {
      return inTx(async (tx) => {
        const rows = await tx
          .select()
          .from(serviceOwnerships)
          .where(
            and(
              eq(serviceOwnerships.tenantId, input.tenantId),
              eq(serviceOwnerships.active, 1),
              inArray(serviceOwnerships.assignedViaRole, ["shop_manager", "director"]),
            ),
          );
        return rows.map((ownership) => ({
          memberId: ownership.memberId,
          servicePersonId: ownership.servicePersonId,
          assignedViaRole: ownership.assignedViaRole,
          shopId: ownership.shopId,
        }));
      });
    },

    async listDualOwnership(input: { tenantId: number }) {
      return inTx(async (tx) => {
        const ownerships = await tx
          .select()
          .from(serviceOwnerships)
          .where(and(eq(serviceOwnerships.tenantId, input.tenantId), eq(serviceOwnerships.active, 1)));
        const out = [];
        for (const ownership of ownerships) {
          const deals = await activeDealRows(tx, ownership.memberId);
          if (deals.length === 0) continue;
          out.push({
            memberId: ownership.memberId,
            servicePersonId: ownership.servicePersonId,
            dealAssignmentIds: deals.map((row) => row.id),
          });
        }
        return out;
      });
    },

    async listDealClaims(input: { tenantId: number; role?: DealRole }) {
      return inTx(async (tx) => {
        const filters: SQL[] = [
          eq(dealAssignments.tenantId, input.tenantId),
          eq(dealAssignments.active, 1),
          eq(dealAssignments.source, "关单后领取"),
        ];
        if (input.role) filters.push(eq(dealAssignments.role, input.role));
        const rows = await tx.select().from(dealAssignments).where(and(...filters));
        return rows.map((row) => ({
          id: row.id,
          memberId: row.memberId,
          personId: row.personId,
          role: row.role,
        }));
      });
    },

    async listPendingJudgement(input: { tenantId: number }) {
      return inTx(async (tx) => ({
        recommendationDrafts: await tx
          .select()
          .from(tasks)
          .where(and(eq(tasks.tenantId, input.tenantId), eq(tasks.kind, "推荐草稿"), eq(tasks.status, "待确认"))),
        closeSuggestions: await tx
          .select()
          .from(tasks)
          .where(and(eq(tasks.tenantId, input.tenantId), eq(tasks.kind, "关单建议"), eq(tasks.status, "待确认"))),
      }));
    },

    async careSignals(memberId: number, today: string) {
      return inTx(async (tx) => {
        await requireMember(tx, memberId);
        const signals: string[] = [];
        const ownership = await ownershipByMember(tx, memberId);
        const rows = await instancesOfMember(tx, memberId);
        if (
          ownership?.active &&
          ownership.assignedAt >= addDays(today, -7) &&
          rows.some((row) => row.status === "待启用" || row.status === "启用中")
        ) {
          signals.push("新分");
        }
        const active = rows.find((row) => row.status === "启用中");
        if (active) {
          const noteRows = await tx.select().from(notes).where(eq(notes.memberId, memberId));
          const meetingContactRows = await tx.select().from(meetings).where(eq(meetings.serviceMemberId, memberId));
          const recommendationRows = await tx.select().from(recommendations).where(eq(recommendations.memberId, memberId));
          const contactDates = [
            ...noteRows.map((note) => note.createdAt),
            ...meetingContactRows.map((meeting) => meeting.meetOn ?? meeting.createdAt),
            ...recommendationRows.map((row) => row.createdAt),
          ];
          const baseline = contactDates.sort().at(-1) ?? active.startedOn ?? ownership?.assignedAt;
          if (baseline && baseline <= addDays(today, -8)) {
            signals.push("超过7天未联系");
          }
        }
        const meetingRows = await tx.select().from(meetings).where(eq(meetings.serviceMemberId, memberId));
        if (meetingRows.some((meeting) => meeting.result === "已见面")) signals.push("已见面");
        if (meetingRows.some((meeting) => meeting.result === "恋爱")) signals.push("确认恋爱");
        if (rows.some((row) => row.status === "暂停")) signals.push("暂停");
        return signals;
      });
    },

    async runAutomatic(input: {
      today: string;
      tenantId?: number;
      recommendationCandidates?: Array<{
        memberId: number;
        guestMemberId: number;
        servicePersonId?: number;
        reason?: string | null;
      }>;
    }) {
      return inTx(async (tx) => {
        const result = {
          opened: [] as number[],
          missingServicePerson: [] as { orderId: number; memberId: number; message: "缺服务人" }[],
          awaitingConfirmOpen: [] as number[],
          staffingExceptions: [] as { orderId: number; memberId: number; servicePersonId: number; role: string }[],
          resumed: [] as number[],
          draftedCloses: [] as number[],
          closeSuggestions: [] as number[],
          expiryLetters: [] as number[],
          assignedDefaults: [] as number[],
          recommendationDrafts: [] as number[],
        };
        const orders =
          input.tenantId === undefined
            ? await tx.select().from(orderFacts)
            : await tx.select().from(orderFacts).where(eq(orderFacts.tenantId, input.tenantId));
        for (const order of orders) {
          if (!paymentQualified(order.paymentStatus) || order.contractCheckStatus !== 1) {
            continue;
          }
          let instance = await instanceByOrder(tx, order.id);
          if (!instance) {
            await ensurePending(tx, order);
            instance = await requireInstanceByOrder(tx, order.id);
            await refreshIdentityCache(tx, order.memberId);
          }
          if (instance.status !== "待启用") {
            continue;
          }
          const ownership = await ownershipByMember(tx, order.memberId);
          let active = ownership?.active ? ownership : null;
          if (!active) {
            const assigned = await assignDefaultServicePersonTx(tx, {
              tenantId: order.tenantId,
              shopId: order.shopId,
              memberId: order.memberId,
              orderId: order.id,
              today: input.today,
            });
            if (!assigned.ok) {
              result.missingServicePerson.push({ orderId: order.id, memberId: order.memberId, message: "缺服务人" });
              continue;
            }
            if (!assigned.alreadyAssigned) {
              result.assignedDefaults.push(order.id);
            }
            if (assigned.assignedViaRole === "shop_manager" || assigned.assignedViaRole === "director") {
              result.staffingExceptions.push({
                orderId: order.id,
                memberId: order.memberId,
                servicePersonId: assigned.servicePersonId,
                role: assigned.assignedViaRole,
              });
            }
            active = await ownershipByMember(tx, order.memberId) ?? null;
          }
          if (order.plannedStart > input.today) {
            continue;
          }
          const settings = await readSettings(tx, order.tenantId);
          if (!settings.autoStart) {
            result.awaitingConfirmOpen.push(order.id);
            continue;
          }
          const opened = await openServiceTx(tx, { orderId: order.id, today: input.today, openedBy: "system" });
          if (opened.ok) {
            result.opened.push(order.id);
          }
        }

        const pauseFilters: SQL[] = [
          eq(applications.type, "暂停"),
          eq(applications.status, "通过"),
          isNull(applications.resumedAt),
          lte(applications.pauseEnd, input.today),
        ];
        if (input.tenantId !== undefined) pauseFilters.push(eq(applications.tenantId, input.tenantId));
        const duePauses = await tx.select().from(applications).where(and(...pauseFilters));
        for (const pause of duePauses) {
          const instance = await instanceByOrder(tx, pause.orderId);
          if (instance?.status !== "暂停") continue;
          await resumeServiceTx(tx, { applicationId: pause.id, resumeDate: input.today });
          result.resumed.push(pause.orderId);
        }

        const instanceFilters: SQL[] = [inArray(serviceInstances.status, ["启用中", "暂停", "完成"])];
        if (input.tenantId !== undefined) instanceFilters.push(eq(serviceInstances.tenantId, input.tenantId));
        const instances = await tx.select().from(serviceInstances).where(and(...instanceFilters));
        for (const instance of instances) {
          const settings = await readSettings(tx, instance.tenantId);
          const expired = instance.totalEnd != null && instance.totalEnd <= input.today;
          if (expired) {
            const letter = await recordExpiryLetterTx(tx, { orderId: instance.orderId, today: input.today });
            if (letter.created) result.expiryLetters.push(instance.orderId);
          }
          const live = instance.status === "启用中" || instance.status === "暂停";
          if (!live) continue;
          const loveMeetings = await tx
            .select()
            .from(meetings)
            .where(eq(meetings.serviceMemberId, instance.memberId));
          const love = loveMeetings.some((meeting) => meeting.result === "恋爱");
          const blocking = await hasBlockingClose(tx, instance.orderId);
          if (expired && !blocking) {
            await fileCloseTx(tx, { orderId: instance.orderId, reason: "到期", consent: null, today: input.today });
            result.draftedCloses.push(instance.orderId);
          } else if (love && !blocking && !expired) {
            if (settings.loveDraft) {
              await fileCloseTx(tx, { orderId: instance.orderId, reason: "恋爱", consent: null, today: input.today });
              result.draftedCloses.push(instance.orderId);
            } else {
              const suggestion = await ensureCloseSuggestion(tx, instance, input.today);
              if (suggestion.created) result.closeSuggestions.push(instance.orderId);
            }
          }
        }

        for (const candidate of input.recommendationCandidates ?? []) {
          const member = await requireMember(tx, candidate.memberId);
          const draft = await prepareRecommendationDraftTx(tx, {
            tenantId: member.tenantId,
            memberId: candidate.memberId,
            guestMemberId: candidate.guestMemberId,
            servicePersonId: candidate.servicePersonId,
            reason: candidate.reason,
            today: input.today,
          });
          if (draft.created && draft.id) result.recommendationDrafts.push(draft.id);
        }
        return result;
      });
    },

    async getTenantSettings(tenantId: number) {
      return inTx(async (tx) => await readSettings(tx, tenantId));
    },

    async listOrderFacts(input: { tenantId: number }) {
      return inTx(async (tx) => await tx.select().from(orderFacts).where(eq(orderFacts.tenantId, input.tenantId)));
    },

    async listApplications(input: { tenantId: number }) {
      return inTx(async (tx) => await tx.select().from(applications).where(eq(applications.tenantId, input.tenantId)));
    },

    async listMeetings(input: { tenantId: number }) {
      return inTx(async (tx) => await tx.select().from(meetings).where(eq(meetings.tenantId, input.tenantId)));
    },

    async listInstances(input: { tenantId: number; memberId?: number }) {
      return inTx(async (tx) => {
        const filters: SQL[] = [eq(serviceInstances.tenantId, input.tenantId)];
        if (input.memberId !== undefined) filters.push(eq(serviceInstances.memberId, input.memberId));
        return await tx.select().from(serviceInstances).where(and(...filters));
      });
    },

    async getMember(memberId: number) {
      return inTx(async (tx) => (await firstRow(tx.select().from(members).where(eq(members.id, memberId)).limit(1))) ?? null);
    },

    async getServiceInstanceByOrder(orderId: number) {
      return inTx(async (tx) => await instanceByOrder(tx, orderId) ?? null);
    },

    async getOwnership(memberId: number) {
      return inTx(async (tx) => await ownershipByMember(tx, memberId) ?? null);
    },

    async getApplication(applicationId: number) {
      return inTx(async (tx) => (await firstRow(tx.select().from(applications).where(eq(applications.id, applicationId)).limit(1))) ?? null);
    },

    async getExpiryLetter(orderId: number) {
      return inTx(async (tx) => (await firstRow(tx.select().from(closeVipContract).where(eq(closeVipContract.orderId, orderId)).limit(1))) ?? null);
    },

    async listNotes(memberId: number) {
      return inTx(async (tx) => await tx.select().from(notes).where(eq(notes.memberId, memberId)));
    },

    async listEvents(orderId: number) {
      return inTx(async (tx) => await tx.select().from(outboxEvents).where(eq(outboxEvents.orderId, orderId)));
    },

    async listDealAssignments(memberId: number) {
      return inTx(async (tx) => await tx.select().from(dealAssignments).where(eq(dealAssignments.memberId, memberId)));
    },

    async listRecommendations(memberId: number) {
      return inTx(async (tx) => await tx.select().from(recommendations).where(eq(recommendations.memberId, memberId)));
    },

    async listOpenRecommendationDrafts(input: { tenantId: number }) {
      return inTx(async (tx) =>
        await tx
          .select()
          .from(tasks)
          .where(and(eq(tasks.tenantId, input.tenantId), eq(tasks.kind, "推荐草稿"), eq(tasks.status, "待确认"))),
      );
    },
  };
}

export type Fulfillment = ReturnType<typeof createFulfillment>;

async function assignServicePersonTx(
  tx: Tx,
  input: {
    tenantId: number;
    memberId: number;
    orderId?: number | null;
    servicePersonId: number;
    today: string;
    source: OwnershipSource;
    assignedViaRole: StaffRole | "红娘领取" | null;
  },
) {
  const member = await requireMember(tx, input.memberId);
  if (member.tenantId !== input.tenantId) {
    throw new FulfillmentError("归属租户和会员不一致");
  }
  const existing = await ownershipByMember(tx, input.memberId);
  const values = {
    tenantId: input.tenantId,
    shopId: member.shopId,
    orderId: input.orderId ?? null,
    servicePersonId: input.servicePersonId,
    assignRole: "服务" as const,
    source: input.source,
    assignedViaRole: input.assignedViaRole,
    active: 1,
    assignedAt: input.today,
    deactivatedAt: null,
  };
  if (existing) {
    await tx.update(serviceOwnerships).set(values).where(eq(serviceOwnerships.id, existing.id));
    return existing.id;
  }
  return await insertId(tx.insert(serviceOwnerships).values({ ...values, memberId: input.memberId }));
}

async function assignDefaultServicePersonTx(
  tx: Tx,
  input: { tenantId: number; shopId: number; memberId: number; orderId?: number | null; today: string },
): Promise<AssignDefaultResult> {
  const existing = await ownershipByMember(tx, input.memberId);
  if (existing?.active) {
    return {
      ok: true,
      servicePersonId: existing.servicePersonId,
      alreadyAssigned: true,
      assignedViaRole: existing.assignedViaRole,
    };
  }
  const roles = await tx
    .select()
    .from(shopRoles)
    .where(and(eq(shopRoles.tenantId, input.tenantId), eq(shopRoles.shopId, input.shopId)))
    .orderBy(asc(shopRoles.personId))
    ;
  for (const role of ROLE_PRIORITY) {
    const person = roles.find((row) => row.role === role);
    if (!person) continue;
    await assignServicePersonTx(tx, {
      tenantId: input.tenantId,
      memberId: input.memberId,
      orderId: input.orderId,
      servicePersonId: person.personId,
      today: input.today,
      source: "默认",
      assignedViaRole: role,
    });
    return { ok: true, servicePersonId: person.personId, alreadyAssigned: false, assignedViaRole: role };
  }
  return { ok: false, message: "缺服务人" };
}

async function openServiceTx(tx: Tx, input: { orderId: number; today: string; openedBy: OpenedBy }): Promise<OpenResult> {
  const order = await firstRow(tx.select().from(orderFacts).where(eq(orderFacts.id, input.orderId)).limit(1));
  const missing: OpenGap[] = [];
  if (!order || !paymentQualified(order.paymentStatus)) missing.push("订单");
  if (order && order.contractCheckStatus !== 1) missing.push("合同");
  if (!order) return { ok: false, missing };
  const ownership = await ownershipByMember(tx, order.memberId);
  if (!ownership?.active) missing.push("缺服务人");
  if (order.plannedStart > input.today) missing.push("计划开始日");
  const settings = await readSettings(tx, order.tenantId);
  if (input.openedBy === "system" && !settings.autoStart) missing.push("确认开启");
  const contractAndPaymentOk = paymentQualified(order.paymentStatus) && order.contractCheckStatus === 1;
  if (!contractAndPaymentOk) return { ok: false, missing };
  let instance = await instanceByOrder(tx, order.id);
  if (!instance) {
    await ensurePending(tx, order);
    instance = await requireInstanceByOrder(tx, order.id);
  }
  if (instance.status === "启用中") {
    return { ok: true, instanceId: instance.id, status: "启用中" };
  }
  if (instance.status !== "待启用") {
    throw new FulfillmentError("只有待启用的实例可以开启");
  }
  if (missing.length > 0) {
    await refreshIdentityCache(tx, order.memberId);
    return { ok: false, missing };
  }
  const end = addMonths(order.plannedStart, order.durationMonths);
  const openedBy = input.openedBy === "system" ? "system" : String(input.openedBy);
  const audit = {
    paymentStatus: order.paymentStatus,
    contractCheckStatus: order.contractCheckStatus,
    servicePersonId: ownership!.servicePersonId,
    plannedStart: order.plannedStart,
    today: input.today,
    openedBy,
  };
  await tx.update(serviceInstances)
    .set({
      status: "启用中",
      plannedStart: order.plannedStart,
      startedOn: order.plannedStart,
      endedOn: end,
      totalEnd: end,
      durationMonths: order.durationMonths,
      activityTotal: order.activityTotal,
      activityUsed: 0,
      emotionTotal: order.emotionTotal,
      emotionUsed: 0,
      oneOnOneTotal: order.oneOnOneTotal,
      oneOnOneUsed: 0,
      imageTotal: order.imageTotal,
      imageUsed: 0,
      openedBy,
      openAudit: JSON.stringify(audit),
    })
    .where(eq(serviceInstances.id, instance.id))
    ;
  await tx.update(members).set({ maturity: "新升级" }).where(eq(members.id, order.memberId));
  const cleared = await activeDealRows(tx, order.memberId);
  if (settings.compatClear) {
    for (const row of cleared) {
      await tx.update(dealAssignments)
        .set({ active: 0, deactivatedAt: input.today })
        .where(eq(dealAssignments.id, row.id))
        ;
    }
  }
  await tx.insert(outboxEvents)
    .values({
      tenantId: order.tenantId,
      type: "ServiceStarted",
      memberId: order.memberId,
      orderId: order.id,
      workerId: ownership!.servicePersonId,
      payload: JSON.stringify({
        memberId: order.memberId,
        orderId: order.id,
        workerId: ownership!.servicePersonId,
        openedBy,
        compatCleanupExecuted: settings.compatClear,
        clearedDealAssignmentIds: settings.compatClear ? cleared.map((row) => row.id) : [],
      }),
      createdAt: input.today,
      consumedAt: null,
    })
    ;
  await refreshIdentityCache(tx, order.memberId);
  return { ok: true, instanceId: instance.id, status: "启用中" };
}

async function fileCloseTx(tx: Tx, input: { orderId: number; reason: string; consent?: boolean | null; today: string }) {
  const instance = await requireInstanceByOrder(tx, input.orderId);
  assertInService(instance.status, "关单");
  if (!input.reason.trim()) throw new FulfillmentError("关单需要原因");
  await assertNoUnfinished(tx, input.orderId, "关单");
  const ownership = await ownershipByMember(tx, instance.memberId);
  const created = await insertApplication(tx, {
    tenantId: instance.tenantId,
    memberId: instance.memberId,
    orderId: input.orderId,
    type: "关单",
    reason: input.reason,
    consent: input.consent === undefined || input.consent === null ? null : input.consent ? 1 : 0,
    servicePersonId: ownership?.active ? ownership.servicePersonId : null,
    today: input.today,
  });
  await tx
    .update(tasks)
    .set({ status: "已确认", closedAt: input.today })
    .where(and(eq(tasks.orderId, input.orderId), eq(tasks.kind, "关单建议"), eq(tasks.status, "待确认")));
  return created;
}

async function resumeServiceTx(tx: Tx, input: { applicationId: number; resumeDate: string }) {
  const app = await requireApplication(tx, input.applicationId);
  if (app.type !== "暂停" || app.status !== "通过" || app.resumedAt) {
    throw new FulfillmentError("没有可恢复的暂停");
  }
  if (app.remainingMonths == null) throw new FulfillmentError("暂停申请没有剩余时长");
  const instance = await requireInstanceByOrder(tx, app.orderId);
  if (instance.status !== "暂停") throw new FulfillmentError("实例不是暂停");
  const newEnd = addMonths(input.resumeDate, app.remainingMonths);
  const totalEnd = instance.totalEnd && instance.totalEnd > newEnd ? instance.totalEnd : newEnd;
  await tx.update(serviceInstances)
    .set({ status: "启用中", endedOn: newEnd, totalEnd })
    .where(eq(serviceInstances.id, instance.id))
    ;
  await tx.update(applications).set({ resumedAt: input.resumeDate }).where(eq(applications.id, app.id));
  await refreshIdentityCache(tx, instance.memberId);
}

async function recordExpiryLetterTx(
  tx: Tx,
  input: { orderId: number; today: string; letterUrl?: string | null; status?: string; remark?: string | null },
) {
  const existing = await firstRow(tx.select().from(closeVipContract).where(eq(closeVipContract.orderId, input.orderId)).limit(1));
  if (existing) return { created: false as const, id: existing.id };
  const instance = await requireInstanceByOrder(tx, input.orderId);
  const ownership = await ownershipByMember(tx, instance.memberId);
  const id = await insertId(
    tx.insert(closeVipContract).values({
      tenantId: instance.tenantId,
      memberId: instance.memberId,
      servicePersonId: ownership?.servicePersonId ?? null,
      orderId: input.orderId,
      serviceStart: instance.startedOn,
      serviceEnd: instance.totalEnd ?? instance.endedOn,
      letterUrl: input.letterUrl ?? null,
      status: input.status ?? "已发送",
      remark: input.remark ?? null,
      createdAt: input.today,
    }),
  );
  return { created: true as const, id };
}

async function prepareRecommendationDraftTx(
  tx: Tx,
  input: {
    tenantId: number;
    memberId: number;
    guestMemberId: number;
    servicePersonId?: number;
    reason?: string | null;
    highlights?: string | null;
    hiddenPoints?: string | null;
    progress?: string | null;
    today: string;
  },
) {
  const member = await requireMember(tx, input.memberId);
  if (member.tenantId !== input.tenantId) throw new FulfillmentError("推荐租户和会员不一致");
  await requireMember(tx, input.guestMemberId);
  const ownership = await ownershipByMember(tx, input.memberId);
  if (!ownership?.active) throw new FulfillmentError("只能给已有服务人的会员准备推荐");
  if (input.servicePersonId != null && ownership.servicePersonId !== input.servicePersonId) {
    throw new FulfillmentError("只能准备自己名下会员的推荐");
  }
  const existingFact = await firstRow(tx
    .select()
    .from(recommendations)
    .where(and(eq(recommendations.memberId, input.memberId), eq(recommendations.guestMemberId, input.guestMemberId))).limit(1));
  if (existingFact) return { created: false as const, id: null };
  const existingDraft = await firstRow(tx
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.memberId, input.memberId),
        eq(tasks.guestMemberId, input.guestMemberId),
        eq(tasks.kind, "推荐草稿"),
        eq(tasks.status, "待确认"),
      ),
    )
    .limit(1));
  if (existingDraft) return { created: false as const, id: existingDraft.id };
  const id = await insertId(
    tx.insert(tasks).values({
      tenantId: input.tenantId,
      shopId: member.shopId,
      memberId: input.memberId,
      kind: "推荐草稿",
      status: "待确认",
      orderId: null,
      guestMemberId: input.guestMemberId,
      reason: input.reason ?? null,
      highlights: input.highlights ?? null,
      hiddenPoints: input.hiddenPoints ?? null,
      progress: input.progress ?? null,
      createdAt: input.today,
      closedAt: null,
    }),
  );
  return { created: true as const, id };
}

async function ensureCloseSuggestion(tx: Tx, instance: typeof serviceInstances.$inferSelect, today: string) {
  const existing = await firstRow(tx
    .select()
    .from(tasks)
    .where(and(eq(tasks.orderId, instance.orderId), eq(tasks.kind, "关单建议"), eq(tasks.status, "待确认"))).limit(1));
  if (existing) return { created: false as const, id: existing.id };
  const id = await insertId(
    tx.insert(tasks).values({
      tenantId: instance.tenantId,
      shopId: instance.shopId,
      memberId: instance.memberId,
      kind: "关单建议",
      status: "待确认",
      orderId: instance.orderId,
      guestMemberId: null,
      reason: "恋爱",
      highlights: null,
      hiddenPoints: null,
      progress: null,
      createdAt: today,
      closedAt: null,
    }),
  );
  return { created: true as const, id };
}

async function memberIdentityTx(tx: Tx, memberId: number): Promise<MemberIdentity> {
  await requireMember(tx, memberId);
  const rows = await tx
    .select({ status: serviceInstances.status, orderTime: orderFacts.orderTime })
    .from(serviceInstances)
    .innerJoin(orderFacts, eq(orderFacts.id, serviceInstances.orderId))
    .where(eq(serviceInstances.memberId, memberId))
    ;
  if (rows.length === 0) return "普通";
  if (rows.some((row) => row.status === "启用中")) return "VIP";
  if (rows.some((row) => row.status === "暂停")) return "暂停";
  if (rows.some((row) => row.status === "待启用")) return "待开启";
  const latest = rows.reduce((best, row) => (row.orderTime > best.orderTime ? row : best));
  if (latest.status === "完成") return "过期 VIP";
  if (latest.status === "失效") return "退费";
  return "普通";
}

async function refreshIdentityCache(tx: Tx, memberId: number) {
  const identity = await memberIdentityTx(tx, memberId);
  await tx.update(writeGuard).set({ allowIdentityCache: 1 }).where(eq(writeGuard.id, 1));
  await tx.update(members).set({ memberType: identity }).where(eq(members.id, memberId));
  await tx.update(writeGuard).set({ allowIdentityCache: 0 }).where(eq(writeGuard.id, 1));
}

async function listOverdueVipTx(tx: Tx, input: { tenantId: number; shopId?: number }) {
    const completedFilters: SQL[] = [eq(serviceInstances.tenantId, input.tenantId), eq(serviceInstances.status, "完成")];
    if (input.shopId !== undefined) completedFilters.push(eq(serviceInstances.shopId, input.shopId));
    const completed = await tx.select().from(serviceInstances).where(and(...completedFilters));
  const membersSeen = new Set<number>();
  const rows = [];
  for (const instance of completed) {
    if (membersSeen.has(instance.memberId)) continue;
    if (!await isOverdueMember(tx, instance.memberId)) continue;
    membersSeen.add(instance.memberId);
    const approved = await approvedClose(tx, instance.memberId);
    if (!approved) continue;
    rows.push({
      memberId: instance.memberId,
      orderId: approved.orderId,
      consent: approved.consent === 1,
      reason: approved.reason,
      closedBy: approved.closedBy,
      servicePersonId: approved.servicePersonId,
    });
  }
  return rows;
}

async function isOverdueMember(tx: Tx, memberId: number): Promise<boolean> {
  const completed = (await instancesOfMember(tx, memberId)).some((row) => row.status === "完成");
  if (!completed) return false;
  const approved = await approvedClose(tx, memberId);
  if (!approved || approved.consent == null || !approved.reason || approved.closedBy == null || approved.servicePersonId == null) {
    return false;
  }
  const ownership = await ownershipByMember(tx, memberId);
  if (ownership?.active && ownership.assignRole === "服务") return false;
  const claimed = await firstRow(tx
    .select()
    .from(dealAssignments)
    .where(
      and(
        eq(dealAssignments.memberId, memberId),
        eq(dealAssignments.active, 1),
        eq(dealAssignments.source, "关单后领取"),
      ),
    )
    .limit(1),);
  return !claimed;
}

async function approvedClose(tx: Tx, memberId: number) {
  const rows = await tx
    .select()
    .from(applications)
    .where(and(eq(applications.memberId, memberId), eq(applications.type, "关单"), eq(applications.status, "通过")));
  return rows.at(-1) ?? null;
}

async function listByStatus(tx: Tx, input: { tenantId: number; servicePersonId?: number }, statuses: readonly string[]) {
  const instances = await tx
    .select()
    .from(serviceInstances)
    .where(and(eq(serviceInstances.tenantId, input.tenantId), inArray(serviceInstances.status, [...statuses])));
  const out = [];
  for (const instance of instances) {
    if (input.servicePersonId !== undefined) {
      const ownership = await ownershipByMember(tx, instance.memberId);
      if (!(ownership?.active === 1 && ownership.servicePersonId === input.servicePersonId)) continue;
    }
    out.push(toInstanceSummary(instance));
  }
  return out;
}

function toInstanceSummary(instance: typeof serviceInstances.$inferSelect) {
  return { memberId: instance.memberId, orderId: instance.orderId, status: instance.status, totalEnd: instance.totalEnd };
}

function quotaSnapshot(instance: typeof serviceInstances.$inferSelect) {
  return {
    endedOn: instance.endedOn,
    totalEnd: instance.totalEnd,
    activityTotal: instance.activityTotal,
    activityUsed: instance.activityUsed,
    emotionTotal: instance.emotionTotal,
    emotionUsed: instance.emotionUsed,
    oneOnOneTotal: instance.oneOnOneTotal,
    oneOnOneUsed: instance.oneOnOneUsed,
    imageTotal: instance.imageTotal,
    imageUsed: instance.imageUsed,
  };
}

async function ensurePending(tx: Tx, order: typeof orderFacts.$inferSelect) {
  if (await instanceByOrder(tx, order.id)) return;
  await tx.insert(serviceInstances)
    .values({
      tenantId: order.tenantId,
      shopId: order.shopId,
      memberId: order.memberId,
      orderId: order.id,
      status: "待启用",
      plannedStart: order.plannedStart,
      activityTotal: 0,
      activityUsed: 0,
      emotionTotal: 0,
      emotionUsed: 0,
      oneOnOneTotal: 0,
      oneOnOneUsed: 0,
      imageTotal: 0,
      imageUsed: 0,
      openedBy: null,
      openAudit: null,
    })
    ;
}

async function insertApplication(
  tx: Tx,
  input: {
    tenantId: number;
    memberId: number;
    orderId: number;
    type: ApplicationType;
    reason: string;
    today: string;
    consent?: number | null;
    servicePersonId?: number | null;
    giftEndDays?: number | null;
    giftTotalEndDays?: number | null;
    giftQuotaKind?: string | null;
    giftQuotaAdd?: number | null;
    pauseStart?: string | null;
    pauseEnd?: string | null;
  },
) {
  return await insertId(
    tx.insert(applications).values({
      tenantId: input.tenantId,
      memberId: input.memberId,
      orderId: input.orderId,
      type: input.type,
      status: "待审",
      consent: input.consent ?? null,
      reason: input.reason,
      servicePersonId: input.servicePersonId ?? null,
      closedBy: null,
      giftEndDays: input.giftEndDays ?? null,
      giftTotalEndDays: input.giftTotalEndDays ?? null,
      giftQuotaKind: input.giftQuotaKind ?? null,
      giftQuotaAdd: input.giftQuotaAdd ?? null,
      payload: null,
      pauseStart: input.pauseStart ?? null,
      pauseEnd: input.pauseEnd ?? null,
      resumedAt: null,
      remainingMonths: null,
      createdAt: input.today,
      decidedAt: null,
    }),
  );
}

async function insertDealAssignment(
  tx: Tx,
  input: { tenantId: number; memberId: number; personId: number; role: DealRole; source: DealSource; today: string },
) {
  const member = await requireMember(tx, input.memberId);
  return await insertId(tx
    .insert(dealAssignments)
    .values({
      tenantId: input.tenantId,
      shopId: member.shopId,
      memberId: input.memberId,
      personId: input.personId,
      role: input.role,
      source: input.source,
      active: 1,
      createdAt: input.today,
      deactivatedAt: null,
    })
    );
}

async function readSettings(tx: Tx, tenantId: number): Promise<Settings> {
  const settingsRow = await firstRow(
    tx.select().from(tenantSettings).where(eq(tenantSettings.tenantId, tenantId)).limit(1),
  );
  if (!settingsRow) return { autoStart: true, loveDraft: false, compatClear: true };
  return {
    autoStart: settingsRow.autoStartService === 1,
    loveDraft: settingsRow.autoDraftCloseOnInLove === 1,
    compatClear: settingsRow.compatClearDealOwnership === 1,
  };
}

async function staffRoleFor(tx: Tx, tenantId: number, shopId: number, personId: number): Promise<StaffRole | null> {
  const roleRows = await tx
    .select()
    .from(shopRoles)
    .where(and(eq(shopRoles.tenantId, tenantId), eq(shopRoles.shopId, shopId), eq(shopRoles.personId, personId)));
  const roles = roleRows.map((row) => row.role);
  if (roles.includes("matchmanager")) return "matchmanager";
  if (roles.includes("shop_manager")) return "shop_manager";
  if (roles.includes("director")) return "director";
  return null;
}

async function hasBlockingClose(tx: Tx, orderId: number) {
  const apps = await tx
    .select()
    .from(applications)
    .where(and(eq(applications.orderId, orderId), eq(applications.type, "关单")));
  return apps.some((app) => BLOCKING_CLOSE.includes(app.status as (typeof BLOCKING_CLOSE)[number]));
}

async function assertNoUnfinished(tx: Tx, orderId: number, type: ApplicationType) {
  const apps = await tx
    .select()
    .from(applications)
    .where(and(eq(applications.orderId, orderId), eq(applications.type, type)));
  const unfinished = apps.some((app) => app.status === "待审" || (type === "关单" && app.status === "待二审"));
  if (unfinished) throw new FulfillmentError(`已有未完成的${type}申请`);
}

function assertInService(status: string, action: string) {
  if (status !== "启用中" && status !== "暂停") {
    throw new FulfillmentError(`${action}只适用于启用中或暂停的服务`);
  }
}

function paymentQualified(status: string): boolean {
  return QUALIFIED_PAYMENTS.includes(status as (typeof QUALIFIED_PAYMENTS)[number]);
}

async function activeDealRows(tx: Tx, memberId: number) {
  return await tx
    .select()
    .from(dealAssignments)
    .where(and(eq(dealAssignments.memberId, memberId), eq(dealAssignments.active, 1)))
    ;
}

async function requireMember(tx: Tx, memberId: number) {
  const member = await firstRow(tx.select().from(members).where(eq(members.id, memberId)).limit(1));
  if (!member) throw new FulfillmentError("会员不存在");
  return member;
}

async function requireOrder(tx: Tx, orderId: number) {
  const order = await firstRow(tx.select().from(orderFacts).where(eq(orderFacts.id, orderId)).limit(1));
  if (!order) throw new FulfillmentError("订单不存在");
  return order;
}

async function instanceByOrder(tx: Tx, orderId: number) {
  return await firstRow(tx.select().from(serviceInstances).where(eq(serviceInstances.orderId, orderId)).limit(1));
}

async function requireInstanceByOrder(tx: Tx, orderId: number) {
  const instance = await instanceByOrder(tx, orderId);
  if (!instance) throw new FulfillmentError("服务实例不存在");
  return instance;
}

async function instancesOfMember(tx: Tx, memberId: number) {
  return await tx.select().from(serviceInstances).where(eq(serviceInstances.memberId, memberId));
}

async function ownershipByMember(tx: Tx, memberId: number) {
  return await firstRow(tx.select().from(serviceOwnerships).where(eq(serviceOwnerships.memberId, memberId)).limit(1));
}

async function requireApplication(tx: Tx, applicationId: number) {
  const app = await firstRow(tx.select().from(applications).where(eq(applications.id, applicationId)).limit(1));
  if (!app) throw new FulfillmentError("申请不存在");
  return app;
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; errno?: number };
  return e.code === "ER_DUP_ENTRY" || e.errno === 1062;
}

async function insertId(query: PromiseLike<unknown>): Promise<number> {
  const result = await query;
  const header = (result as [{ insertId: number }])[0];
  return Number(header.insertId);
}

async function firstRow<T>(promise: Promise<T[]>): Promise<T | undefined> {
  const rows = await promise;
  return rows[0];
}
