import type { Pool } from "mysql2/promise";
import { ACCOUNTS, accountFromCookie, clearSessionCookie, hasPermission, sessionCookie, signIn, signOut, type Account } from "./accounts";
import { suggestRecommendation } from "./ai/recommendation";
import { suggestStaffFit } from "./ai/staffFit";
import { prepareServedDrafts } from "./drafts";
import type { Fulfillment } from "./fulfillment";
import { loadHome } from "./home";
import { emptyProfile, getProfile, listProfiles, saveManualProfile } from "./profiles";
import { countAchievements } from "./readouts";
import { WORKBENCH } from "./seed";
import { FulfillmentError, type DealRole, type QuotaKind, type ShopRoleName } from "./types";

type Outcome = { status: number; body: unknown; setCookie?: string };

const REVIEW_PATHS = new Set([
  "/api/actions/review-close-first",
  "/api/actions/review-close-second",
  "/api/actions/review-pause",
  "/api/actions/review-gift",
]);

const MATCHMAKER_PATHS = new Set([
  "/api/actions/assign-service-person",
  "/api/actions/prepare-recommendation-draft",
  "/api/actions/suggest-recommendation-copy",
  "/api/actions/confirm-recommendation",
  "/api/actions/confirm-meeting",
  "/api/actions/record-meeting-result",
  "/api/actions/file-pause",
  "/api/actions/file-gift",
  "/api/actions/file-close",
  "/api/actions/set-close-consent",
  "/api/actions/resume-service",
  "/api/actions/claim-by-matchmaker",
]);

function fail(error: unknown): Outcome {
  if (error instanceof FulfillmentError) return { status: 400, body: { error: error.message } };
  console.error(error);
  return { status: 500, body: { error: "没有完成这次请求" } };
}

async function run(fn: () => Promise<unknown>): Promise<Outcome> {
  try {
    const body = await fn();
    return { status: 200, body: body ?? { ok: true } };
  } catch (error) {
    return fail(error);
  }
}

function record(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new FulfillmentError("请求缺少正文");
  }
  return body as Record<string, unknown>;
}

function idOf(body: Record<string, unknown>, key: string, message: string) {
  const value = body[key];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new FulfillmentError(message);
  return value;
}

function textOf(body: Record<string, unknown>, key: string) {
  const value = body[key];
  return typeof value === "string" ? value : "";
}

function optionalText(body: Record<string, unknown>, key: string) {
  const value = body[key];
  if (value == null) return null;
  return typeof value === "string" ? value : null;
}

function todayOf(body: Record<string, unknown>) {
  const value = body.today;
  return typeof value === "string" && value ? value : WORKBENCH.today;
}

