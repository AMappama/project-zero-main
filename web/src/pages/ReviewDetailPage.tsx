import { useCallback, useEffect, useState } from "react";
import { ReviewButtons } from "../actions";
import { getJson, hasPermission, type Account, type HomeItem, type HomeScreen, type Workspace } from "../api";
import { memberHref } from "../returnTo";
import { Page, Status } from "./LibraryPage";

export function ReviewDetailPage({ workspace, account, applicationId }: { workspace: Workspace; account: Account; applicationId: number }) {
  const reviewer = hasPermission(account, "审核人");
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [error, setError] = useState("");
  const [item, setItem] = useState<HomeItem | null>(null);

  const load = useCallback(async () => {
    setPhase("loading");
    try {
      const home = await getJson<HomeScreen>(`/api/home?tenantId=${workspace.tenantId}&today=${workspace.today}`);
      setItem(home.reviews.find((row) => row.applicationId === applicationId) ?? null);
      setPhase("ready");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "没有读出来");
      setPhase("error");
    }
  }, [applicationId, workspace.tenantId, workspace.today]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Page back fallback="/reviews" title={item?.title ?? "审核"} intro="这一张待审申请。通过或驳回仍走原来的那一次写入。">
      <Status phase={phase} error={error} onRetry={() => void load()} loading="正在读取这张审核。" />
      {phase === "ready" && !item ? <p className="text-sm text-muted-foreground">这张申请不在待审里。</p> : null}
      {phase === "ready" && item ? (
        <article className="grid gap-3 rounded-2xl border border-black/[0.055] bg-white p-5 shadow-sm">
          <div>
            <h2 className="text-sm font-semibold">{item.title}</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{item.detail}</p>
            {item.memberId ? (
              <a className="mt-1 inline-block text-[11.5px] font-bold text-primary" href={memberHref(item.memberId)}>
                会员 {item.memberId}
                {item.orderId ? ` · 订单 ${item.orderId}` : ""}
              </a>
            ) : null}
          </div>
          {reviewer ? <ReviewButtons item={item} today={workspace.today} reviewerId={account.personId} onDone={load} /> : null}
        </article>
      ) : null}
    </Page>
  );
}
