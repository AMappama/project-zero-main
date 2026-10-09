import type { Fulfillment } from "./fulfillment";
import { QUALIFIED_PAYMENTS } from "./types";

/** 和开启写入同一组缺口名称，查询只读，不调用 openService。 */
const OPEN_FACTS = ["订单", "合同", "缺服务人", "计划开始日", "确认开启"] as const;

/** runAutomatic 起草关单时写入的原因。页面用它把到期草稿和已恋爱草稿放进待判断。 */
const DRAFTED_CLOSE_REASONS = new Set(["到期", "恋爱"]);

export type HomeKind =
  | "推荐草稿"
  | "见面结果"
  | "起草关单"
  | "关单建议"
  | "开启缺口"
  | "换人"
  | "要暂停"
  | "要赠送"
  | "提前关单"
  | "提前恢复"
  | "赠送"
  | "暂停"
  | "关单";

export type HomeItem = {
  key: string;
  kind: HomeKind;
  title: string;
  detail: string;
  memberId: number | null;
  orderId: number | null;
  applicationId: number | null;
  taskId: number | null;
  meetingId: number | null;
  guestMemberId: number | null;
  facts: string[];
  applicationStatus: string | null;
  consent: boolean | null;
  reason: string | null;
  level: "一审" | "二审" | null;
  highlights: string | null;
  hiddenPoints: string | null;
  progress: string | null;
  summary: string | null;
  todayFacts: string[];
};

export type HomeScreen = {
  today: string;
  tenantId: number;
  judgement: HomeItem[];
  exceptions: HomeItem[];
  reviews: HomeItem[];
  filing: {
    liveOrders: { orderId: number; memberId: number; status: string }[];
    pauses: { applicationId: number; orderId: number; memberId: number; pauseEnd: string | null }[];
  };
};

const FACT_COPY: Record<string, string> = {
  订单: "付款还不够，订单还不能开启。",
  合同: "合同还没审核通过。",
  缺服务人: "还没有服务人。门店的红娘、店长、总监都没有可写的人。",
  计划开始日: "计划开始日还没到，到那一天再开启。",
  确认开启: "订单、合同、服务人和计划开始日都已经满足。本租户关掉了自动开启，需要有权限的人确认一次。",
};

const FACT_TITLE: Record<string, string> = {
  订单: "付款还不够",
  合同: "合同还没通过",
  缺服务人: "缺服务人",
  计划开始日: "计划开始日还没到",
  确认开启: "等确认开启",
};

function paymentOk(status: string) {
  return (QUALIFIED_PAYMENTS as readonly string[]).includes(status);
}

function consentOf(value: number | null | undefined): boolean | null {
  if (value == null) return null;
  return value === 1;
}

function consentSentence(consent: boolean | null) {
  if (consent == null) return "用户是否同意还没记下。";
  return consent ? "用户同意关单。" : "用户不同意关单。";
}

function roleLabel(role: string | null) {
  if (role === "shop_manager") return "店长";
  if (role === "director") return "总监";
  return role ?? "其他角色";
}

function blank(memberId: number | null = null): HomeItem {
  return {
    key: "",
    kind: "开启缺口",
    title: "",
    detail: "",
    memberId,
    orderId: null,
    applicationId: null,
    taskId: null,
    meetingId: null,
    guestMemberId: null,
    facts: [],
    applicationStatus: null,
    consent: null,
    reason: null,
    level: null,
    highlights: null,
    hiddenPoints: null,
    progress: null,
    summary: null,
    todayFacts: [],
  };
}

function giftSentence(app: {
  giftQuotaKind: string | null;
  giftQuotaAdd: number | null;
  giftEndDays: number | null;
  giftTotalEndDays: number | null;
}) {
  const parts: string[] = [];
  if (app.giftQuotaKind && app.giftQuotaAdd) parts.push(`${app.giftQuotaKind}增加 ${app.giftQuotaAdd} 次`);
  if (app.giftEndDays) parts.push(`结束日延长 ${app.giftEndDays} 天`);
  if (app.giftTotalEndDays) parts.push(`总结束日延长 ${app.giftTotalEndDays} 天`);
  return parts.join("，");
}

