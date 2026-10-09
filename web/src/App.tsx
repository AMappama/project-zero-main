import { useEffect, useState } from "react";
import { formatDay, getJson, hasPermission, postAction, type Account, type Workspace } from "./api";
import { loadMemberProfiles } from "./memberProfile";
import { HomePage } from "./pages/HomePage";
import { SignInPage } from "./pages/SignInPage";
import { LibraryPage } from "./pages/LibraryPage";
import { MeetingDetailPage } from "./pages/MeetingDetailPage";
import { MeetingsPage } from "./pages/MeetingsPage";
import { MemberPage } from "./pages/MemberPage";
import { OverduePage } from "./pages/OverduePage";
import { ReviewDetailPage } from "./pages/ReviewDetailPage";
import { ReviewsPage } from "./pages/ReviewsPage";

const NAV = [
  {
    label: "红娘工作台",
    items: [
      { href: "/", label: "服务跟进" },
      { href: "/library", label: "服务库" },
      { href: "/meetings", label: "约会" },
      { href: "/reviews", label: "审核列表" },
      { href: "/overdue", label: "过期 VIP" },
    ],
  },
];

const TITLES: Record<string, string> = {
  "/": "服务跟进",
  "/library": "服务库",
  "/meetings": "约会",
  "/reviews": "审核列表",
  "/overdue": "过期 VIP",
};

export function App() {
  const path = window.location.pathname;
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [error, setError] = useState("");
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [sessionPhase, setSessionPhase] = useState<"loading" | "ready">("loading");
  const [navOpen, setNavOpen] = useState(false);
  const [, setNamesReady] = useState(false);

  useEffect(() => {
    fetch("/api/session")
      .then(async (response) => {
        if (response.ok) setAccount((await response.json()) as Account);
        setSessionPhase("ready");
      })
      .catch(() => setSessionPhase("ready"));
  }, []);

  useEffect(() => {
    if (!account) return;
    loadMemberProfiles()
      .then(() => setNamesReady(true))
      .catch(() => setNamesReady(false));
    getJson<Workspace>("/api/workspace")
      .then((data) => {
        setWorkspace(data);
        setPhase("ready");
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "没有读出来");
        setPhase("error");
      });
  }, [account]);

  if (sessionPhase === "loading") {
    return <p className="grid min-h-screen place-items-center bg-background text-sm text-muted-foreground">正在确认账号。</p>;
  }
  if (!account) return <SignInPage onSignedIn={setAccount} />;

  const reviewer = hasPermission(account, "审核人");
  const permissionLabel = account.permissions.join("、");
  const memberMatch = path.match(/^\/members\/(\d+)$/);
  const meetingMatch = path.match(/^\/meetings\/(\d+)$/);
  const reviewMatch = path.match(/^\/reviews\/(\d+)$/);
  const title = memberMatch ? "会员" : meetingMatch ? "约会" : reviewMatch ? "审核" : (TITLES[path] ?? "服务跟进");

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen max-w-[1720px]">
        {navOpen ? (
          <button type="button" aria-label="关闭导航" className="fixed inset-0 z-30 bg-black/25 lg:hidden" onClick={() => setNavOpen(false)} />
        ) : null}
        <aside
          className={`fixed inset-y-0 left-0 z-40 flex w-[248px] shrink-0 flex-col overflow-y-auto border-r border-black/[0.06] bg-[#FBFAF8] px-4 py-5 transition-transform lg:sticky lg:top-0 lg:h-screen ${navOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}
        >
          <div className="flex items-center gap-3 px-2">
            <div className="grid h-10 w-10 place-items-center rounded-[14px] bg-[#5B55D6] text-sm font-bold text-white shadow-[0_8px_24px_rgba(91,85,214,0.24)]">牵</div>
            <div>
              <div className="text-lg font-bold tracking-[-0.03em]">牵线宝</div>
              <div className="text-[10px] font-medium tracking-[0.16em] text-[#9B9992]">服务工作台</div>
            </div>
          </div>
          <nav className="mt-8 space-y-5">
            {NAV.map((group) => (
              <div key={group.label}>
                <p className="mb-1.5 px-3 text-[10px] font-semibold tracking-[0.12em] text-[#A09D96]">{group.label}</p>
                <div className="space-y-1">
                  {group.items.filter((item) => item.href !== "/reviews" || reviewer).map((item) => {
                    const active = item.href === "/" ? path === "/" : path === item.href || path.startsWith(`${item.href}/`);
                    return (
                      <a
                        key={item.href}
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition ${active ? "bg-[#ECEAFB] text-[#5049C5]" : "text-[#74716B] hover:bg-black/[0.035] hover:text-[#252523]"}`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-[#5B55D6]" : "bg-[#D5D2CC]"}`} />
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      </a>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
          <div className="mt-auto flex items-center gap-3 px-1 pt-5">
            <Avatar initials={account.name.slice(0, 1)} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{account.name}</div>
              <div className="truncate text-xs text-[#9B9992]">{permissionLabel}</div>
            </div>
          </div>
        </aside>
        <main className="min-w-0 flex-1">
          <header className="sticky top-0 z-20 flex h-[76px] items-center justify-between gap-3 border-b border-black/[0.05] bg-[#F6F5F2]/90 px-5 backdrop-blur-md sm:px-8 lg:px-10">
            <button
              type="button"
              className="grid h-9 w-9 place-items-center rounded-xl bg-[#5B55D6] text-sm font-semibold text-white lg:hidden"
              onClick={() => setNavOpen(true)}
            >
              菜单
            </button>
            <div className="hidden items-center gap-3 sm:flex">
              <span className="text-sm font-semibold">{title}</span>
              <span className="rounded-full border border-black/[0.06] bg-white/70 px-3 py-1.5 text-[10px] font-semibold text-[#68655F]">履约账本</span>
              <span className="text-[10px] text-[#9B9992]">{workspace ? formatDay(workspace.today) : "读取工作日"}</span>
            </div>
            <div className="ml-auto flex items-center gap-3">
              <div className="hidden text-right sm:block">
                <p className="text-xs font-semibold text-[#5F5C56]">{account.name}</p>
                <p className="mt-0.5 text-[10px] text-[#9B9992]">{permissionLabel}</p>
              </div>
              <button
                type="button"
                className="rounded-xl border border-black/[0.07] bg-white px-3 py-2 text-[10px] font-semibold text-[#5F5C56]"
                onClick={() => {
                  void postAction("/api/sign-out", {}).finally(() => setAccount(null));
                }}
              >
                退出
              </button>
              <Avatar initials={account.name.slice(0, 1)} small />
            </div>
          </header>
          <div className="mx-auto max-w-[1420px] px-5 py-7 sm:px-8 lg:px-10 lg:py-9">
            {phase === "loading" ? <p className="text-sm text-[#77746E]">正在进入服务跟进。</p> : null}
            {phase === "error" ? <p className="text-sm text-[#B54E61]">工作台没有读出来。{error}</p> : null}
            {phase === "ready" && workspace ? (
              <Route
                path={path}
                memberId={memberMatch ? Number(memberMatch[1]) : null}
                meetingId={meetingMatch ? Number(meetingMatch[1]) : null}
                applicationId={reviewMatch ? Number(reviewMatch[1]) : null}
                workspace={workspace}
                account={account}
              />
            ) : null}
          </div>
        </main>
      </div>
    </div>
  );
}

