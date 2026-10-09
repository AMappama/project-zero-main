import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AssignDialog,
  ConfirmDraftDialog,
  ConfirmOpenDialog,
  ConsentButtons,
  FileCloseDialog,
  FileGiftDialog,
  FilePauseDialog,
  MeetingResultDialog,
  ResumeDialog,
  ReviewButtons,
} from "../actions";
import { formatDay, getJson, hasPermission, type Account, type HomeItem, type HomeScreen, type Workspace } from "../api";
import { MemberAvatar } from "../components/MemberAvatar";
import { memberProfile } from "../memberProfile";
import { Button } from "../components/ui/button";
import { ReviewSubTabs, reviewsForTab, type ReviewTabId } from "../reviewTabs";
import { memberHref, readHomeSegment, readReviewTab, rememberHome, withFrom } from "../returnTo";

const TABS = [
  { id: "judgement", label: "待判断" },
  { id: "exceptions", label: "例外" },
  { id: "reviews", label: "审核" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const INTRO: Record<TabId, string> = {
  judgement: "待确认的推荐、到点还没填的见面结果、到期或已恋爱起草的关单，以及还没建申请的关单建议。",
  exceptions: "缺服务人、落到店长或总监、合同或付款不够、计划开始日还没到，以及这一单要暂停、赠送、提前关单或提前恢复。",
  reviews: "赠送和暂停各审一次。关单先一审再二审，一审通过不改服务实例。",
};

export function HomePage({ workspace, account }: { workspace: Workspace; account: Account }) {
  const matchmaker = hasPermission(account, "红娘");
  const reviewer = hasPermission(account, "审核人");
  const tabs = TABS.filter((item) => (item.id === "reviews" ? reviewer : matchmaker));
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [error, setError] = useState("");
  const [home, setHome] = useState<HomeScreen | null>(null);
  const [tab, setTabState] = useState<TabId>(() => {
    const requested = readHomeSegment();
    const allowed = TABS.filter((item) => (item.id === "reviews" ? hasPermission(account, "审核人") : hasPermission(account, "红娘")));
    return allowed.some((item) => item.id === requested) ? requested : (allowed[0]?.id ?? "judgement");
  });
  const [reviewTab, setReviewTabState] = useState<ReviewTabId>(readReviewTab);
  function setTab(next: TabId) {
    setTabState(next);
    rememberHome(next, reviewTab);
  }
  function setReviewTab(next: ReviewTabId) {
    setReviewTabState(next);
    rememberHome(tab === "reviews" ? "reviews" : tab, next);
  }
  const [openSuggestions, setOpenSuggestions] = useState(false);
  const [query, setQuery] = useState("");

  const reload = useCallback(async () => {
    setPhase("loading");
    try {
      const data = await getJson<HomeScreen>(`/api/home?tenantId=${workspace.tenantId}&today=${workspace.today}`);
      setHome(data);
      setPhase("ready");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "没有读出来");
      setPhase("error");
    }
  }, [workspace.tenantId, workspace.today]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const counts = {
    judgement: home?.judgement.length ?? 0,
    exceptions: home?.exceptions.length ?? 0,
    reviews: home?.reviews.length ?? 0,
  };
  const source = useMemo(() => {
    const list = home?.[tab] ?? [];
    if (tab !== "reviews") return list;
    return reviewsForTab(list, reviewTab);
  }, [home, reviewTab, tab]);
  const rows = useMemo(() => {
    const needle = query.trim();
    if (!needle) return source;
    return source.filter((item) =>
      `${item.memberId ?? ""} ${item.memberId ? memberProfile(item.memberId).name : ""} ${item.orderId ?? ""} ${item.title} ${item.detail}`.includes(needle),
    );
  }, [query, source]);

  return (
    <div>
      <section className="mb-7">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-[#5B55D6]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#5B55D6]" />
          服务跟进
        </div>
        <h1 className="text-[30px] font-bold tracking-[-0.04em] sm:text-[36px]">{tabs.map((item) => item.label).join("、")}</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[#77746E]">
          {formatDay(workspace.today)}。{account.name}登录。
          {matchmaker ? "待判断要确认后才落账。例外是还开不了，或要红娘对某一单发起的事。" : ""}
          {reviewer ? "审核通过才改服务。" : ""}
        </p>
      </section>

      <section className="mb-5 overflow-hidden rounded-2xl bg-[#252523] text-white shadow-[0_14px_40px_rgba(37,37,35,0.12)]">
        <div className="flex flex-col gap-5 p-5 lg:flex-row lg:items-center">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold text-[#C9C5FF]">今天的三块</div>
            <h2 className="mt-2 text-lg font-semibold">先看有多少单要人处理</h2>
            <p className="mt-2 text-xs leading-5 text-white/55">这些数字来自履约账。确认推荐、见面结果和是否同意要人来做。这里不自动通过审核，也不改会员身份。</p>
          </div>
          <div className={`grid gap-2 ${tabs.length >= 3 ? "grid-cols-3 sm:min-w-[330px]" : tabs.length === 2 ? "grid-cols-2 sm:min-w-[220px]" : "grid-cols-1 sm:min-w-[120px]"}`}>
            {tabs.map((item) => (
              <Stat key={item.id} label={item.label} value={`${counts[item.id]}单`} accent={item.id === "reviews"} />
            ))}
          </div>
          {matchmaker ? (
            <button
              type="button"
              aria-expanded={openSuggestions}
              onClick={() => setOpenSuggestions((value) => !value)}
              className="flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-white px-4 text-xs font-semibold text-[#252523]"
            >
              {openSuggestions ? "收起待判断" : "查看待判断"}
            </button>
          ) : null}
        </div>
        {matchmaker && openSuggestions ? (
          <div className="grid gap-3 border-t border-white/10 bg-white/[0.03] p-5 lg:grid-cols-3">
            {(home?.judgement.length ?? 0) === 0 ? <p className="text-xs text-white/55">今天没有待确认的推荐、到点的见面或关单草稿。</p> : null}
            {home?.judgement.map((item) => (
              <div
                key={item.key}
                className="rounded-2xl border border-white/10 bg-white/[0.07] p-4 text-left"
              >
                <div className="flex items-center gap-3">
                  <MemberLink memberId={item.memberId} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{memberName(item.memberId)}</p>
                    <span className="mt-1 inline-flex rounded-full bg-[#ECEAFB] px-2 py-0.5 text-[9px] font-semibold text-[#5650C6]">{item.title}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setTab("judgement");
                    setQuery("");
                  }}
                  className="mt-3 text-left text-[11px] leading-5 text-white/60 hover:text-white"
                >
                  {nameMembers(item.detail)}
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <div className="mb-5">
        <div className="flex gap-1 overflow-x-auto rounded-xl bg-[#F0EEEA] p-1">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`whitespace-nowrap rounded-lg px-4 py-2.5 text-xs font-semibold transition ${tab === item.id ? "bg-white text-[#35322E] shadow-[0_2px_8px_rgba(35,32,25,0.07)]" : "text-[#85817A] hover:text-[#4C4944]"}`}
            >
              {item.label}
              <span className="ml-1.5 opacity-60">{counts[item.id]}</span>
            </button>
          ))}
        </div>
      </div>

      <section className="overflow-hidden rounded-2xl border border-black/[0.055] bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-black/[0.055] p-5 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-semibold">{TABS.find((item) => item.id === tab)?.label}</h2>
              <span className="rounded-full bg-[#F0EEEA] px-2 py-0.5 text-[9px] font-semibold text-[#77746E]">当前 {rows.length} 条</span>
            </div>
            <p className="mt-1 text-xs text-[#918E87]">{INTRO[tab]}</p>
          </div>
          <label className="relative block w-full md:w-[300px]">
            <span className="sr-only">搜索会员或订单</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索会员、订单或这一单要做的事"
              className="h-11 w-full rounded-xl border border-black/[0.07] bg-white px-4 text-xs outline-none transition placeholder:text-[#A4A19A] focus:border-[#5B55D6]/35 focus:ring-4 focus:ring-[#5B55D6]/[0.06]"
            />
          </label>
        </div>
        {tab === "reviews" ? (
          <div className="border-b border-black/[0.055] px-5 py-3">
            <ReviewSubTabs items={home?.reviews ?? []} value={reviewTab} onChange={setReviewTab} />
          </div>
        ) : null}
        {phase === "loading" ? <p className="px-5 py-8 text-sm text-[#918E87]">正在读取今天的待判断、例外和审核。</p> : null}
        {phase === "error" ? (
          <div className="grid gap-2 px-5 py-8">
            <p className="text-sm text-[#B54E61]">没有读出来。{error}</p>
            <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => void reload()}>
              再试一次
            </Button>
          </div>
        ) : null}
        {phase === "ready" && rows.length === 0 ? (
          <div className="grid min-h-[220px] place-items-center px-5 text-center">
            <p className="text-sm text-[#918E87]">{query.trim() ? "没有符合这几个字的单。" : emptyCopy(tab)}</p>
          </div>
        ) : null}
        {phase === "ready" && home ? (
          <div className="divide-y divide-black/[0.045]">
            {rows.map((item) => (
              <article key={item.key} className="flex w-full flex-col gap-3 px-5 py-4 md:flex-row md:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <MemberLink memberId={item.memberId} />
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold">{item.title}</h3>
                    <p className="mt-1 text-xs leading-5 text-[#68655F]">{nameMembers(item.detail)}</p>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                      {item.memberId ? (
                        <a className="text-[10px] font-semibold text-[#5B55D6]" href={memberHref(item.memberId)}>
                          {memberName(item.memberId)}
                          {item.orderId ? ` · 订单 ${item.orderId}` : ""}
                        </a>
                      ) : null}
                      {item.meetingId ? (
                        <a className="text-[10px] font-semibold text-[#5B55D6]" href={withFrom(`/meetings/${item.meetingId}`)}>
                          打开这场约会
                        </a>
                      ) : null}
                      {item.applicationId && (item.kind === "赠送" || item.kind === "暂停" || item.kind === "关单") ? (
                        <a className="text-[10px] font-semibold text-[#5B55D6]" href={withFrom(`/reviews/${item.applicationId}`)}>
                          打开这张审核
                        </a>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 md:w-[280px] md:justify-end">
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${pillTone(item.kind)}`}>{item.title}</span>
                  <RowAction item={item} matchmaker={matchmaker} reviewer={reviewer} actorId={account.personId} home={home} workspace={workspace} onDone={reload} />
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function Stat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl bg-white/[0.07] p-3">
      <p className="text-[10px] text-white/45">{label}</p>
      <p className={`mt-1 text-xl font-bold ${accent ? "text-[#8FD2B7]" : ""}`}>{value}</p>
    </div>
  );
}

function memberName(memberId: number | null) {
  if (memberId == null) return "—";
  return memberProfile(memberId).name;
}

function nameMembers(text: string) {
  return text.replace(/会员 (\d+)/g, (_, raw: string) => memberProfile(Number(raw)).name);
}

function MemberLink({ memberId }: { memberId: number | null }) {
  const avatar = memberId == null ? <MemberAvatar name="—" /> : <MemberAvatar name={memberProfile(memberId).name} src={memberProfile(memberId).avatar} />;
  if (memberId == null) return avatar;
  return (
    <a href={memberHref(memberId)} className="shrink-0 rounded-full" aria-label={memberProfile(memberId).name}>
      {avatar}
    </a>
  );
}

function emptyCopy(tab: TabId) {
  if (tab === "judgement") return "今天没有待确认的推荐、到点的见面、到期起草的关单，也没有已恋爱的关单建议。";
  if (tab === "exceptions") return "没有缺服务人、合同或付款缺口、未到的计划开始日，也没有落到店长或总监名下的单。";
  return "这一档没有待审的申请。";
}

function pillTone(kind: string) {
  if (kind === "推荐草稿" || kind === "见面结果" || kind === "起草关单" || kind === "关单建议") return "bg-[#ECEAFB] text-[#5650C6]";
  if (kind === "赠送" || kind === "暂停" || kind === "关单") return "bg-[#F5EBD9] text-[#956626]";
  if (kind === "提前恢复" || kind === "要暂停" || kind === "要赠送" || kind === "提前关单") return "bg-[#E2F1E9] text-[#397A5B]";
  return "bg-[#F8E7EA] text-[#B54E61]";
}

function RowAction({
  item,
  matchmaker,
  reviewer,
  actorId,
  home,
  workspace,
  onDone,
}: {
  item: HomeItem;
  matchmaker: boolean;
  reviewer: boolean;
  actorId: number;
  home: HomeScreen;
  workspace: Workspace;
  onDone: () => Promise<void>;
}) {
  if (item.kind === "推荐草稿") {
    if (!matchmaker) return null;
    return <ConfirmDraftDialog item={item} tenantId={workspace.tenantId} today={workspace.today} onDone={onDone} />;
  }
  if (item.kind === "见面结果" && item.meetingId) {
    if (!matchmaker) return null;
    return <MeetingResultDialog meetingId={item.meetingId} onDone={onDone} />;
  }
  if (item.kind === "起草关单" && item.consent == null && item.applicationId) {
    if (!matchmaker) return null;
    return <ConsentButtons applicationId={item.applicationId} onDone={onDone} />;
  }
  if (item.kind === "关单建议") {
    if (!matchmaker) return null;
    return <FileCloseDialog today={workspace.today} orders={home.filing.liveOrders} presetOrderId={item.orderId} lockOrder trigger="若要关单，由红娘发起" onDone={onDone} />;
  }
  if ((item.facts.includes("缺服务人") || item.kind === "换人") && matchmaker) {
    return (
      <AssignDialog
        trigger={item.kind === "换人" ? "换成红娘" : "指定服务人"}
        tenantId={workspace.tenantId}
        today={workspace.today}
        presetMemberId={item.memberId}
        lockMember={item.facts.includes("缺服务人")}
        onDone={onDone}
      />
    );
  }
  if (item.facts.length === 1 && item.facts[0] === "确认开启" && item.orderId && matchmaker) {
    return <ConfirmOpenDialog orderId={item.orderId} today={workspace.today} reviewerId={actorId} onDone={onDone} />;
  }
  if (item.kind === "要暂停" && matchmaker) {
    return <FilePauseDialog today={workspace.today} orders={home.filing.liveOrders} presetOrderId={item.orderId} lockOrder trigger="发起暂停" onDone={onDone} />;
  }
  if (item.kind === "要赠送" && matchmaker) {
    return <FileGiftDialog today={workspace.today} orders={home.filing.liveOrders} presetOrderId={item.orderId} trigger="发起赠送" onDone={onDone} />;
  }
  if (item.kind === "提前关单" && matchmaker) {
    return <FileCloseDialog today={workspace.today} orders={home.filing.liveOrders} presetOrderId={item.orderId} trigger="提前关单" onDone={onDone} />;
  }
  if (item.kind === "提前恢复" && item.applicationId && matchmaker) {
    return <ResumeDialog today={workspace.today} pauses={home.filing.pauses} presetApplicationId={item.applicationId} trigger="提前恢复" onDone={onDone} />;
  }
  if (item.kind === "赠送" || item.kind === "暂停" || item.kind === "关单") {
    if (!reviewer) return null;
    return <ReviewButtons item={item} today={workspace.today} reviewerId={actorId} onDone={onDone} />;
  }
  return null;
}

