"use client";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Activity,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BookOpen,
  Bot,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  CreditCard,
  Download,
  ExternalLink,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Menu,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  Users,
  X,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
type View =
  | "Overview"
  | "Subscribers"
  | "Membership plans"
  | "Transactions"
  | "Bot & channels"
  | "Support & terms"
  | "Operations"
  | "Settings"
  | "Platform operator";
const navigation: [View, LucideIcon][] = [
  ["Overview", LayoutDashboard],
  ["Subscribers", Users],
  ["Membership plans", BookOpen],
  ["Transactions", ArrowDownLeft],
  ["Bot & channels", Bot],
  ["Support & terms", CircleHelp],
  ["Operations", Activity],
];
type Data = any;
const fmt = (n: number) => new Intl.NumberFormat("en-US").format(n);
function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return (
    <span className={`badge ${tone}`}>
      <span className="badge-dot" />
      {children}
    </span>
  );
}
function Empty({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <BookOpen size={25} />
      </span>
      <h3>{title}</h3>
      <p>{detail}</p>
      {action}
    </div>
  );
}
function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} onCancel={onClose} className="modal">
      <div className="modal-heading">
        <h2>{title}</h2>
        <button
          aria-label="Close dialog"
          className="icon-button"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export default function Dashboard() {
  const [session, setSession] = useState<Data>(null),
    [data, setData] = useState<Data>(null),
    [view, setView] = useState<View>("Overview"),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [modal, setModal] = useState<Data>(null),
    [mobile, setMobile] = useState(false),
    [tenantId, setTenantId] = useState(""),
    [recordQuery, setRecordQuery] = useState(""),
    [range, setRange] = useState({ from: "", to: "" });
  const searchRef = useRef<HTMLInputElement>(null);
  const requestSequence = useRef(0);
  const headers = () => ({
    "content-type": "application/json",
    "x-csrf-token": session?.csrf ?? "",
    "x-tenant-id": tenantId,
  });
  async function load(id = tenantId, quiet = false) {
    if (!id) return;
    const sequence = ++requestSequence.current;
    if (!quiet) setLoading(true);
    try {
      const query = new URLSearchParams({
        search,
        records: recordQuery,
        page: String(page),
      });
      if (range.from)
        query.set("from", new Date(`${range.from}T00:00:00Z`).toISOString());
      if (range.to)
        query.set(
          "to",
          new Date(
            new Date(`${range.to}T00:00:00Z`).getTime() + 86400000,
          ).toISOString(),
        );
      const r = await fetch(`/api/state?${query}`, {
        headers: { "x-tenant-id": id },
      });
      const v = await r.json();
      if (!r.ok) throw new Error(v.error);
      if (sequence !== requestSequence.current) return;
      setData(v);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    fetch("/api/session")
      .then(async (r) => {
        if (r.status === 401) {
          window.location.assign("/login");
          return;
        }
        const s = await r.json();
        if (!r.ok) throw new Error(s.error);
        setSession(s);
        if (s.tenants.length) setTenantId(s.tenants[0].id);
        else {
          setModal({ kind: "workspace" });
          setLoading(false);
        }
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => load(), 250);
    return () => clearTimeout(timer);
  }, [tenantId, search, page, range, recordQuery, view]);
  useEffect(() => {
    if (!tenantId) return;
    const timer = setInterval(() => load(tenantId, true), 30000);
    const refresh = () => {
      if (document.visibilityState === "visible") void load(tenantId, true);
    };
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [tenantId, search, page, range, recordQuery, view]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  async function mutate(path: string, body: unknown, method = "POST") {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/${path}`, {
        method,
        headers: headers(),
        body: JSON.stringify(body),
      });
      const v = await r.json();
      if (!r.ok) throw new Error(v.error);
      setModal(null);
      setNotice("Saved. Provider actions may still be pending.");
      if (path === "tenants") window.location.reload();
      else await load(tenantId, true);
      return v;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  const nav = (v: View) => {
    setRecordQuery("");
    setView(v);
    setMobile(false);
    setNotice("");
  };
  const date = (value: string) =>
    new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: data?.tenant.timezone ?? "UTC",
    }).format(new Date(value));
  const subscriber = (id: string) =>
    data?.subscribers.find((s: Data) => s.id === id);
  const status = (id: string) => {
    const ms =
      data?.memberships.filter((m: Data) => m.subscriberId === id) ?? [];
    if (ms.some((m: Data) => m.desired === "ACTIVE_MEMBER"))
      return ["Active member", "green"];
    if (ms.some((m: Data) => m.desired === "MODERATOR_BLOCKED"))
      return ["Moderator blocked", "red"];
    const current = data?.grants.some(
      (g: Data) =>
        g.subscriberId === id &&
        !g.revokedAt &&
        new Date(g.startsAt) <= new Date() &&
        new Date(g.expiresAt) > new Date(),
    );
    return current
      ? ["Access pending", "amber"]
      : ["No active access", "neutral"];
  };
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const get = (k: string) => String(f.get(k) ?? "");
    switch (modal.kind) {
      case "workspace":
        return mutate("tenants", {
          name: get("name"),
          timezone: get("timezone"),
        });
      case "bot":
        return mutate("bots", { token: get("token") });
      case "chat":
        return mutate("chats", { telegramId: get("telegramId") });
      case "policy":
        return mutate("policies", {
          terms: get("terms"),
          refunds: get("refunds"),
          privacy: get("privacy"),
          support: get("support"),
        });
      case "plan":
        return mutate(
          modal.plan ? `plans/${modal.plan.id}` : "plans",
          {
            name: get("name"),
            kind: get("kind"),
            stars: Number(get("stars")),
            policyId: get("policyId"),
            chatIds: f.getAll("chatIds"),
          },
          modal.plan ? "PATCH" : "POST",
        );
      case "grant":
        return mutate(`subscribers/${modal.id}/grants`, {
          chatId: get("chatId"),
          expiresAt: new Date(get("expiresAt")).toISOString(),
          reason: get("reason"),
          confirm: true,
        });
      default:
        return mutate(modal.path, { reason: get("reason"), confirm: true });
    }
  }
  const confirm = (title: string, path: string, detail: string) =>
    setModal({ kind: "confirm", title, path, detail });
  const formFooter = (
    <div className="form-footer">
      <button
        type="button"
        className="button secondary"
        onClick={() => setModal(null)}
      >
        Cancel
      </button>
      <button className="button" disabled={busy}>
        {busy ? (
          <>
            <LoaderCircle className="spin" size={16} /> Saving…
          </>
        ) : modal?.kind === "confirm" ? (
          "Confirm action"
        ) : (
          "Save changes"
        )}
      </button>
    </div>
  );
  const fields = {
    workspace: (
      <>
        <label>
          Workspace name
          <input
            name="name"
            required
            minLength={2}
            placeholder="The Learning Room"
          />
        </label>
        <label>
          Display timezone
          <input
            name="timezone"
            defaultValue={Intl.DateTimeFormat().resolvedOptions().timeZone}
            required
          />
        </label>
      </>
    ),
    bot: (
      <>
        <p className="form-help">
          Create a bot with @BotFather. Your token is encrypted and never sent
          back to the browser. Connecting checks the token; activating the
          webhook is a separate step.
        </p>
        <label>
          Bot token
          <input
            name="token"
            type="password"
            autoComplete="off"
            required
            placeholder="123456789:AA…"
          />
        </label>
      </>
    ),
    chat: (
      <>
        <p className="form-help">
          Add your bot as an administrator with Invite Users and Ban/Restrict
          Members rights. Your Telegram account must also be an owner or admin.
          Public chats cannot be paywalled.
        </p>
        <label>
          Private channel / supergroup ID
          <input
            name="telegramId"
            required
            pattern="-[0-9]+"
            placeholder="-1001234567890"
          />
        </label>
      </>
    ),
    policy: (
      <>
        <label>
          Creator support contact
          <input
            name="support"
            required
            maxLength={200}
            placeholder="@your_support"
          />
        </label>
        <label>
          Purchase terms
          <textarea
            name="terms"
            required
            minLength={10}
            maxLength={1400}
            placeholder="Explain what members receive and when access ends."
          />
        </label>
        <label>
          Refund policy
          <textarea name="refunds" required minLength={10} maxLength={600} />
        </label>
        <label>
          Privacy & data requests
          <textarea name="privacy" required minLength={10} maxLength={1000} />
        </label>
        <p className="form-help">
          Publishing creates a new immutable version. Existing purchases retain
          the policy they accepted.
        </p>
      </>
    ),
    plan: (
      <>
        <label>
          Plan name
          <input
            name="name"
            required
            minLength={2}
            maxLength={32}
            defaultValue={modal?.plan?.name}
          />
        </label>
        <div className="form-row">
          <label>
            Membership type
            <select
              name="kind"
              defaultValue={modal?.plan?.version.kind ?? "RECURRING_30D"}
            >
              <option value="RECURRING_30D">30-day auto-renewing</option>
              <option value="PREPAID_90D">90-day prepaid</option>
              <option value="PREPAID_365D">365-day prepaid</option>
            </select>
          </label>
          <label>
            Price in Stars
            <input
              name="stars"
              type="number"
              min={1}
              step={1}
              max={1000000}
              required
              defaultValue={modal?.plan?.version.stars ?? 450}
            />
          </label>
        </div>
        <p className="form-help">
          Native recurring plans renew every 30 days and have a 10,000 Stars
          ceiling. Prepaid plans are one-time purchases.
        </p>
        <label>
          Purchase policy
          <select
            name="policyId"
            required
            defaultValue={modal?.plan?.version.policyId}
          >
            <option value="">Select a published policy</option>
            {data?.policies.map((p: Data) => (
              <option value={p.id} key={p.id}>
                {p.support} · {date(p.createdAt)}
              </option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend>Private chat access</legend>
          {data?.chats.map((c: Data) => (
            <label key={c.id} className="checkbox">
              <input
                name="chatIds"
                type="checkbox"
                value={c.id}
                defaultChecked={modal?.plan?.version.chatIds.includes(c.id)}
              />
              {c.title} {!c.healthy && "(needs repair)"}
            </label>
          ))}
        </fieldset>
        <p className="form-help">
          Changes create a new version. Existing paid grants are preserved.
        </p>
      </>
    ),
    grant: (
      <>
        <p className="form-help">
          Add a dated manual exception. This does not modify payment history.
        </p>
        <label>
          Chat
          <select name="chatId" required>
            {data?.chats.map((c: Data) => (
              <option value={c.id} key={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Expires at (your browser timezone)
          <input name="expiresAt" type="datetime-local" required />
        </label>
        <label>
          Reason
          <textarea name="reason" minLength={5} maxLength={500} required />
        </label>
      </>
    ),
  };
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobile ? "mobile-open" : ""}`}>
        <a href="/" className="brand">
          <span className="brand-icon">
            <Send size={20} />
          </span>
          TeleTier<span className="version-tag">CREATOR</span>
        </a>
        <div className="workspace-switch">
          <span className="workspace-avatar">
            {(data?.tenant.name ?? "Workspace").slice(0, 1)}
          </span>
          <div>
            <span className="small muted">Your workspace</span>
            <select
              aria-label="Select workspace"
              value={tenantId}
              onChange={(e) => {
                setPage(1);
                setTenantId(e.target.value);
              }}
            >
              {session?.tenants.map((t: Data) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <ChevronDown size={14} />
        </div>
        <span className="nav-label">MANAGE COMMUNITY</span>
        <nav aria-label="Main navigation">
          {navigation.map(([name, Icon]) => (
            <button
              key={name}
              onClick={() => nav(name)}
              className={`nav-item ${view === name ? "selected" : ""}`}
            >
              <Icon size={18} />
              <span>{name}</span>
              {name === "Operations" && data?.metrics.openIncidents > 0 && (
                <span className="nav-count">{data.metrics.openIncidents}</span>
              )}
              {view === name && <span className="selected-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-tip">
            <span>
              <Sparkles size={17} /> A space to grow
            </span>
            <p>
              Your expertise brings people together. We help with the details.
            </p>
            <button onClick={() => nav("Support & terms")}>
              Set up member support <ArrowRight size={14} />
            </button>
          </div>
          <button
            className={`nav-item ${view === "Settings" ? "selected" : ""}`}
            onClick={() => nav("Settings")}
          >
            <Settings size={18} />
            Settings
          </button>
          <div className="sidebar-user">
            <span className="avatar">
              {session?.user.name
                .split(" ")
                .map((n: string) => n[0])
                .slice(0, 2)
                .join("") ?? "…"}
            </span>
            <div>
              <strong>{session?.user.name ?? "Loading…"}</strong>
              <span>Workspace owner</span>
            </div>
            <button
              className="icon-button"
              aria-label="Sign out"
              onClick={async () => {
                await mutate("auth/logout", {});
                window.location.assign("/login");
              }}
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <button
            className="icon-button mobile-toggle"
            aria-label="Toggle navigation"
            onClick={() => setMobile(!mobile)}
          >
            <Menu size={21} />
          </button>
          <div className="breadcrumb">
            Workspace <ChevronRight size={13} />
            <strong>{view}</strong>
          </div>
          <div className="topbar-actions">
            <label className="search-box">
              <Search size={16} />
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                  setView("Subscribers");
                }}
                placeholder="Search members…"
                aria-label="Search subscribers"
              />
              <kbd>⌘ K</kbd>
            </label>
            <button
              className="icon-button notification-bell"
              aria-label="View operational incidents"
              onClick={() => nav("Operations")}
            >
              <Bell size={19} />
              {data?.metrics.openIncidents > 0 && <span />}
            </button>
            <span className="avatar small-avatar">
              {session?.user.name.slice(0, 1) ?? "A"}
            </span>
          </div>
        </header>
        <main className="main-content">
          {data?.fake && (
            <div className="sandbox-banner">
              <ShieldCheck size={15} />
              <strong>Local sandbox</strong>
              <span>
                Telegram responses are simulated. Stars shown here are test
                data.
              </span>
            </div>
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow muted">YOUR COMMUNITY, AT A GLANCE</div>
              <h1>{view === "Overview" ? "Community overview" : view}</h1>
              <p>
                {
                  {
                    Overview:
                      "A little clarity for everything you’re building.",
                    Subscribers:
                      "The people behind your community. Keep their access in view.",
                    "Membership plans":
                      "Thoughtful memberships, clear terms, and the right access.",
                    Transactions:
                      "Every confirmed charge and refund, accounted for in Stars.",
                    "Bot & channels":
                      "Your Telegram connections, permissions, and access health.",
                    "Support & terms":
                      "Give members clear expectations and a real way to reach you.",
                    Operations:
                      "Keep an eye on deliveries, access changes, and anything needing care.",
                    Settings:
                      "Workspace preferences, data, and account controls.",
                    "Platform operator":
                      "Protected cross-workspace incident inspection.",
                  }[view]
                }
              </p>
            </div>
            <div className="heading-actions">
              <button
                className="button secondary compact"
                disabled={loading}
                onClick={() => load()}
                aria-label="Refresh workspace"
              >
                <RefreshCw size={15} className={loading ? "spin" : ""} />
              </button>
              {view === "Membership plans" ? (
                <button
                  className="button"
                  onClick={() => setModal({ kind: "plan" })}
                >
                  <Plus size={16} />
                  Create plan
                </button>
              ) : view === "Bot & channels" ? (
                <button
                  className="button"
                  onClick={() => setModal({ kind: data?.bot ? "chat" : "bot" })}
                >
                  <Plus size={16} />
                  {data?.bot ? "Add private chat" : "Connect bot"}
                </button>
              ) : view === "Support & terms" ? (
                <button
                  className="button"
                  onClick={() => setModal({ kind: "policy" })}
                >
                  <Plus size={16} />
                  Publish policy
                </button>
              ) : (
                <button
                  className="button secondary"
                  onClick={() => setModal({ kind: "dates" })}
                >
                  <CalendarDays size={15} />
                  {range.from ? "Custom range" : "Last 30 days"}
                  <ChevronDown size={13} />
                </button>
              )}
            </div>
          </div>
          {error && !modal && (
            <div className="error" role="alert">
              <TriangleAlert size={17} />
              {error}
              <button className="text-button" onClick={() => load()}>
                Retry
              </button>
            </div>
          )}
          {notice && (
            <div className="notice" role="status">
              <CheckCircle2 size={16} />
              {notice}
              <button
                className="icon-button"
                onClick={() => setNotice("")}
                aria-label="Dismiss notification"
              >
                <X size={15} />
              </button>
            </div>
          )}
          {loading && !data ? (
            <div className="loading">
              <LoaderCircle className="spin" />
              Loading your workspace…
            </div>
          ) : !data ? (
            <Empty
              title="Let’s make room for your community"
              detail="Create a workspace to start connecting your bot, chats, and memberships."
              action={
                <button
                  className="button"
                  onClick={() => setModal({ kind: "workspace" })}
                >
                  <Plus size={16} />
                  Create workspace
                </button>
              }
            />
          ) : (
            <>
              {view === "Overview" && (
                <>
                  <section className="metrics-grid">
                    {[
                      [
                        Users,
                        "Active paid members",
                        fmt(data.metrics.activePaid),
                        "Unique members with current paid access",
                        "green",
                      ],
                      [
                        Star,
                        "Stars received",
                        fmt(data.metrics.gross),
                        "Gross confirmed charges in this period",
                        "green",
                      ],
                      [
                        Clock3,
                        "Access pending",
                        fmt(data.metrics.pending),
                        "Entitled members waiting to join",
                        "amber",
                      ],
                      [
                        Activity,
                        "Needs attention",
                        fmt(data.metrics.openIncidents),
                        "Open operational incidents",
                        data.metrics.openIncidents ? "red" : "green",
                      ],
                    ].map(([Icon, title, value, detail, tone]) => {
                      const I = Icon as LucideIcon;
                      return (
                        <article className="metric-card" key={String(title)}>
                          <div className="metric-top">
                            <span>{String(title)}</span>
                            <span className={`metric-icon ${tone}`}>
                              <I size={17} />
                            </span>
                          </div>
                          <div className="metric-value">
                            {String(value)}
                            {title === "Stars received" && (
                              <span className="value-unit">XTR</span>
                            )}
                          </div>
                          <p>{String(detail)}</p>
                        </article>
                      );
                    })}
                  </section>
                  <div className="charts-grid">
                    <article className="panel revenue-panel">
                      <div className="panel-heading">
                        <div>
                          <h2>
                            Stars activity{" "}
                            <span
                              className="info-dot"
                              title="Confirmed charges by UTC day in the selected period"
                            >
                              i
                            </span>
                          </h2>
                          <p>Real payments. A clearer picture.</p>
                        </div>
                        <span className="chart-legend">
                          <span className="dot" /> Stars received
                        </span>
                      </div>
                      <RevenueChart
                        payments={data.payments}
                        period={data.period}
                      />
                      <div className="chart-footer">
                        <span>
                          Confirmed charges · {date(data.period.from)} –{" "}
                          {date(data.period.to)}
                        </span>
                        <button
                          onClick={() => nav("Transactions")}
                          className="text-button"
                        >
                          View transactions <ArrowRight size={14} />
                        </button>
                      </div>
                    </article>
                    <article className="panel access-panel">
                      <div className="panel-heading">
                        <div>
                          <h2>Member access</h2>
                          <p>Observed state across your chats</p>
                        </div>
                        <Users size={18} className="muted" />
                      </div>
                      <AccessDonut memberships={data.memberships} />
                      <div className="access-note">
                        <ShieldCheck size={15} />
                        <span>
                          A purchase confirms payment.
                          <br />A verified join confirms access.
                        </span>
                      </div>
                    </article>
                  </div>
                  <div className="lower-grid">
                    <article className="panel">
                      <div className="panel-heading">
                        <div>
                          <h2>Your community</h2>
                          <p>A closer look at your newest members</p>
                        </div>
                        <button
                          className="text-button"
                          onClick={() => nav("Subscribers")}
                        >
                          View all members <ArrowRight size={14} />
                        </button>
                      </div>
                      {data.subscribers.length ? (
                        <MemberTable
                          subscribers={data.subscribers.slice(0, 5)}
                          grants={data.grants}
                          status={status}
                          date={date}
                          onGrant={(id: string) =>
                            setModal({ kind: "grant", id })
                          }
                        />
                      ) : (
                        <Empty
                          title="Your first member starts here"
                          detail="Publish a plan and share its Telegram purchase link."
                          action={
                            <button
                              className="text-button"
                              onClick={() => nav("Membership plans")}
                            >
                              Set up memberships <ArrowRight size={14} />
                            </button>
                          }
                        />
                      )}
                    </article>
                    <article className="panel connection-card">
                      <div className="panel-heading">
                        <h2>Community connections</h2>
                        <span className="feature-icon tiny">
                          <Bot size={17} />
                        </span>
                      </div>
                      <div className="connection-bot">
                        <span className="bot-avatar">
                          <Send size={24} />
                        </span>
                        <div>
                          <strong>
                            {data.bot
                              ? `@${data.bot.username}`
                              : "Connect your creator bot"}
                          </strong>
                          <span>
                            {data.bot
                              ? "Your Stars stay with your bot"
                              : "Bring a bot from @BotFather"}
                          </span>
                        </div>
                      </div>
                      <div className="connection-row">
                        <span>Bot status</span>
                        <Badge
                          tone={
                            data.bot?.status === "READY" ? "green" : "amber"
                          }
                        >
                          {data.bot?.status?.replaceAll("_", " ") ??
                            "Not connected"}
                        </Badge>
                      </div>
                      <div className="connection-row">
                        <span>Private chats</span>
                        <strong>{data.chats.length} connected</strong>
                      </div>
                      <div className="connection-row">
                        <span>Healthy chats</span>
                        <strong>
                          {data.chats.filter((c: Data) => c.healthy).length}{" "}
                          verified
                        </strong>
                      </div>
                      <button
                        className="button secondary full-width"
                        onClick={() => nav("Bot & channels")}
                      >
                        Manage connections <ArrowRight size={15} />
                      </button>
                      <p className="small muted">
                        Other admins and legacy invitation links can affect
                        access exclusivity.
                      </p>
                    </article>
                  </div>
                </>
              )}
              {view === "Subscribers" && (
                <article className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>
                        All subscribers{" "}
                        <span className="count-pill">
                          {data.subscriberCount}
                        </span>
                      </h2>
                      <p>
                        Paid access and actual chat membership are tracked
                        separately.
                      </p>
                    </div>
                    <span className="small muted">
                      Search by name or Telegram ID
                    </span>
                  </div>
                  {data.subscribers.length ? (
                    <MemberTable
                      subscribers={data.subscribers}
                      grants={data.grants}
                      status={status}
                      date={date}
                      onGrant={(id: string) => setModal({ kind: "grant", id })}
                    />
                  ) : (
                    <Empty
                      title={
                        search ? "No matching members" : "No subscribers yet"
                      }
                      detail="Members appear after they start your Telegram bot or join a managed chat."
                    />
                  )}
                  <div className="pagination">
                    <span>Page {page} · up to 50 members</span>
                    <div>
                      <button
                        className="icon-button"
                        aria-label="Previous page"
                        disabled={page === 1}
                        onClick={() => setPage(page - 1)}
                      >
                        <ChevronLeft size={17} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label="Next page"
                        disabled={page * 50 >= data.subscriberCount}
                        onClick={() => setPage(page + 1)}
                      >
                        <ChevronRight size={17} />
                      </button>
                    </div>
                  </div>
                  {data.grants.some(
                    (g: Data) => !g.paymentId && !g.revokedAt,
                  ) && (
                    <div className="manual-list">
                      <h3>Active manual exceptions</h3>
                      {data.grants
                        .filter((g: Data) => !g.paymentId && !g.revokedAt)
                        .map((g: Data) => (
                          <div className="connection-row" key={g.id}>
                            <span>
                              {subscriber(g.subscriberId)?.name ??
                                g.subscriberId}{" "}
                              · until {date(g.expiresAt)}
                            </span>
                            <button
                              className="text-button danger-text"
                              onClick={() =>
                                confirm(
                                  "Revoke manual access",
                                  `grants/${g.id}/revoke`,
                                  "This removes this manual exception. Other valid paid grants remain effective.",
                                )
                              }
                            >
                              Revoke exception
                            </button>
                          </div>
                        ))}
                    </div>
                  )}
                </article>
              )}
              {view === "Membership plans" && (
                <>
                  <div className="callout">
                    <Star size={19} />
                    <div>
                      <strong>Simple pricing. Honest durations.</strong>
                      <p>
                        Auto-renewing plans use 30-day periods. 90- and 365-day
                        memberships are prepaid once. All prices are in Telegram
                        Stars.
                      </p>
                    </div>
                  </div>
                  {data.plans.length ? (
                    <div className="plans-grid">
                      {data.plans.map((p: Data) => (
                        <article className="panel plan-card" key={p.id}>
                          <div className="plan-card-top">
                            <span className="feature-icon">
                              <BookOpen size={21} />
                            </span>
                            <Badge
                              tone={p.state === "ACTIVE" ? "green" : "neutral"}
                            >
                              {p.state.toLowerCase()}
                            </Badge>
                          </div>
                          <h2>{p.name}</h2>
                          <div className="plan-price">
                            <Star size={23} />
                            {fmt(p.version.stars)}
                            <span>Stars</span>
                          </div>
                          <p>
                            {p.version.kind === "RECURRING_30D"
                              ? "Renews every 30 days"
                              : p.version.kind === "PREPAID_90D"
                                ? "90-day prepaid membership"
                                : "365-day prepaid membership"}
                          </p>
                          <div className="plan-chats">
                            {p.version.chatIds.map((id: string) => (
                              <span key={id}>
                                <Check size={15} />
                                {data.chats.find((c: Data) => c.id === id)
                                  ?.title ?? "Private chat"}
                              </span>
                            ))}
                          </div>
                          <a
                            className="button secondary full-width"
                            target="_blank"
                            rel="noreferrer"
                            href={`https://t.me/${data.bot?.username}?start=p_${p.id}`}
                          >
                            Open purchase link <ExternalLink size={14} />
                          </a>
                          <div className="plan-actions">
                            <button
                              className="text-button"
                              onClick={() =>
                                setModal({ kind: "plan", plan: p })
                              }
                            >
                              Edit plan
                            </button>
                            {p.state === "ACTIVE" && (
                              <button
                                className="text-button muted"
                                onClick={() =>
                                  confirm(
                                    "Archive membership plan",
                                    `plans/${p.id}/archive`,
                                    "New purchases stop. Existing paid access and native subscriptions are preserved; manage cancellations separately.",
                                  )
                                }
                              >
                                Archive
                              </button>
                            )}
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <Empty
                      title="Create a membership worth joining"
                      detail="Connect your bot and a private chat, publish your terms, then set your Stars price."
                      action={
                        <button
                          className="button"
                          onClick={() => setModal({ kind: "plan" })}
                        >
                          <Plus size={16} />
                          Create first plan
                        </button>
                      }
                    />
                  )}
                </>
              )}
              {view === "Transactions" && (
                <>
                  <section className="financial-summary">
                    <div>
                      <span>Gross Stars received</span>
                      <strong>
                        {fmt(data.metrics.gross)} <Star size={19} />
                      </strong>
                    </div>
                    <div>
                      <span>Confirmed Stars refunded</span>
                      <strong>
                        {fmt(data.metrics.refunded)} <Star size={19} />
                      </strong>
                    </div>
                    <div>
                      <span>Net Stars in period</span>
                      <strong className="green-text">
                        {fmt(data.metrics.net)} <Star size={19} />
                      </strong>
                    </div>
                  </section>
                  <article className="panel">
                    <div className="panel-heading">
                      <div>
                        <h2>Charge history</h2>
                        <p>
                          Most recent 100 charges in the selected period. Stars
                          are not a fiat settlement figure.
                        </p>
                      </div>
                      <label className="record-search">
                        <Search size={15} />
                        <input
                          aria-label="Search charge and refund history"
                          placeholder="Search charge, refund or ID…"
                          value={recordQuery}
                          onChange={(e) => setRecordQuery(e.target.value)}
                        />
                      </label>
                    </div>
                    {data.payments.length ? (
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Charge / member</th>
                              <th>Date</th>
                              <th>Type</th>
                              <th>Stars</th>
                              <th>Status</th>
                              <th>
                                <span className="sr-only">Actions</span>
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.payments.map((p: Data) => {
                              const refund = data.paymentRefunds.find(
                                (r: Data) => r.chargeId === p.chargeId,
                              );
                              return (
                                <tr key={p.id}>
                                  <td>
                                    <strong className="mono" title={p.chargeId}>
                                      {p.chargeId.slice(0, 22)}
                                    </strong>
                                    <span className="cell-sub">
                                      {subscriber(p.subscriberId)?.name ??
                                        p.subscriberId.slice(0, 8)}
                                    </span>
                                  </td>
                                  <td>{date(p.paidAt)}</td>
                                  <td>
                                    {p.recurring ? "Recurring" : "Prepaid"}
                                  </td>
                                  <td className="strong">
                                    {fmt(p.stars)}{" "}
                                    <span className="muted">XTR</span>
                                  </td>
                                  <td>
                                    <Badge
                                      tone={
                                        refund?.status === "CONFIRMED"
                                          ? "neutral"
                                          : refund
                                            ? "amber"
                                            : "green"
                                      }
                                    >
                                      {refund?.status === "CONFIRMED"
                                        ? "Refunded"
                                        : refund
                                          ? "Refund pending"
                                          : "Confirmed"}
                                    </Badge>
                                  </td>
                                  <td>
                                    {!refund && (
                                      <button
                                        className="text-button"
                                        onClick={() =>
                                          confirm(
                                            "Request Stars refund",
                                            `payments/${p.id}/refund`,
                                            `Refund ${p.stars} Stars to the original buyer. Access from this charge is removed after Telegram confirms. This financial action cannot be undone.`,
                                          )
                                        }
                                      >
                                        Refund
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <Empty
                        title="A clean ledger, ready for your first sale"
                        detail="Only authenticated Telegram successful-payment events appear here."
                      />
                    )}
                  </article>
                  <article className="panel refund-history">
                    <div className="panel-heading">
                      <div>
                        <h2>Refund history</h2>
                        <p>
                          Latest 100 requests created in the selected period.
                          Totals above cover confirmed money events in the full
                          period.
                        </p>
                      </div>
                    </div>
                    {data.refunds.length ? (
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Refund / charge</th>
                              <th>Stars</th>
                              <th>State</th>
                              <th>Reason</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.refunds.map((r: Data) => (
                              <tr key={r.id}>
                                <td>
                                  <strong className="mono" title={r.id}>
                                    {r.id.slice(0, 12)}
                                  </strong>
                                  <span
                                    className="cell-sub mono"
                                    title={r.chargeId}
                                  >
                                    {r.chargeId.slice(0, 24)}
                                  </span>
                                </td>
                                <td>{fmt(r.stars)} XTR</td>
                                <td>
                                  <Badge
                                    tone={
                                      r.status === "CONFIRMED"
                                        ? "green"
                                        : "amber"
                                    }
                                  >
                                    {r.status.replaceAll("_", " ")}
                                  </Badge>
                                </td>
                                <td className="wrap-cell">{r.reason}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <Empty
                        title="No matching refund requests"
                        detail="Refund requests and provider confirmations remain visible here with stable references."
                      />
                    )}
                  </article>
                </>
              )}
              {view === "Bot & channels" && (
                <>
                  <article className="panel settings-panel">
                    <div className="panel-heading">
                      <div>
                        <h2>Your creator bot</h2>
                        <p>
                          One creator-owned bot per workspace. Credentials stay
                          encrypted.
                        </p>
                      </div>
                      {data.bot && (
                        <Badge
                          tone={data.bot.status === "READY" ? "green" : "amber"}
                        >
                          {data.bot.status.replaceAll("_", " ")}
                        </Badge>
                      )}
                    </div>
                    {data.bot ? (
                      <>
                        <div className="connection-bot">
                          <span className="bot-avatar">
                            <Send size={27} />
                          </span>
                          <div>
                            <h3>@{data.bot.username}</h3>
                            <span>
                              Telegram bot ID {data.bot.telegramId} · token
                              hidden
                            </span>
                          </div>
                        </div>
                        <div className="button-row">
                          <button
                            className="button secondary"
                            disabled={busy}
                            onClick={() => mutate("bots/health", {})}
                          >
                            <RefreshCw size={15} />
                            Check health
                          </button>
                          <button
                            className="button secondary"
                            onClick={() => setModal({ kind: "bot" })}
                          >
                            Rotate token
                          </button>
                          <button
                            className="button"
                            onClick={() => setModal({ kind: "handover" })}
                          >
                            Activate / repair webhook
                          </button>
                        </div>
                        <p className="form-help">
                          Webhook: {data.bot.webhookUrl ?? "Not configured"}.
                          Activation takes over delivery from the bot’s existing
                          integration. Pending updates are retained.
                        </p>
                      </>
                    ) : (
                      <Empty
                        title="Bring your own Telegram bot"
                        detail="Start with @BotFather, then connect your token here."
                        action={
                          <button
                            className="button"
                            onClick={() => setModal({ kind: "bot" })}
                          >
                            Connect bot
                          </button>
                        }
                      />
                    )}
                  </article>
                  <article className="panel">
                    <div className="panel-heading">
                      <div>
                        <h2>Private channels & groups</h2>
                        <p>
                          Creator authority and bot permissions are checked
                          before enrollment.
                        </p>
                      </div>
                      <button
                        className="text-button"
                        onClick={() => setModal({ kind: "chat" })}
                      >
                        <Plus size={16} />
                        Add chat
                      </button>
                    </div>
                    {data.chats.length ? (
                      data.chats.map((c: Data) => (
                        <div key={c.id} className="chat-row">
                          <span className="feature-icon">
                            <Users size={20} />
                          </span>
                          <div>
                            <strong>{c.title}</strong>
                            <span>
                              {c.type} · {c.telegramId}
                            </span>
                          </div>
                          <Badge tone={c.healthy ? "green" : "red"}>
                            {c.healthy
                              ? "Permissions verified"
                              : "Needs attention"}
                          </Badge>
                        </div>
                      ))
                    ) : (
                      <Empty
                        title="Give your members a place to connect"
                        detail="Add the bot as an administrator to a private channel or supergroup."
                      />
                    )}
                  </article>
                  <div className="callout">
                    <ShieldCheck size={20} />
                    <div>
                      <strong>Keep independent moderation in your hands</strong>
                      <p>
                        TeleTier restores only bans it can prove it imposed.
                        Human moderation bans remain protected. Existing invite
                        links and other admins can weaken paid-only access.
                      </p>
                    </div>
                  </div>
                </>
              )}
              {view === "Support & terms" && (
                <>
                  <div className="callout">
                    <CircleHelp size={20} />
                    <div>
                      <strong>
                        Clear expectations build a better community
                      </strong>
                      <p>
                        Your members explicitly accept the policy attached to
                        their purchase. Publish a new version to change terms
                        for future offers.
                      </p>
                    </div>
                  </div>
                  {data.policies.length ? (
                    data.policies.map((p: Data) => (
                      <article className="panel policy-card" key={p.id}>
                        <div className="panel-heading">
                          <div>
                            <h2>Purchase policy</h2>
                            <p>
                              Published {date(p.createdAt)} ·{" "}
                              <span className="mono">{p.id.slice(0, 8)}</span>
                            </p>
                          </div>
                          <Badge tone="green">Published version</Badge>
                        </div>
                        <div className="policy-content">
                          <h3>Creator support</h3>
                          <p>{p.support}</p>
                          <h3>Purchase terms</h3>
                          <p>{p.terms}</p>
                          <h3>Refunds & payment disputes</h3>
                          <p>{p.refunds}</p>
                          <h3>Privacy & data requests</h3>
                          <p>{p.privacy}</p>
                        </div>
                      </article>
                    ))
                  ) : (
                    <Empty
                      title="A real contact for every member"
                      detail="Publish terms, refund rules, privacy information, and your creator support contact."
                      action={
                        <button
                          className="button"
                          onClick={() => setModal({ kind: "policy" })}
                        >
                          Publish first policy
                        </button>
                      }
                    />
                  )}
                </>
              )}
              {view === "Operations" && (
                <>
                  <div className="callout">
                    <Activity size={19} />
                    <div>
                      <strong>
                        Queue lag: {fmt(data.metrics.queueLagSeconds)} seconds
                      </strong>
                      <p>
                        Durable PostgreSQL jobs recover after interruption. Fix
                        the underlying configuration before replaying a failed
                        job.
                      </p>
                    </div>
                  </div>
                  <article className="panel">
                    <div className="panel-heading">
                      <div>
                        <h2>Operational incidents</h2>
                        <label className="record-search">
                          <Search size={15} />
                          <input
                            aria-label="Search operational incidents"
                            placeholder="Search incident, reason or ID…"
                            value={recordQuery}
                            onChange={(e) => setRecordQuery(e.target.value)}
                          />
                        </label>
                      </div>
                      <Badge
                        tone={data.metrics.openIncidents ? "amber" : "green"}
                      >
                        {data.metrics.openIncidents} open
                      </Badge>
                    </div>
                    {data.incidents.length ? (
                      data.incidents.map((i: Data) => (
                        <div className="incident-row" key={i.id}>
                          <TriangleAlert
                            size={18}
                            className={
                              i.status === "OPEN" ? "amber-text" : "muted"
                            }
                          />
                          <div>
                            <strong>{i.kind.replaceAll("_", " ")}</strong>
                            <p>{i.detail}</p>
                            <span className="small muted">
                              {i.id} · {date(i.createdAt)}
                            </span>
                          </div>
                          {i.status === "OPEN" ? (
                            <button
                              className="text-button"
                              onClick={() =>
                                confirm(
                                  "Resolve incident",
                                  `incidents/${i.id}/resolve`,
                                  "Record why this incident is resolved. This does not change financial or access state.",
                                )
                              }
                            >
                              Resolve
                            </button>
                          ) : (
                            <Badge>Resolved</Badge>
                          )}
                        </div>
                      ))
                    ) : (
                      <Empty
                        title="Nothing needs your attention"
                        detail="Payment discrepancies, permission losses, and exhausted retries appear here."
                      />
                    )}
                  </article>
                  {data.quarantined.length > 0 && (
                    <article className="panel">
                      <div className="panel-heading">
                        <h2>Quarantined Telegram updates</h2>
                        <span className="small muted">
                          Review the incident before replay
                        </span>
                      </div>
                      {data.quarantined.map((i: Data) => (
                        <div className="incident-row" key={i.id}>
                          <TriangleAlert size={18} />
                          <div>
                            <strong>Update {i.updateId}</strong>
                            <p>{i.error}</p>
                            <span className="small mono">{i.id}</span>
                          </div>
                          <button
                            className="text-button"
                            onClick={() =>
                              confirm(
                                "Replay quarantined update",
                                `inbox/${i.id}/replay`,
                                "Use after investigating or correlating delayed charges. All original payment checks still apply.",
                              )
                            }
                          >
                            Replay
                          </button>
                        </div>
                      ))}
                    </article>
                  )}
                  <article className="panel">
                    <div className="panel-heading">
                      <h2>Pending & failed deliveries</h2>
                      <span className="small muted">Most recent 100</span>
                    </div>
                    {data.jobs.length ? (
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Job</th>
                              <th>State</th>
                              <th>Attempts</th>
                              <th>Next attempt</th>
                              <th />
                            </tr>
                          </thead>
                          <tbody>
                            {data.jobs.map((j: Data) => (
                              <tr key={j.id}>
                                <td>
                                  <strong>{j.kind}</strong>
                                  <span className="cell-sub mono">
                                    {j.id.slice(0, 12)}
                                  </span>
                                  {j.error && (
                                    <span className="cell-sub">{j.error}</span>
                                  )}
                                </td>
                                <td>
                                  <Badge
                                    tone={j.status === "DEAD" ? "red" : "amber"}
                                  >
                                    {j.status}
                                  </Badge>
                                </td>
                                <td>{j.attempts}</td>
                                <td>{date(j.nextAt)}</td>
                                <td>
                                  {j.kind !== "REFUND" &&
                                    j.status !== "RUNNING" && (
                                      <button
                                        className="text-button"
                                        onClick={() =>
                                          confirm(
                                            "Replay durable job",
                                            `jobs/${j.id}/retry`,
                                            "The worker rechecks current desired state before acting. Record the repair you made.",
                                          )
                                        }
                                      >
                                        Retry
                                      </button>
                                    )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <Empty
                        title="All caught up"
                        detail="There are no outstanding jobs in this workspace."
                      />
                    )}
                  </article>
                  <article className="panel">
                    <div className="panel-heading">
                      <h2>Administrative audit</h2>
                      <span className="small muted">
                        Append-only · latest 100
                      </span>
                    </div>
                    <div className="audit-list">
                      {data.audits.map((a: Data) => (
                        <div key={a.id}>
                          <span className="audit-dot" />
                          <div>
                            <strong>{a.action.replaceAll("_", " ")}</strong>
                            <p>{a.reason}</p>
                            <span className="small muted">
                              Actor {a.actorId} · {date(a.createdAt)} ·{" "}
                              {a.target.slice(0, 12)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </article>
                </>
              )}
              {view === "Settings" && (
                <article className="panel settings-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Workspace settings</h2>
                      <p>{data.tenant.name}</p>
                    </div>
                    <Badge>Owner</Badge>
                  </div>
                  <div className="setting-row">
                    <div>
                      <strong>Display timezone</strong>
                      <p>
                        {data.tenant.timezone}. Payment storage and date filters
                        use UTC.
                      </p>
                    </div>
                  </div>
                  <div className="setting-row">
                    <div>
                      <strong>Data export</strong>
                      <p>
                        Download your scoped subscriber, payment, and refund
                        records as JSON.
                      </p>
                    </div>
                    <button
                      className="button secondary"
                      onClick={async () => {
                        const r = await fetch("/api/export", {
                          headers: headers(),
                        });
                        if (!r.ok) {
                          setError("Export failed");
                          return;
                        }
                        const blob = await r.blob(),
                          url = URL.createObjectURL(blob),
                          a = document.createElement("a");
                        a.href = url;
                        a.download = "teletier-export.json";
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                    >
                      <Download size={15} />
                      Export data
                    </button>
                  </div>
                  <div className="setting-row">
                    <div>
                      <strong>Platform operations</strong>
                      <p>
                        Requires a separately configured platform operator
                        identity.
                      </p>
                    </div>
                    <button
                      className="button secondary"
                      onClick={async () => {
                        const r = await fetch("/api/operator", {
                          headers: headers(),
                        });
                        const result = await r.json();
                        if (!r.ok) setError(result.error);
                        else setModal({ kind: "operator", result });
                      }}
                    >
                      Operator view
                    </button>
                  </div>
                  <div className="setting-row">
                    <div>
                      <strong>Disconnect bot</strong>
                      <p>
                        Active paid members must have a continuity plan before
                        disconnection.
                      </p>
                    </div>
                    <button
                      className="button danger-secondary"
                      onClick={() =>
                        confirm(
                          "Disconnect creator bot",
                          "bots/disconnect",
                          "Stops consuming updates. The server refuses this action while current grants remain. Payment history is retained.",
                        )
                      }
                    >
                      Disconnect
                    </button>
                  </div>
                </article>
              )}
            </>
          )}
          <footer className="dashboard-footer">
            <span>
              <span className="dot" /> Built around your community
            </span>
            <span>
              All amounts in Telegram Stars · {data?.tenant.timezone ?? "UTC"}
            </span>
            <a
              href="https://core.telegram.org/bots/payments-stars"
              target="_blank"
              rel="noreferrer"
            >
              About Stars <ArrowUpRight size={12} />
            </a>
          </footer>
        </main>
      </div>
      {modal && (
        <Modal
          title={
            modal.title ??
            (
              {
                workspace: "Create your workspace",
                bot: "Connect creator bot",
                chat: "Add a private chat",
                policy: "Publish purchase policy",
                plan: modal.plan
                  ? "Edit membership plan"
                  : "Create membership plan",
                grant: "Grant a manual exception",
                handover: "Confirm webhook handover",
                dates: "Select date range",
                operator: "Platform operations",
              } as Data
            )[modal.kind]
          }
          onClose={() => setModal(null)}
        >
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          {modal.kind === "handover" ? (
            <>
              <p className="form-help">
                Activating this webhook replaces any existing webhook for your
                creator bot. Its previous integration will stop receiving new
                updates. Confirm that you control the bot and are ready to move
                delivery to TeleTier.
              </p>
              <div className="form-footer">
                <button
                  className="button secondary"
                  onClick={() => setModal(null)}
                >
                  Cancel
                </button>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => mutate("bots/webhook", { confirm: true })}
                >
                  {busy ? "Verifying…" : "Confirm handover"}
                </button>
              </div>
            </>
          ) : modal.kind === "operator" ? (
            <pre className="operator-result">
              {JSON.stringify(modal.result, null, 2)}
            </pre>
          ) : modal.kind === "dates" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                setRange({
                  from: String(f.get("from")),
                  to: String(f.get("to")),
                });
                setModal(null);
              }}
            >
              <div className="form-row">
                <label>
                  From (UTC)
                  <input
                    name="from"
                    type="date"
                    required
                    defaultValue={range.from}
                  />
                </label>
                <label>
                  Through (UTC)
                  <input
                    name="to"
                    type="date"
                    required
                    defaultValue={range.to}
                  />
                </label>
              </div>
              <div className="form-footer">
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => {
                    setRange({ from: "", to: "" });
                    setModal(null);
                  }}
                >
                  Reset to 30 days
                </button>
                <button className="button">Apply range</button>
              </div>
            </form>
          ) : (
            <form onSubmit={submit}>
              {modal.kind === "confirm" ? (
                <>
                  <p className="form-help">{modal.detail}</p>
                  <label>
                    Reason for this action
                    <textarea
                      name="reason"
                      required
                      minLength={5}
                      maxLength={500}
                    />
                  </label>
                </>
              ) : (
                (fields as Data)[modal.kind]
              )}
              {formFooter}
            </form>
          )}
        </Modal>
      )}
    </div>
  );
}
function MemberTable({ subscribers, grants, status, date, onGrant }: Data) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Member</th>
            <th>Access status</th>
            <th>Paid / granted through</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {subscribers.map((s: Data) => {
            const [label, tone] = status(s.id),
              gs = grants.filter(
                (g: Data) => g.subscriberId === s.id && !g.revokedAt,
              ),
              end = gs.length
                ? new Date(
                    Math.max(
                      ...gs.map((g: Data) => new Date(g.expiresAt).getTime()),
                    ),
                  ).toISOString()
                : null;
            return (
              <tr key={s.id}>
                <td>
                  <div className="member-cell">
                    <span
                      className="member-avatar"
                      style={{
                        background: [
                          "#ecedf9",
                          "#f9eee4",
                          "#e7f2ec",
                          "#f3e9f2",
                        ][Number(s.telegramId) % 4],
                      }}
                    >
                      {s.name
                        .split(" ")
                        .map((n: string) => n[0])
                        .slice(0, 2)
                        .join("")}
                    </span>
                    <div>
                      <strong>{s.name}</strong>
                      <span className="cell-sub">ID {s.telegramId}</span>
                    </div>
                  </div>
                </td>
                <td>
                  <Badge tone={tone}>{label}</Badge>
                </td>
                <td>{end ? date(end) : "—"}</td>
                <td>
                  <button
                    className="icon-button"
                    onClick={() => onGrant(s.id)}
                    aria-label={`Manage access for ${s.name}`}
                    title="Grant manual exception"
                  >
                    <MoreHorizontal size={18} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
function RevenueChart({ payments, period }: Data) {
  const from = new Date(period.from).getTime(),
    to = new Date(period.to).getTime(),
    n = Math.min(30, Math.max(2, Math.ceil((to - from) / 86400000))),
    width = (to - from) / n,
    buckets = Array.from({ length: n }, (_, i) =>
      payments
        .filter((p: Data) => {
          const t = new Date(p.paidAt).getTime();
          return t >= from + i * width && t < from + (i + 1) * width;
        })
        .reduce((sum: number, p: Data) => sum + p.stars, 0),
    ),
    max = Math.max(100, ...buckets),
    path = buckets
      .map(
        (v, i) =>
          `${i === 0 ? "M" : "L"}${44 + (i * 660) / (n - 1)},${182 - (v / max) * 140}`,
      )
      .join(" "),
    area = `${path} L704,182 L44,182 Z`;
  return (
    <div className="revenue-chart">
      <svg
        viewBox="0 0 740 235"
        role="img"
        aria-label="Confirmed Stars by period. See exact amounts in transactions."
      >
        <defs>
          <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#209c76" stopOpacity=".18" />
            <stop offset="100%" stopColor="#209c76" stopOpacity=".01" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3].map((i) => (
          <g key={i}>
            <line
              x1="44"
              x2="706"
              y1={42 + i * 46.66}
              y2={42 + i * 46.66}
              stroke="#eef0f2"
              strokeDasharray="4 5"
            />
            <text x="30" y={46 + i * 46.66} textAnchor="end">
              {fmt(Math.round(max * (1 - i / 3)))}
            </text>
          </g>
        ))}
        <path d={area} fill="url(#fill)" />
        <path
          d={path}
          fill="none"
          stroke="#189b75"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        {[0, 0.25, 0.5, 0.75, 1].map((p) => (
          <text key={p} x={44 + p * 660} y="215" textAnchor="middle">
            {new Date(from + p * (to - from)).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              timeZone: "UTC",
            })}
          </text>
        ))}
      </svg>
      {payments.length >= 100 && (
        <span className="small muted">
          Chart limited to the 100 displayed charges; totals use the full
          period.
        </span>
      )}
    </div>
  );
}
function AccessDonut({ memberships }: Data) {
  const active = memberships.filter(
      (m: Data) => m.desired === "ACTIVE_MEMBER",
    ).length,
    pending = memberships.filter(
      (m: Data) => m.desired === "ENTITLED_PENDING_JOIN",
    ).length,
    other = memberships.length - active - pending,
    total = memberships.length,
    green = total ? (active / total) * 100 : 0,
    amber = total ? (pending / total) * 100 : 0;
  return (
    <>
      <div className="donut-wrap">
        <div
          className="donut"
          style={{
            background: `conic-gradient(#229e7b 0% ${green}%,#e5b15d ${green}% ${green + amber}%,#e9edf0 ${green + amber}% 100%)`,
          }}
        >
          <div>
            <strong>{fmt(total)}</strong>
            <span>tracked access states</span>
          </div>
        </div>
      </div>
      <div className="donut-legend">
        {[
          ["Confirmed member", active, "#229e7b"],
          ["Pending join", pending, "#e5b15d"],
          ["Other / no access", other, "#cbd3d9"],
        ].map(([title, value, color]) => (
          <div key={String(title)}>
            <span>
              <i style={{ background: String(color) }} />
              {title}
            </span>
            <strong>{fmt(Number(value))}</strong>
          </div>
        ))}
      </div>
    </>
  );
}
