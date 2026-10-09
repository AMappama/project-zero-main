import { useCallback, useEffect, useState } from "react";
import { getJson, hasPermission, postAction, type Account, type Workspace } from "../api";
import { memberHref } from "../returnTo";
import { Button } from "../components/ui/button";
import { Page, Status } from "./LibraryPage";

type Row = {
  memberId: number;
  orderId: number;
  consent: boolean;
  reason: string | null;
  closedBy: number | null;
  servicePersonId: number | null;
};

export function OverduePage({ workspace, account }: { workspace: Workspace; account: Account }) {
  const matchmaker = hasPermission(account, "红娘");
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [error, setError] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [actionError, setActionError] = useState("");

  const load = useCallback(async () => {
    setPhase("loading");
    try {
      setRows(await getJson<Row[]>(`/api/overdue-vip?tenantId=${workspace.tenantId}`));
      setPhase("ready");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "没有读出来");
      setPhase("error");
    }
  }, [workspace.tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function claim(path: string, body: unknown) {
    setActionError("");
    try {
      await postAction(path, body);
      await load();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "没有完成领取");
    }
  }

  return (
    <Page title="过期 VIP" intro="名单来自过期 VIP 查询：已完成、关单两级通过并且四项齐全、当前没有有效服务归属。点开一位会员看详情，返回回到这里。领取之后就离开这份名单。">
      <Status phase={phase} error={error} onRetry={() => void load()} loading="正在读取过期 VIP。" />
      {actionError ? <p className="text-sm text-destructive">{actionError}</p> : null}
      {phase === "ready" && rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          现在没有待领取的过期 VIP。要同时满足：服务已完成、关单两级通过并且记了是否同意、原因、关单人和当时的服务人，而且当前没有有效服务归属。
        </p>
      ) : null}
      {phase === "ready" && rows.length > 0 ? (
        <div className="overflow-hidden rounded-2xl border border-black/[0.055] bg-white shadow-sm">
          {rows.map((row) => (
            <div key={row.memberId} className="border-b border-black/[0.045] px-5 py-4 last:border-b-0">
              <a href={memberHref(row.memberId)} className="block hover:text-primary">
                <span className="block text-sm font-semibold">会员 {row.memberId}</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  订单 {row.orderId} · {row.consent ? "用户同意关单" : "用户不同意关单"} · 原因 {row.reason} · 关单人 {row.closedBy} · 当时的服务人{" "}
                  {row.servicePersonId}
                </span>
              </a>
              <div className="mt-3 flex flex-wrap gap-2">
                {matchmaker ? (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() =>
                      void claim("/api/actions/claim-by-matchmaker", {
                        tenantId: workspace.tenantId,
                        memberId: row.memberId,
                        servicePersonId: account.personId,
                        today: workspace.today,
                      })
                    }
                  >
                    红娘领取
                  </Button>
                ) : null}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                void claim("/api/actions/claim-by-sales-or-invite", {
                  tenantId: workspace.tenantId,
                  memberId: row.memberId,
                  personId: account.personId,
                  role: "销售",
                  today: workspace.today,
                })
              }
            >
              销售领取
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                void claim("/api/actions/claim-by-sales-or-invite", {
                  tenantId: workspace.tenantId,
                  memberId: row.memberId,
                  personId: account.personId,
                  role: "邀约",
                  today: workspace.today,
                })
              }
            >
              邀约领取
            </Button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </Page>
  );
}