function openFacts(input: {
  paymentStatus: string;
  contractCheckStatus: number;
  hasPerson: boolean;
  plannedStart: string;
  today: string;
  autoStart: boolean;
}) {
  const facts: string[] = [];
  if (!paymentOk(input.paymentStatus)) facts.push("订单");
  if (input.contractCheckStatus !== 1) facts.push("合同");
  if (!input.hasPerson) facts.push("缺服务人");
  if (input.plannedStart > input.today) facts.push("计划开始日");
  if (!input.autoStart) facts.push("确认开启");
  return facts.filter((fact) => (OPEN_FACTS as readonly string[]).includes(fact));
}

export async function loadHome(crm: Fulfillment, input: { tenantId: number; today: string }): Promise<HomeScreen> {
  const settings = await crm.getTenantSettings(input.tenantId);
  const orders = await crm.listOrderFacts({ tenantId: input.tenantId });
  const instances = await crm.listInstances({ tenantId: input.tenantId });
  const applications = await crm.listApplications({ tenantId: input.tenantId });
  const pending = await crm.listPendingJudgement({ tenantId: input.tenantId });
  const meetings = await crm.listMeetingsMissingResult({ tenantId: input.tenantId, today: input.today });
  const staffing = await crm.listStaffingExceptions({ tenantId: input.tenantId });
  const instanceByOrder = new Map(instances.map((row) => [row.orderId, row]));

  const judgement: HomeItem[] = [];

  for (const draft of pending.recommendationDrafts) {
    const item = blank(draft.memberId);
    item.key = `draft-${draft.id}`;
    item.kind = "推荐草稿";
    item.title = "待确认推荐";
    item.taskId = draft.id;
    item.guestMemberId = draft.guestMemberId;
    item.reason = draft.reason;
    item.highlights = draft.highlights;
    item.hiddenPoints = draft.hiddenPoints;
    item.progress = draft.progress;
    item.detail = `会员 ${draft.memberId} 有一份待确认推荐，嘉宾是会员 ${draft.guestMemberId ?? "未定"}。理由：${draft.reason || "还没写"}。确认之后才写入推荐事实，不改成熟度，也不写系统小记。`;
    judgement.push(item);
  }

  for (const meeting of meetings) {
    const item = blank(meeting.serviceMemberId);
    item.key = `meeting-${meeting.id}`;
    item.kind = "见面结果";
    item.title = "见面结果到点了";
    item.meetingId = meeting.id;
    item.detail = `会员 ${meeting.serviceMemberId} 的约会在 ${meeting.meetOn} 已经到点，结果还没落上。请选已见面、未见面、取消或恋爱，并可以写双方反馈。`;
    judgement.push(item);
  }

  for (const app of applications) {
    if (app.type !== "关单") continue;
    if (app.status !== "待审" && app.status !== "待二审") continue;
    if (!app.reason || !DRAFTED_CLOSE_REASONS.has(app.reason)) continue;
    const consent = consentOf(app.consent);
    if (consent != null) continue;
    const item = blank(app.memberId);
    item.key = `drafted-close-${app.id}`;
    item.kind = "起草关单";
    item.title = app.reason === "恋爱" ? "已恋爱起草的关单" : "到期起草的关单";
    item.orderId = app.orderId;
    item.applicationId = app.id;
    item.applicationStatus = app.status;
    item.consent = consent;
    item.reason = app.reason;
    item.detail = `会员 ${app.memberId}，订单 ${app.orderId}。系统因「${app.reason}」起草了关单，还没有审核。${consentSentence(consent)}实例保持原状。`;
    judgement.push(item);
  }

  for (const suggestion of pending.closeSuggestions) {
    const alreadyFiled = applications.some(
      (app) =>
        app.orderId === suggestion.orderId &&
        app.type === "关单" &&
        (app.status === "待审" || app.status === "待二审" || app.status === "通过"),
    );
    if (alreadyFiled) continue;
    const item = blank(suggestion.memberId);
    item.key = `suggest-${suggestion.id}`;
    item.kind = "关单建议";
    item.title = "已恋爱，建议关单";
    item.taskId = suggestion.id;
    item.orderId = suggestion.orderId;
    item.reason = suggestion.reason;
    item.detail = `会员 ${suggestion.memberId}，订单 ${suggestion.orderId ?? "未定"}。约会结果已是恋爱。这是关单建议，没有建立关单申请，也没有代填是否同意。恋爱不等于立即关单。`;
    judgement.push(item);
  }

  const exceptions: HomeItem[] = [];
  for (const order of orders) {
    const instance = instanceByOrder.get(order.id);
    if (instance && instance.status !== "待启用") continue;
    const ownership = await crm.getOwnership(order.memberId);
    const facts = openFacts({
      paymentStatus: order.paymentStatus,
      contractCheckStatus: order.contractCheckStatus,
      hasPerson: ownership?.active === 1,
      plannedStart: order.plannedStart,
      today: input.today,
      autoStart: settings.autoStart,
    });
    if (facts.length === 0) continue;
    const item = blank(order.memberId);
    item.key = `gap-${order.id}`;
    item.kind = "开启缺口";
    item.orderId = order.id;
    item.facts = facts;
    item.title = facts.length === 1 ? FACT_TITLE[facts[0]] : "还不能开启";
    item.detail = `会员 ${order.memberId}，订单 ${order.id}。${facts.map((fact) => FACT_COPY[fact]).join("")}`;
    exceptions.push(item);
  }

  for (const row of staffing) {
    const item = blank(row.memberId);
    item.key = `staff-${row.memberId}`;
    item.kind = "换人";
    item.title = row.assignedViaRole === "director" ? "落到总监，待换红娘" : "落到店长，待换红娘";
    item.detail = `会员 ${row.memberId} 当前服务人是${roleLabel(row.assignedViaRole)}（人员 ${row.servicePersonId}）。这是高优例外，请换成门店红娘。`;
    exceptions.push(item);
  }

  for (const app of applications) {
    if (app.type !== "暂停" || app.status !== "通过" || app.resumedAt) continue;
    const instance = instanceByOrder.get(app.orderId);
    if (instance?.status !== "暂停") continue;
    if (!app.pauseEnd || app.pauseEnd <= input.today) continue;
    const item = blank(app.memberId);
    item.key = `resume-${app.id}`;
    item.kind = "提前恢复";
    item.title = "可以提前恢复";
    item.orderId = app.orderId;
    item.applicationId = app.id;
    item.detail = `会员 ${app.memberId} 的暂停还没到结束日 ${app.pauseEnd}。提前恢复和到点恢复用同一次写入：新的结束日是恢复日加上还剩的服务月。`;
    exceptions.push(item);
  }

  const occupied = new Set<number>();
  for (const item of [...judgement, ...exceptions]) {
    if (item.memberId != null) occupied.add(item.memberId);
  }

  const reviews: HomeItem[] = [];
  for (const app of applications) {
    const pendingReview = app.status === "待审" || (app.type === "关单" && app.status === "待二审");
    if (!pendingReview) continue;
    const item = blank(app.memberId);
    item.key = `review-${app.id}`;
    item.orderId = app.orderId;
    item.applicationId = app.id;
    item.applicationStatus = app.status;
    item.reason = app.reason;
    item.consent = consentOf(app.consent);
    if (app.type === "赠送") {
      item.kind = "赠送";
      item.title = "赠送待审";
      const gift = giftSentence(app);
      item.detail = `会员 ${app.memberId}，订单 ${app.orderId}。原因：${app.reason || "没写原因"}。${gift ? `${gift}。` : ""}审核人一次通过或驳回。通过后只增加总量或延长结束日，已用不动，服务状态不变。`;
    } else if (app.type === "暂停") {
      item.kind = "暂停";
      item.title = "暂停待审";
      item.detail = `会员 ${app.memberId}，订单 ${app.orderId}。${app.pauseStart} 至 ${app.pauseEnd}。原因：${app.reason || "没写原因"}。一次审核。通过后实例改为暂停，结束日和总结束日不动。`;
    } else {
      item.kind = "关单";
      item.level = app.status === "待二审" ? "二审" : "一审";
      item.title = item.level === "二审" ? "关单二审" : "关单一审";
      item.detail = `会员 ${app.memberId}，订单 ${app.orderId}。原因：${app.reason || "没写原因"}。${consentSentence(item.consent)}当前是${item.level}。一审通过只把申请改为待二审，不改服务实例。二审通过才完成，并且需要用户是否同意、原因、关单人和关单前服务人。`;
    }
    reviews.push(item);
    if (item.memberId != null) occupied.add(item.memberId);
  }

  const filingCycle = ["要暂停", "要赠送", "提前关单"] as const;
  const quiet = instances
    .filter((row) => row.status === "启用中" && !occupied.has(row.memberId))
    .sort((a, b) => a.orderId - b.orderId);
  let cycle = 0;
  for (const row of quiet) {
    let chosen: (typeof filingCycle)[number] | null = null;
    for (let attempt = 0; attempt < filingCycle.length; attempt += 1) {
      const kind = filingCycle[(cycle + attempt) % filingCycle.length];
      const type = kind === "要暂停" ? "暂停" : kind === "要赠送" ? "赠送" : "关单";
      const blocked = applications.some(
        (app) => app.orderId === row.orderId && app.type === type && (app.status === "待审" || app.status === "待二审"),
      );
      if (!blocked) {
        chosen = kind;
        cycle = (cycle + attempt + 1) % filingCycle.length;
        break;
      }
    }
    if (!chosen) continue;
    const item = blank(row.memberId);
    item.key = `file-${chosen}-${row.orderId}`;
    item.kind = chosen;
    item.orderId = row.orderId;
    if (chosen === "要暂停") {
      item.title = "要暂停";
      item.detail = `会员 ${row.memberId}，订单 ${row.orderId} 正在服务。若要暂停，由红娘对这一单发起。通过之前不改结束日。`;
    } else if (chosen === "要赠送") {
      item.title = "要赠送";
      item.detail = `会员 ${row.memberId}，订单 ${row.orderId} 正在服务。若要赠送次数或延长结束日，由红娘对这一单发起。通过后才改总量或结束日，已用不动。`;
    } else {
      item.title = "要提前关单";
      item.detail = `会员 ${row.memberId}，订单 ${row.orderId} 正在服务。若要提前结束，由红娘发起关单。这一步只新增申请，不改服务实例。`;
    }
    exceptions.push(item);
  }

  const rank = (kind: HomeKind, order: HomeKind[]) => order.indexOf(kind);
  judgement.sort((a, b) => rank(a.kind, ["推荐草稿", "见面结果", "起草关单", "关单建议"]) - rank(b.kind, ["推荐草稿", "见面结果", "起草关单", "关单建议"]) || a.key.localeCompare(b.key));
  exceptions.sort((a, b) => rank(a.kind, ["开启缺口", "换人", "要暂停", "要赠送", "提前关单", "提前恢复"]) - rank(b.kind, ["开启缺口", "换人", "要暂停", "要赠送", "提前关单", "提前恢复"]) || a.key.localeCompare(b.key));
  reviews.sort((a, b) => (a.applicationId ?? 0) - (b.applicationId ?? 0));
  for (const item of [...judgement, ...exceptions, ...reviews]) attachNarrative(item, input.today);

  return {
    today: input.today,
    tenantId: input.tenantId,
    judgement,
    exceptions,
    reviews,
    filing: {
      liveOrders: instances
        .filter((row) => row.status === "启用中" || row.status === "暂停")
        .map((row) => ({ orderId: row.orderId, memberId: row.memberId, status: row.status }))
        .sort((a, b) => a.orderId - b.orderId),
      pauses: applications
        .filter((app) => app.type === "暂停" && app.status === "通过" && !app.resumedAt)
        .map((app) => ({
          applicationId: app.id,
          orderId: app.orderId,
          memberId: app.memberId,
          pauseEnd: app.pauseEnd,
        })),
    },
  };
}

