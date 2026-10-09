import { useCallback, useEffect, useState, type ReactNode } from "react";
import { getJson, type Account, type Workspace } from "../api";
import { MemberAvatar } from "../components/MemberAvatar";
import { memberProfile } from "../memberProfile";
import { memberHref, returnHref } from "../returnTo";
import { Button } from "../components/ui/button";

type Row = { memberId: number; servicePersonId: number; shopId: number; source: string };

export function LibraryPage({ workspace, account }: { workspace: Workspace; account: Account }) {
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [error, setError] = useState("");
  const [rows, setRows] = useState<Row[]>([]);

  const load = useCallback(async () => {
    setPhase("loading");
    try {
      const data = await getJson<Row[]>(
        `/api/service-library?tenantId=${workspace.tenantId}&servicePersonId=${account.personId}`,
      );
      setRows(data);
      setPhase("ready");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "没有读出来");
      setPhase("error");
    }
  }, [account.personId, workspace.tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Page
      title="服务库"
      intro={`${account.name} 名下的会员。点开一位看详情。`}
    >
      <Status phase={phase} error={error} onRetry={() => void load()} loading="正在读取服务库。" />
      {phase === "ready" && rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">你手上现在很轻，名下没有在服务的会员。</p>
      ) : null}
      {phase === "ready" ? (
        <div className="overflow-hidden rounded-2xl border border-black/[0.055] bg-white shadow-card">
          {rows.map((row) => {
            const profile = memberProfile(row.memberId);
            return (
              <a
                key={row.memberId}
                href={memberHref(row.memberId)}
                className="flex items-center justify-between gap-3 border-b border-black/[0.045] px-5 py-3.5 last:border-b-0 hover:bg-surface"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <MemberAvatar name={profile.name} src={profile.avatar} placeholder={profile.placeholder} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{profile.name}</span>
                    <span className="mt-0.5 block text-[10px] text-muted-foreground">
                      会员 {row.memberId} · 门店 {row.shopId}
                    </span>
                  </span>
                </span>
                <span className="shrink-0 text-xs font-semibold text-primary">打开</span>
              </a>
            );
          })}
        </div>
      ) : null}
    </Page>
  );
}

export function Page({
  title,
  intro,
  children,
  back = false,
  fallback = "/",
}: {
  title: string;
  intro: string;
  children: ReactNode;
  back?: boolean;
  fallback?: string;
}) {
  return (
    <div className="grid gap-4">
      {back ? (
        <a
          href={returnHref(fallback)}
          className="inline-flex w-fit items-center gap-2 rounded-xl border border-black/[0.08] bg-white px-3 py-2 text-sm font-semibold text-foreground shadow-card"
        >
          <span aria-hidden="true">←</span>
          返回
        </a>
      ) : null}
      <div>
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-primary">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
          业务
        </div>
        <h1 className="text-[30px] font-bold tracking-[-0.04em]">{title}</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{intro}</p>
      </div>
      {children}
    </div>
  );
}

export function Status(props: { phase: "loading" | "error" | "ready"; error: string; onRetry: () => void; loading: string }) {
  if (props.phase === "loading") return <p className="text-sm text-muted-foreground">{props.loading}</p>;
  if (props.phase === "error") {
    return (
      <div className="grid gap-2">
        <p className="text-sm text-destructive">没有读出来。{props.error}</p>
        <Button type="button" variant="outline" size="sm" onClick={props.onRetry}>
          再试一次
        </Button>
      </div>
    );
  }
  return null;
}