function queryInt(url: URL, key: string) {
  const raw = url.searchParams.get(key);
  if (raw == null || raw === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function tenantOf(url: URL) {
  return queryInt(url, "tenantId") ?? WORKBENCH.tenantId;
}

function todayQuery(url: URL) {
  return url.searchParams.get("today") || WORKBENCH.today;
}

function matchPath(path: string, pattern: string) {
  const actual = path.split("/").filter(Boolean);
  const expected = pattern.split("/").filter(Boolean);
  if (actual.length !== expected.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < actual.length; index += 1) {
    if (expected[index].startsWith(":")) params[expected[index].slice(1)] = decodeURIComponent(actual[index]);
    else if (actual[index] !== expected[index]) return null;
  }
  return params;
}

function memberIdFrom(params: Record<string, string>) {
  const memberId = Number(params.id);
  if (!Number.isFinite(memberId)) throw new FulfillmentError("会员不存在");
  return memberId;
}

/** 每个写入都调用履约账本上已有的函数，不另开一条写路径。 */
export async function handleRequest(
  crm: Fulfillment,
  input: { method: string; url: string; body?: unknown; cookie?: string },
  extras?: { pool?: Pool },
): Promise<Outcome> {
  const url = new URL(input.url, "http://localhost");
  const method = input.method.toUpperCase();
  const path = url.pathname;

  try {
    if (method === "GET" && path === "/api/accounts") {
      return { status: 200, body: ACCOUNTS };
    }
    if (method === "GET" && path === "/api/session") {
      const account = await accountFromCookie(input.cookie);
      if (!account) return { status: 401, body: { error: "请先登录" } };
      return { status: 200, body: account };
    }
    if (method === "POST" && path === "/api/sign-in") {
      const body = record(input.body);
      const signed = await signIn(idOf(body, "accountId", "没有这个账号"));
      if (!signed) return { status: 400, body: { error: "没有这个账号" } };
      if (hasPermission(signed.account, "红娘")) {
        await prepareServedDrafts(crm, {
          tenantId: WORKBENCH.tenantId,
          servicePersonId: signed.account.personId,
          today: WORKBENCH.today,
        });
      }
      return { status: 200, body: signed.account, setCookie: sessionCookie(signed.token) };
    }
    if (method === "POST" && path === "/api/sign-out") {
      await signOut(input.cookie);
      return { status: 200, body: { ok: true }, setCookie: clearSessionCookie() };
    }
    if (method === "GET" && path === "/api/workspace") {
      return {
        status: 200,
        body: {
          today: WORKBENCH.today,
          tenantId: WORKBENCH.tenantId,
          shopId: WORKBENCH.shopId,
          servicePersonId: WORKBENCH.servicePersonId,
          reviewerId: WORKBENCH.reviewerId,
        },
      };
    }
    if (method === "GET" && path === "/api/home") {
      return run(async () => {
        const account = await accountFromCookie(input.cookie);
        const tenantId = tenantOf(url);
        const today = todayQuery(url);
        if (account && hasPermission(account, "红娘")) {
          await prepareServedDrafts(crm, { tenantId, servicePersonId: account.personId, today });
        }
        const home = homeForAccount(await loadHome(crm, { tenantId, today }), account);
        if (!extras?.pool) return home;
        return { ...home, achievements: await countAchievements(extras.pool, tenantId) };
      });
    }
    if (method === "GET" && path === "/api/service-people") {
      const account = await accountFromCookie(input.cookie);
      if (!account) return { status: 401, body: { error: "请先登录" } };
      const roles = hasPermission(account, "审核人")
        ? (["matchmanager", "shop_manager", "director"] as const)
        : hasPermission(account, "红娘")
          ? (["matchmanager"] as const)
          : [];
      return run(async () => await crm.listAssignableServicePeople({ tenantId: tenantOf(url), roles: [...roles] }));
    }
    if (method === "GET" && path === "/api/service-library") {
      const servicePersonId = queryInt(url, "servicePersonId");
      if (servicePersonId === undefined) return { status: 400, body: { error: "缺服务人" } };
      const shopId = queryInt(url, "shopId");
      return run(async () => await crm.listServiceLibrary({
          tenantId: tenantOf(url),
          servicePersonId,
          shopId,
        }),
      );
    }
    if (method === "GET" && path === "/api/overdue-vip") {
      return run(async () => await crm.listOverdueVip({ tenantId: tenantOf(url), shopId: queryInt(url, "shopId") }));
    }
    if (method === "GET" && path === "/api/in-progress") {
      return run(async () => await crm.listInProgress({ tenantId: tenantOf(url) }));
    }
    if (method === "GET" && path === "/api/meetings") {
      return run(async () => {
        const tenantId = tenantOf(url);
        const today = todayQuery(url);
        const due = await crm.listMeetingsMissingResult({ tenantId, today });
        const meetings = await crm.listMeetings({ tenantId });
        return { meetings, dueIds: due.map((row) => row.id) };
      });
    }

    if (method === "GET" && path === "/api/member-profiles") {
      const account = await accountFromCookie(input.cookie);
      if (!account) return { status: 401, body: { error: "请先登录" } };
      if (!hasPermission(account, "红娘")) return { status: 403, body: { error: "没有红娘权限" } };
      if (!extras?.pool) return { status: 400, body: { error: "画像还没接上" } };
      return run(async () => await listProfiles(extras.pool!));
    }
    if (method === "POST" && path === "/api/suggest-staff-fit") {
      const account = await accountFromCookie(input.cookie);
      if (!account) return { status: 401, body: { error: "请先登录" } };
      const roles: ShopRoleName[] = hasPermission(account, "审核人")
        ? ["matchmanager", "shop_manager", "director"]
        : hasPermission(account, "红娘")
          ? ["matchmanager"]
          : [];
      const body = record(input.body);
      return run(
        async () =>
          await suggestStaffFit({
            crm,
            pool: extras?.pool ?? null,
            callerId: account.id,
            tenantId: typeof body.tenantId === "number" ? body.tenantId : tenantOf(url),
            roles,
          }),
      );
    }
    const profilePath = matchPath(path, "/api/members/:id/profile");
    if (profilePath) {
      if (!extras?.pool) return { status: 400, body: { error: "画像还没接上" } };
      const memberId = memberIdFrom(profilePath);
      const account = await accountFromCookie(input.cookie);
      if (!account) return { status: 401, body: { error: "请先登录" } };
      if (!hasPermission(account, "红娘")) return { status: 403, body: { error: "没有红娘权限" } };
      if (method === "GET") return run(async () => (await getProfile(extras.pool!, memberId)) ?? emptyProfile(memberId));
      if (method === "PUT") {
        return run(async () => await saveManualProfile(extras.pool!, { memberId, today: todayOf(record(input.body)), body: record(input.body) }));
      }
    }
    const identity = matchPath(path, "/api/members/:id/identity");
    if (method === "GET" && identity) {
      return run(async () => ({ memberId: memberIdFrom(identity), identity: await crm.memberIdentity(memberIdFrom(identity)) }));
    }
    const memberPath = matchPath(path, "/api/members/:id");
    if (method === "GET" && memberPath) {
      return run(async () => await memberDetail(crm, memberIdFrom(memberPath), todayQuery(url)));
    }

    if (method === "POST" && path.startsWith("/api/actions/")) {
      return writeAction(crm, path, input.body, await accountFromCookie(input.cookie), extras);
    }
    return { status: 404, body: { error: "没有这个接口" } };
  } catch (error) {
    return fail(error);
  }
}

async function memberDetail(crm: Fulfillment, memberId: number, today: string) {
  const member = await crm.getMember(memberId);
  if (!member) throw new FulfillmentError("会员不存在");
  const instances = await crm.listInstances({ tenantId: member.tenantId, memberId });
  const meetings = await crm.listMeetings({ tenantId: member.tenantId });
  const applications = await crm.listApplications({ tenantId: member.tenantId });
  const letters = [];
  for (const row of instances) {
    const letter = await crm.getExpiryLetter(row.orderId);
    if (letter) letters.push(letter);
  }
  return {
    member,
    identity: await crm.memberIdentity(memberId),
    ownership: await crm.getOwnership(memberId),
    instances,
    notes: await crm.listNotes(memberId),
    recommendations: await crm.listRecommendations(memberId),
    meetings: meetings.filter((row) => row.serviceMemberId === memberId),
    applications: applications.filter((row) => row.memberId === memberId),
    signals: await crm.careSignals(memberId, today),
    letters,
  };
}

function homeForAccount<T extends { judgement: unknown[]; exceptions: unknown[]; reviews: unknown[] }>(home: T, account: Account | null) {
  if (!account) return home;
  return {
    ...home,
    judgement: hasPermission(account, "红娘") ? home.judgement : [],
    exceptions: hasPermission(account, "红娘") ? home.exceptions : [],
    reviews: hasPermission(account, "审核人") ? home.reviews : [],
  };
}

async function writeAction(
  crm: Fulfillment,
  path: string,
  raw: unknown,
  account: Account | null,
  extras?: { pool?: Pool },
): Promise<Outcome> {
  const body = record(raw);
  const today = todayOf(body);
  if (REVIEW_PATHS.has(path)) {
    if (!account || !hasPermission(account, "审核人")) return { status: 403, body: { error: "没有审核权限" } };
  }
  if (MATCHMAKER_PATHS.has(path)) {
    if (!account || !hasPermission(account, "红娘")) return { status: 403, body: { error: "没有红娘权限" } };
  }
  if (path === "/api/actions/open-service" && body.openedBy !== "system") {
    if (!account || !hasPermission(account, "红娘")) return { status: 403, body: { error: "没有红娘权限" } };
  }
  switch (path) {
    case "/api/actions/assign-service-person":
      return run(async () => await crm.assignServicePerson({
          tenantId: typeof body.tenantId === "number" ? body.tenantId : WORKBENCH.tenantId,
          memberId: idOf(body, "memberId", "会员不存在"),
          orderId: typeof body.orderId === "number" ? body.orderId : null,
          servicePersonId: idOf(body, "servicePersonId", "缺服务人"),
          today,
        }),
      );
    case "/api/actions/assign-default-service-person": {
      try {
        const result = await crm.assignDefaultServicePerson({
          tenantId: typeof body.tenantId === "number" ? body.tenantId : WORKBENCH.tenantId,
          shopId: idOf(body, "shopId", "缺服务人"),
          memberId: idOf(body, "memberId", "会员不存在"),
          orderId: typeof body.orderId === "number" ? body.orderId : null,
          today,
        });
        if (!result.ok) return { status: 400, body: { error: result.message } };
        return { status: 200, body: result };
      } catch (error) {
        return fail(error);
      }
    }
    case "/api/actions/open-service": {
      try {
        const openedBy = body.openedBy === "system" ? "system" : idOf(body, "openedBy", "确认开启");
        const result = await crm.openService({ orderId: idOf(body, "orderId", "订单不存在"), today, openedBy });
        if (!result.ok) return { status: 400, body: { error: result.missing.join("、"), missing: result.missing } };
        return { status: 200, body: result };
      } catch (error) {
        return fail(error);
      }
    }
    case "/api/actions/suggest-recommendation-copy":
      return run(async () => {
        const facts = Array.isArray(body.facts) ? body.facts.filter((fact): fact is string => typeof fact === "string") : [];
        return await suggestRecommendation({
          pool: extras?.pool ?? null,
          callerId: account?.id ?? null,
          memberId: idOf(body, "memberId", "会员不存在"),
          guestMemberId: idOf(body, "guestMemberId", "会员不存在"),
          facts,
          temperature: body.temperature === 0.9 ? 0.9 : 0.7,
          bypassCache: body.bypassCache === true,
        });
      });
    case "/api/actions/prepare-recommendation-draft":
      return run(async () => await crm.prepareRecommendationDraft({
          tenantId: typeof body.tenantId === "number" ? body.tenantId : WORKBENCH.tenantId,
          memberId: idOf(body, "memberId", "会员不存在"),
          guestMemberId: idOf(body, "guestMemberId", "会员不存在"),
          servicePersonId: typeof body.servicePersonId === "number" ? body.servicePersonId : undefined,
          reason: optionalText(body, "reason"),
          highlights: optionalText(body, "highlights"),
          hiddenPoints: optionalText(body, "hiddenPoints"),
          progress: optionalText(body, "progress"),
          today,
        }),
      );
    case "/api/actions/confirm-recommendation":
      return run(async () => await crm.confirmRecommendation({
          tenantId: typeof body.tenantId === "number" ? body.tenantId : WORKBENCH.tenantId,
          memberId: idOf(body, "memberId", "会员不存在"),
          guestMemberId: idOf(body, "guestMemberId", "会员不存在"),
          draftId: typeof body.draftId === "number" ? body.draftId : undefined,
          progress: optionalText(body, "progress"),
          reason: optionalText(body, "reason"),
          highlights: optionalText(body, "highlights"),
          hiddenPoints: optionalText(body, "hiddenPoints"),
          today,
        }),
      );
    case "/api/actions/confirm-meeting":
      return run(async () => await crm.confirmMeeting({
          tenantId: typeof body.tenantId === "number" ? body.tenantId : WORKBENCH.tenantId,
          serviceMemberId: idOf(body, "serviceMemberId", "会员不存在"),
          memberId: typeof body.memberId === "number" ? body.memberId : null,
          externalName: optionalText(body, "externalName"),
          meetOn: optionalText(body, "meetOn"),
          place: optionalText(body, "place"),
          memberStatus: optionalText(body, "memberStatus"),
          objectStatus: optionalText(body, "objectStatus"),
          result: optionalText(body, "result"),
          feedback: optionalText(body, "feedback"),
          today,
        }),
      );
    case "/api/actions/record-meeting-result":
      return run(async () => await crm.recordMeetingResult({
          meetingId: idOf(body, "meetingId", "约会不存在"),
          result: body.result === undefined ? undefined : optionalText(body, "result"),
          feedback: body.feedback === undefined ? undefined : optionalText(body, "feedback"),
          memberStatus: body.memberStatus === undefined ? undefined : optionalText(body, "memberStatus"),
          objectStatus: body.objectStatus === undefined ? undefined : optionalText(body, "objectStatus"),
        }),
      );
    case "/api/actions/run-automatic":
      return run(async () => await crm.runAutomatic({
          today,
          tenantId: typeof body.tenantId === "number" ? body.tenantId : WORKBENCH.tenantId,
          recommendationCandidates: Array.isArray(body.recommendationCandidates)
            ? (body.recommendationCandidates as Array<{
                memberId: number;
                guestMemberId: number;
                servicePersonId?: number;
                reason?: string | null;
              }>)
            : undefined,
        }),
      );
    case "/api/actions/file-pause":
      return run(async () => await crm.filePause({
          orderId: idOf(body, "orderId", "订单不存在"),
          reason: textOf(body, "reason"),
          pauseStart: textOf(body, "pauseStart"),
          pauseEnd: textOf(body, "pauseEnd"),
          today,
        }),
      );
    case "/api/actions/file-gift":
      return run(async () => await crm.fileGift({
          orderId: idOf(body, "orderId", "订单不存在"),
          reason: textOf(body, "reason"),
          endDays: typeof body.endDays === "number" ? body.endDays : undefined,
          totalEndDays: typeof body.totalEndDays === "number" ? body.totalEndDays : undefined,
          quotaKind: typeof body.quotaKind === "string" ? (body.quotaKind as QuotaKind) : undefined,
          quotaAdd: typeof body.quotaAdd === "number" ? body.quotaAdd : undefined,
          today,
        }),
      );
    case "/api/actions/file-close":
      return run(async () => await crm.fileClose({
          orderId: idOf(body, "orderId", "订单不存在"),
          reason: textOf(body, "reason"),
          consent: body.consent === true ? true : body.consent === false ? false : null,
          today,
        }),
      );
    case "/api/actions/set-close-consent":
      return run(async () => {
        if (typeof body.consent !== "boolean") throw new FulfillmentError("关单需要用户是否同意");
        return await crm.setCloseConsent({
          applicationId: idOf(body, "applicationId", "申请不存在"),
          consent: body.consent,
        });
      });
    case "/api/actions/review-close-first":
      return run(async () => await crm.reviewCloseFirst({
          applicationId: idOf(body, "applicationId", "申请不存在"),
          decision: decisionOf(body),
          today,
        }),
      );
    case "/api/actions/review-close-second":
      return run(async () => await crm.reviewCloseSecond({
          applicationId: idOf(body, "applicationId", "申请不存在"),
          decision: decisionOf(body),
          today,
          closedBy: typeof body.closedBy === "number" ? body.closedBy : undefined,
        }),
      );
    case "/api/actions/review-pause":
      return run(async () => await crm.reviewPause({
          applicationId: idOf(body, "applicationId", "申请不存在"),
          decision: decisionOf(body),
          today,
        }),
      );
    case "/api/actions/review-gift":
      return run(async () => await crm.reviewGift({
          applicationId: idOf(body, "applicationId", "申请不存在"),
          decision: decisionOf(body),
          today,
        }),
      );
    case "/api/actions/resume-service":
      return run(async () => await crm.resumeService({
          applicationId: idOf(body, "applicationId", "申请不存在"),
          resumeDate: textOf(body, "resumeDate") || today,
        }),
      );
    case "/api/actions/record-expiry-letter":
      return run(async () => await crm.recordExpiryLetter({
          orderId: idOf(body, "orderId", "订单不存在"),
          today,
          letterUrl: optionalText(body, "letterUrl"),
          status: typeof body.status === "string" ? body.status : undefined,
          remark: optionalText(body, "remark"),
        }),
      );
    case "/api/actions/update-expiry-letter-status":
      return run(async () => await crm.updateExpiryLetterStatus({
          orderId: idOf(body, "orderId", "订单不存在"),
          status: textOf(body, "status"),
          remark: body.remark === undefined ? undefined : optionalText(body, "remark"),
        }),
      );
    case "/api/actions/apply-refund-completed":
      return run(async () => await crm.applyRefundCompleted({ orderId: idOf(body, "orderId", "订单不存在"), today }));
    case "/api/actions/claim-by-matchmaker":
      return run(async () => await crm.claimByMatchmaker({
          tenantId: typeof body.tenantId === "number" ? body.tenantId : WORKBENCH.tenantId,
          memberId: idOf(body, "memberId", "会员不存在"),
          servicePersonId: idOf(body, "servicePersonId", "缺服务人"),
          today,
        }),
      );
    case "/api/actions/claim-by-sales-or-invite":
      return run(async () => await crm.claimBySalesOrInvite({
          tenantId: typeof body.tenantId === "number" ? body.tenantId : WORKBENCH.tenantId,
          memberId: idOf(body, "memberId", "会员不存在"),
          personId: idOf(body, "personId", "缺服务人"),
          role: body.role as DealRole,
          today,
        }),
      );
    case "/api/actions/add-note":
      return run(async () => await crm.addManualNote({
          tenantId: typeof body.tenantId === "number" ? body.tenantId : WORKBENCH.tenantId,
          memberId: idOf(body, "memberId", "会员不存在"),
          body: textOf(body, "body"),
          createdAt: today,
        }),
      );
    default:
      return { status: 404, body: { error: "没有这个接口" } };
  }
}

function decisionOf(body: Record<string, unknown>): "通过" | "驳回" {
  if (body.decision === "通过" || body.decision === "驳回") return body.decision;
  throw new FulfillmentError("申请不存在");
}