const SUMMARY: Record<HomeKind, string> = {
  推荐草稿: "推荐草稿还没确认",
  见面结果: "见面结果还没落上",
  起草关单: "关单草稿还没记完是否同意",
  关单建议: "已恋爱，建议关单，还没建申请",
  开启缺口: "还有开启条件没满足",
  换人: "服务人还不是门店红娘",
  要暂停: "这一单可以发起暂停",
  要赠送: "这一单可以发起赠送",
  提前关单: "这一单可以发起提前关单",
  提前恢复: "暂停还没到结束日，可以提前恢复",
  赠送: "赠送还等审核",
  暂停: "暂停还等审核",
  关单: "关单还等审核",
};

function attachNarrative(item: HomeItem, today: string) {
  item.summary = item.kind === "起草关单" && item.reason === "恋爱" ? "已恋爱，关单草稿还没记下是否同意" : SUMMARY[item.kind];
  const dates = item.detail.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
  item.todayFacts = dates.map((day) => {
    const gap = dayGap(today, day);
    return gap ? `${day}，${gap}` : day;
  });
}

function dayGap(today: string, day: string) {
  const start = Date.parse(`${day}T00:00:00Z`);
  const end = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "";
  const diff = Math.round((end - start) / 86_400_000);
  if (diff > 0) return `距今天已过 ${diff} 天`;
  if (diff === 0) return "就是今天";
  return `距今天还有 ${-diff} 天`;
}
