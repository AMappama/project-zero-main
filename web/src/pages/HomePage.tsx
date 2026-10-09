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
import { memberHref, readReviewTab, rememberHome, withFrom } from "../returnTo";

const LANES = [
  {
    id: "urgent",
    label: "要紧",
    tone: "bg-care/12 text-care-ink",
    countLabel: "位在等你",
    kinds: ["见面结果", "起草关单", "关单建议"],
  },
  {
    id: "reply",
    label: "要回应",
    tone: "bg-primary/10 text-primary",
    countLabel: "位在等回应",
    kinds: ["推荐草稿", "换人", "开启缺口"],
  },
  {
    id: "approve",
    label: "要点头",
    tone: "bg-warn/15 text-warn-ink",
    countLabel: "张等你点头",
    kinds: ["赠送", "暂停", "关单"],
  },
  {
    id: "plan",
    label: "待安排",
    tone: "bg-secondary text-secondary-foreground",
    countLabel: "件可以安排",
    kinds: ["要暂停", "要赠送", "提前关单", "提前恢复"],
  },
] as const;

/** 状态语气，替掉系统分类词。完整语义由摘要行承担，这里只留极短标记。 */
const PILL: Record<string, string> = {
  推荐草稿: "等你确认",
  见面结果: "等你记",
  起草关单: "等你记",
  关单建议: "等你办",
  开启缺口: "等条件",
  换人: "等换人",
  要暂停: "可以办",
  要赠送: "可以办",
  提前关单: "可以办",
  提前恢复: "可以办",
  赠送: "等你点头",
  暂停: "等你点头",
  关单: "等你点头",
};

