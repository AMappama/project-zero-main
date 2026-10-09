import { useEffect, useState } from "react";
import { getJson, postAction, type Account } from "../api";

export function SignInPage({ onSignedIn }: { onSignedIn: (account: Account) => void }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [error, setError] = useState("");
  const [pendingId, setPendingId] = useState<number | null>(null);

  useEffect(() => {
    getJson<Account[]>("/api/accounts")
      .then((rows) => {
        setAccounts(rows);
        setPhase("ready");
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "没有读出来");
        setPhase("error");
      });
  }, []);

  async function signIn(accountId: number) {
    setPendingId(accountId);
    setError("");
    try {
      const account = await postAction<Account>("/api/sign-in", { accountId });
      onSignedIn(account);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "没有登录");
      setPendingId(null);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-background px-5 py-10 text-foreground">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-[14px] bg-primary text-sm font-bold text-white">牵</div>
          <div>
            <div className="text-lg font-bold tracking-[-0.03em]">牵线宝</div>
            <div className="text-[10px] font-medium tracking-[0.16em] text-muted-foreground">选择一个账号进入</div>
          </div>
        </div>
        <h1 className="text-[30px] font-bold tracking-[-0.04em]">登录</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">选一个账号进入工作台。带审核权限的账号，可以顺手把审核一起处理了。</p>
        {phase === "loading" ? <p className="mt-6 text-sm text-muted-foreground">正在读取账号。</p> : null}
        {phase === "error" ? <p className="mt-6 text-sm text-destructive">账号没有读出来。{error}</p> : null}
        {phase === "ready" && accounts.length === 0 ? <p className="mt-6 text-sm text-muted-foreground">还没有可登录的账号。</p> : null}
        <div className="mt-6 grid gap-3">
          {accounts.map((account) => (
            <button
              key={account.id}
              type="button"
              disabled={pendingId != null}
              onClick={() => void signIn(account.id)}
              className="flex items-center justify-between rounded-2xl border border-black/[0.06] bg-white px-4 py-4 text-left shadow-card transition hover:border-primary/30 disabled:opacity-60"
            >
              <span>
                <span className="block text-sm font-semibold">{account.name}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{account.permissions.join("、")}</span>
              </span>
              <span className="text-xs font-semibold text-primary">{pendingId === account.id ? "正在进入" : "进入"}</span>
            </button>
          ))}
        </div>
        {error && phase === "ready" ? <p className="mt-4 text-sm text-destructive">{error}</p> : null}
      </div>
    </div>
  );
}
