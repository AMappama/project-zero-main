import { useCallback, useEffect, useState } from "react";
import { ReviewButtons } from "../actions";
import { getJson, hasPermission, type Account, type HomeScreen, type Workspace } from "../api";
import { ReviewSubTabs, reviewsForTab, type ReviewTabId } from "../reviewTabs";
import { memberHref, readReviewTab, rememberReviews, withFrom } from "../returnTo";
import { Page, Status } from "./LibraryPage";

const EMPTY: Record<ReviewTabId, string> = {
  赠送: "没有待审的赠送。",
  暂停: "没有待审的暂停。",
  关单一审: "没有待一审的关单。",
  关单二审: "没有待二审的关单。",
};

export function ReviewsPage({ workspace, account }: { workspace: Workspace; account: Account }) {
  const reviewer = hasPermission(account, "审核人");
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [error, setError] = useState("");
  const [home, setHome] = useState<HomeScreen | null>(null);
  const [tab, setTabState] = useState<ReviewTabId>(readReviewTab);
  function setTab(next: ReviewTabId) {
    setTabState(next);
    rememberReviews(next);
  }

  const load = useCallback(async () => {
    setPhase("loading");
    try {
      setHome(await getJson<HomeScreen>(`/api/home?tenantId=${workspace.tenantId}&today=${workspace.today}`));
      setPhase("ready");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "没有读出来");
      setPhase("error");
    }
  }, [workspace.tenantId, workspace.today]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = reviewsForTab(home?.reviews ?? [], tab);

  return (
    <Page title="审核列表" intro="和工作台的审核是同一份待审申请。赠送和暂停一次通过或驳回，关单要两级。按钮调用同一个写入。">
      <section className="overflow-hidden rounded-2xl border border-black/[0.055] bg-white shadow-sm">
        <div className="border-b border-black/[0.055] p-4">
          <ReviewSubTabs items={home?.reviews ?? []} value={tab} onChange={setTab} />
        </div>
        {phase !== "ready" ? (
          <div className="px-5 py-4">
            <Status phase={phase} error={error} onRetry={() => void load()} loading="正在读取待审申请。" />
          </div>
        ) : null}
        {phase === "ready" && rows.length === 0 ? <p className="px-5 py-8 text-sm text-muted-foreground">{EMPTY[tab]}</p> : null}
        {phase === "ready" ? (
          <div className="divide-y divide-black/[0.045]">
            {rows.map((item) => (
              <article key={item.key} className="grid gap-3 px-5 py-4">
                <div>
                  {item.applicationId ? (
                    <a className="text-sm font-semibold text-primary" href={withFrom(`/reviews/${item.applicationId}`)}>
                      {item.title}
                    </a>
                  ) : (
                    <h2 className="text-sm font-semibold">{item.title}</h2>
                  )}
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">{item.detail}</p>
                  {item.memberId ? (
                    <a className="mt-1 inline-block text-[10px] font-semibold text-primary" href={memberHref(item.memberId)}>
                      会员 {item.memberId}
                      {item.orderId ? ` · 订单 ${item.orderId}` : ""}
                    </a>
                  ) : null}
                </div>
                {reviewer ? <ReviewButtons item={item} today={workspace.today} reviewerId={account.personId} onDone={load} /> : null}
              </article>
            ))}
          </div>
        ) : null}
      </section>
    </Page>
  );
}