export function HomePage({ workspace, account }: { workspace: Workspace; account: Account }) {
  const matchmaker = hasPermission(account, "红娘");
  const reviewer = hasPermission(account, "审核人");
  const lanes = LANES.filter((lane) => (lane.id === "approve" ? reviewer : matchmaker));
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [error, setError] = useState("");
  const [home, setHome] = useState<HomeScreen | null>(null);
  const [reviewTab, setReviewTabState] = useState<ReviewTabId>(readReviewTab);
  function setReviewTab(next: ReviewTabId) {
    setReviewTabState(next);
    rememberHome("reviews", next);
  }
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

  const grouped = useMemo(() => {
    const all = [...(home?.judgement ?? []), ...(home?.exceptions ?? []), ...(home?.reviews ?? [])];
    const needle = query.trim();
    return lanes.map((lane) => {
      let items = all.filter((item) => (lane.kinds as readonly string[]).includes(item.kind));
      if (lane.id === "approve") items = reviewsForTab(items, reviewTab);
      if (needle) {
        items = items.filter((item) =>
          `${item.memberId ?? ""} ${item.memberId ? memberProfile(item.memberId).name : ""} ${item.orderId ?? ""} ${item.title} ${item.summary ?? ""} ${item.detail}`.includes(needle),
        );
      }
      return { ...lane, items };
    });
  }, [home, lanes, query, reviewTab]);
  const rows = grouped.flatMap((lane) => lane.items);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;
      if (document.querySelector("[role='dialog']")) return;
      const cards = Array.from(document.querySelectorAll<HTMLElement>("[data-home-card]"));
      if (cards.length === 0) return;
      const index = cards.findIndex((card) => card === document.activeElement || card.contains(document.activeElement));
      if (event.key === "j" || event.key === "k") {
        event.preventDefault();
        const next = event.key === "j" ? Math.min(cards.length - 1, index < 0 ? 0 : index + 1) : Math.max(0, index < 0 ? 0 : index - 1);
        cards[next]?.focus();
      }
      if (event.key === "Enter" && index >= 0 && event.target === cards[index]) {
        event.preventDefault();
        cards[index].querySelector<HTMLButtonElement>("button")?.click();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows]);

  const ribbon = home?.achievements;

  return (
    <div>
      <section className="mb-7">
        <p className="mb-2 text-xs font-semibold text-care">今日</p>
        <h1 className="text-[30px] font-bold tracking-[-0.04em] sm:text-[36px]">先处理今天要人看的事</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          {formatDay(workspace.today)}。确认之后才落账，审核通过才改服务。
        </p>
        {ribbon ? (
          <div className="ribbon mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-2 rounded-2xl px-5 py-4 text-sm text-care-ink shadow-card">
            <span>
              <span className="font-serif text-xl font-bold text-care">{ribbon.meetings}</span> 场见面落了结果
            </span>
            <span>
              <span className="font-serif text-xl font-bold text-care">{ribbon.applications}</span> 张申请审完
            </span>
            <span>
              <span className="font-serif text-xl font-bold text-care">{ribbon.notes}</span> 条小记写下了
            </span>
          </div>
        ) : null}
      </section>

      <label className="mb-5 block w-full md:w-[300px]">
        <span className="sr-only">搜索会员或订单</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索会员、订单或这一单要做的事"
          className="h-11 w-full rounded-xl border border-border bg-card px-4 text-xs outline-none focus:ring-4 focus:ring-primary/15"
        />
      </label>

      {phase === "loading" ? <p className="text-sm text-muted-foreground">正在读取今天要处理的事。</p> : null}
      {phase === "error" ? (
        <div className="grid gap-2">
          <p className="text-sm text-destructive">没有读出来。{error}</p>
          <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => void reload()}>
            再试一次
          </Button>
        </div>
      ) : null}
      {phase === "ready" && rows.length === 0 ? (
        <div className="grid min-h-[220px] place-items-center rounded-2xl border border-border bg-card px-5 text-center">
          <div>
            <p className="text-sm text-muted-foreground">{query.trim() ? "没有符合这几个字的单。" : "今天没有要赶的事。要不要看看谁该回访？"}</p>
            {query.trim() ? null : (
              <a className="mt-3 inline-block rounded-lg bg-care px-3 py-2 text-sm font-semibold text-white" href="/library">
                去会员库
              </a>
            )}
          </div>
        </div>
      ) : null}
      {phase === "ready" && home
        ? grouped.map((lane) =>
            lane.items.length === 0 ? null : (
              <section key={lane.id} className="mb-5 overflow-hidden rounded-2xl border border-border bg-card shadow-card">
                <div className="flex items-center justify-between border-b border-border px-5 py-4">
                  <h2 className="text-lg">{lane.label}</h2>
                  <span className="text-[11px] text-muted-foreground">
                    {lane.items.length} {lane.countLabel}
                  </span>
                </div>
                {lane.id === "approve" ? (
                  <div className="border-b border-border px-5 py-3">
                    <ReviewSubTabs items={home.reviews} value={reviewTab} onChange={setReviewTab} />
                  </div>
                ) : null}
                <div className="divide-y divide-border">
                  {lane.items.map((item) => (
                    <article key={item.key} data-home-card tabIndex={0} className="card-in flex w-full flex-col gap-3 px-5 py-4 outline-none focus:bg-accent md:flex-row md:items-start">
                      <div className="flex min-w-0 flex-1 items-start gap-3">
                        <MemberLink memberId={item.memberId} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold">{memberName(item.memberId)}</p>
                          <h3 className="mt-0.5 text-[15px] font-medium">{item.summary || item.title}</h3>
                          {item.todayFacts && item.todayFacts.length > 0 ? <p className="mt-1 text-xs text-warn-ink">{item.todayFacts.join(" · ")}</p> : null}
                          <details className="group mt-1">
                            <summary className="w-fit cursor-pointer list-none text-xs font-semibold text-muted-foreground transition hover:text-foreground">
                              <span aria-hidden="true" className="mr-1 inline-block transition group-open:rotate-90">
                                ›
                              </span>
                              为什么
                            </summary>
                            <p className="mt-1.5 max-w-[62ch] text-[13px] leading-[1.7] text-muted-foreground">{nameMembers(item.detail)}</p>
                          </details>
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                            {item.memberId ? (
                              <a className="text-[10px] font-semibold text-primary" href={memberHref(item.memberId)}>
                                打开档案{item.orderId ? ` · 订单 ${item.orderId}` : ""}
                              </a>
                            ) : null}
                            {item.meetingId ? (
                              <a className="text-[10px] font-semibold text-primary" href={withFrom(`/meetings/${item.meetingId}`)}>
                                打开这场约会
                              </a>
                            ) : null}
                            {item.applicationId && (item.kind === "赠送" || item.kind === "暂停" || item.kind === "关单") ? (
                              <a className="text-[10px] font-semibold text-primary" href={withFrom(`/reviews/${item.applicationId}`)}>
                                打开这张审核
                              </a>
                            ) : null}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 md:w-[280px] md:justify-end">
                        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${lane.tone}`}>{PILL[item.kind] ?? item.title}</span>
                        <RowAction item={item} matchmaker={matchmaker} reviewer={reviewer} actorId={account.personId} home={home} workspace={workspace} onDone={reload} />
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ),
          )
        : null}
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
  if (memberId == null) return <MemberAvatar name="—" />;
  const profile = memberProfile(memberId);
  return (
    <a href={memberHref(memberId)} className="shrink-0 rounded-full" aria-label={profile.name}>
      <MemberAvatar name={profile.name} src={profile.avatar} placeholder={profile.placeholder} />
    </a>
  );
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
    return <FileCloseDialog today={workspace.today} orders={home.filing.liveOrders} presetOrderId={item.orderId} lockOrder quiet trigger="若要关单，由红娘发起" onDone={onDone} />;
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
    return <FileCloseDialog today={workspace.today} orders={home.filing.liveOrders} presetOrderId={item.orderId} quiet trigger="提前关单" onDone={onDone} />;
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

