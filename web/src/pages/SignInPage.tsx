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
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="relative hidden flex-[1.1] flex-col overflow-hidden bg-[#211D1A] px-[60px] py-14 text-[#F5F1EA] md:flex">
        <div className="pointer-events-none absolute -right-[140px] -bottom-[140px] h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle,rgba(205,63,107,0.28),transparent_65%)]" />
        <div className="pointer-events-none absolute -top-20 -left-20 h-[260px] w-[260px] rounded-full border border-white/6" />
        <div className="relative flex items-center gap-3">
          <div className="grid h-[34px] w-[34px] place-items-center rounded-[10px] bg-[linear-gradient(135deg,#EE6C90,#B02E57)] text-sm font-extrabold text-white shadow-[0_6px_16px_rgba(205,63,107,0.35)]">牵</div>
          <div>
            <div className="text-[15px] font-bold">牵线宝</div>
            <div className="text-[10px] tracking-[0.16em] text-[#7E766B]">服务工作台</div>
          </div>
        </div>
        <h1 className="page-title relative mt-16 max-w-[14em] text-[34px] leading-[1.4]">
          一根<span className="text-[#F5A8C0]">红线</span>，
          <br />
          把要人看的事牵到眼前。
        </h1>
        <p className="relative mt-[18px] max-w-[38em] text-[13px] leading-[1.9] text-[#A79E92]">
          红娘看待判断和例外，并确认这些动作。审核人加在红娘账号上，一次登录就能通过或驳回。没有审核权限的人看不到审核，也不能通过或驳回。
        </p>
        <div className="relative mt-auto flex items-center gap-3 pt-10 text-[11px] tracking-[0.2em] text-[#6E665C]">
          <span className="h-px flex-1 bg-gradient-to-r from-transparent to-[#6E665C]" />
          EST. 2026 · 履约账本
        </div>
      </aside>
      <div className="grid flex-1 place-items-center px-6 py-10">
        <div className="w-[360px] max-w-full rounded-[20px] border border-border bg-white px-8 py-[34px] shadow-[0_4px_12px_rgba(34,31,28,0.08),0_1px_3px_rgba(34,31,28,0.05)]">
          <h2 className="font-sans text-[19px] font-extrabold">登录</h2>
          <p className="mt-2 mb-[22px] text-xs leading-[1.8] text-muted-foreground">选择一个账号进入。动作以账号名义落账，谁确认的、谁审的，账上都看得见。</p>
          {phase === "loading" ? <p className="text-[13px] text-muted-foreground">正在读取账号。</p> : null}
          {phase === "error" ? <p className="text-[13px] text-destructive">账号没有读出来。{error}</p> : null}
          {phase === "ready" && accounts.length === 0 ? <p className="text-[13px] text-muted-foreground">还没有可登录的账号。</p> : null}
          <div className="grid gap-2.5">
            {accounts.map((account) => (
              <button
                key={account.id}
                type="button"
                disabled={pendingId != null}
                onClick={() => void signIn(account.id)}
                className="flex items-center gap-3 rounded-xl border border-border bg-white px-3.5 py-3 text-left transition duration-150 hover:border-primary hover:shadow-[0_0_0_3px_rgba(205,63,107,0.1)] disabled:opacity-60"
              >
                <span className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-full bg-[linear-gradient(135deg,#EAD9C6,#D9BFA3)] text-[13px] font-bold text-[#8A6B45]">
                  {account.name.slice(0, 1)}
                </span>
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-bold">{account.name}</span>
                  <span className="mt-0.5 block text-[11px] text-[#8A8177]">{account.permissions.join(" · ")}</span>
                </span>
                <span className="ml-auto text-xs font-bold text-primary">{pendingId === account.id ? "正在进入" : "进入 →"}</span>
              </button>
            ))}
          </div>
          {error && phase === "ready" ? <p className="mt-4 text-[13px] text-destructive">{error}</p> : null}
          <p className="mt-[18px] text-center text-[11px] text-[#8A8177]">登录即代表你确认今天的履约账本由你经手</p>
        </div>
      </div>
    </div>
  );
}