function Avatar({ initials, small = false }: { initials: string; small?: boolean }) {
  return (
    <span className={`grid shrink-0 place-items-center rounded-full bg-[#E9E2F5] font-semibold text-[#675385] ${small ? "h-9 w-9 text-xs" : "h-10 w-10 text-sm"}`}>
      {initials}
    </span>
  );
}

function Route(props: {
  path: string;
  memberId: number | null;
  meetingId: number | null;
  applicationId: number | null;
  workspace: Workspace;
  account: Account;
}) {
  if (props.path === "/") return <HomePage workspace={props.workspace} account={props.account} />;
  if (props.path === "/library") return <LibraryPage workspace={props.workspace} account={props.account} />;
  if (props.path === "/overdue") return <OverduePage workspace={props.workspace} account={props.account} />;
  if (props.path === "/meetings") return <MeetingsPage workspace={props.workspace} account={props.account} />;
  if (props.meetingId != null) return <MeetingDetailPage workspace={props.workspace} meetingId={props.meetingId} />;
  if (props.path === "/reviews") return <ReviewsPage workspace={props.workspace} account={props.account} />;
  if (props.applicationId != null) return <ReviewDetailPage workspace={props.workspace} account={props.account} applicationId={props.applicationId} />;
  if (props.memberId != null) return <MemberPage workspace={props.workspace} memberId={props.memberId} />;
  return <p className="text-sm text-[#77746E]">没有这一页。</p>;
}
