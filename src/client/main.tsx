import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Bell,
  BookOpen,
  Check,
  ChevronRight,
  CircleGauge,
  Clock3,
  Copy,
  Database,
  Fish,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  PackageOpen,
  Plus,
  RefreshCw,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
  X,
} from "lucide-react";
import "./styles.css";

type User = {
  id: number;
  username: string | null;
  display_name: string;
  avatar_url: string | null;
  role: "user" | "admin";
  quota_total: number;
  quota_used: number;
};
type PublicConfig = {
  site_name: string;
  notice: string;
  quota_per_fish: string;
  public_remaining: number;
  discord_enabled: boolean;
  registration_enabled: string;
};
type KeyItem = {
  id: number;
  name: string;
  prefix: string;
  quota_limit: number | null;
  quota_used: number;
  revoked: number;
  last_used_at: string | null;
  created_at: string;
};
type DashboardData = {
  user: User;
  keys: KeyItem[];
  today_usage: number;
  public_remaining: number;
  quota_per_fish: number;
  checkin: {
    claimed: boolean;
    reward_quota: number;
    reward_min_quota: number;
    reward_max_quota: number;
    remaining: number;
  };
  announcements: Array<{
    id: number;
    title: string;
    content: string;
    created_at: string;
  }>;
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "操作失败，请稍后重试");
  return data as T;
}

const formatNumber = (value: number) =>
  new Intl.NumberFormat("zh-CN").format(Math.max(0, Math.floor(value)));
const fishCount = (quota: number, perFish: number) =>
  (quota / Math.max(1, perFish)).toFixed(quota < perFish * 10 ? 1 : 0);

function Login({
  config,
  onSuccess,
}: {
  config: PublicConfig;
  onSuccess: () => void;
}) {
  const [registering, setRegistering] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await request(`/api/auth/${registering ? "register" : "login"}`, {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      onSuccess();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };
  return (
    <main className="login-shell">
      <section className="login-art" aria-label="奶酪工坊插画">
        <div className="brand-mark">
          <img className="brand-icon" src="/site-icon.png" alt="" />
          <span>XLDC</span>
        </div>
        <div className="art-copy">
          <p className="eyebrow">DC API WORKSHOP</p>
          <h1>
            小老鼠的
            <br />
            奶酪工坊
          </h1>
          <p>把灵感磨成香喷喷的奶酪，再用鱼干换取每一次模型调用。</p>
        </div>
        <img className="mouse-art" src="/mascot.svg" alt="抱着奶酪的小老鼠" />
        <div className="cheese-holes" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
      </section>
      <section className="login-panel">
        <div className="login-box">
          <div className="mobile-brand">
            <img className="brand-icon" src="/site-icon.png" alt="" /> XLDC
          </div>
          <p className="eyebrow">
            {registering ? "NEW MAKER" : "WELCOME BACK"}
          </p>
          <h2>{registering ? "加入工坊" : "欢迎回来"}</h2>
          <p className="muted">登录后领取你的专属 API Key</p>
          <form onSubmit={submit}>
            <label>
              账号
              <input
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="输入账号"
                required
              />
            </label>
            <label>
              密码
              <input
                type="password"
                autoComplete={registering ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={registering ? "至少 8 位" : "输入密码"}
                required
              />
            </label>
            {error && <p className="form-error">{error}</p>}
            <button className="primary wide" disabled={loading}>
              {loading ? "请稍候…" : registering ? "注册并进入" : "进入工坊"}{" "}
              <ChevronRight size={18} />
            </button>
          </form>
          {config.discord_enabled && (
            <>
              <div className="divider">
                <span>或者</span>
              </div>
              <a className="discord-button" href="/api/auth/discord">
                <span className="discord-logo">D</span> 使用 Discord 登录
              </a>
            </>
          )}
          {config.registration_enabled === "true" && (
            <button
              className="text-button"
              onClick={() => {
                setRegistering(!registering);
                setError("");
              }}
            >
              {registering ? "已有账号？返回登录" : "还没有账号？立即注册"}
            </button>
          )}
          <p className="login-foot">登录即表示你会妥善保管自己的 API Key</p>
        </div>
      </section>
    </main>
  );
}

const navItems = [
  ["overview", "工坊总览", LayoutDashboard],
  ["keys", "API 钥匙", KeyRound],
  ["models", "模型货架", PackageOpen],
  ["docs", "使用文档", BookOpen],
  ["announcements", "工坊公告", Bell],
] as const;

function Sidebar({
  page,
  setPage,
  user,
  logout,
  open,
  close,
}: {
  page: string;
  setPage: (p: string) => void;
  user: User;
  logout: () => void;
  open: boolean;
  close: () => void;
}) {
  return (
    <>
      <div className={`sidebar-scrim ${open ? "show" : ""}`} onClick={close} />
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="side-brand">
          <img className="brand-icon" src="/site-icon.png" alt="" />
          <div>
            <strong>小老鼠工坊</strong>
            <small>DC 分站</small>
          </div>
          <button
            className="icon-button side-close"
            onClick={close}
            title="关闭菜单"
          >
            <X size={20} />
          </button>
        </div>
        <nav>
          {navItems.map(([id, label, Icon]) => (
            <button
              key={id}
              className={page === id ? "active" : ""}
              onClick={() => {
                setPage(id);
                close();
              }}
            >
              <Icon size={19} />
              {label}
            </button>
          ))}
          {user.role === "admin" && (
            <button
              className={page === "admin" ? "active" : ""}
              onClick={() => {
                setPage("admin");
                close();
              }}
            >
              <Settings size={19} />
              管理后台
            </button>
          )}
        </nav>
        <div className="side-user">
          <div className="avatar">
            {user.avatar_url ? (
              <img src={user.avatar_url} alt="" referrerPolicy="no-referrer" />
            ) : (
              user.display_name.slice(0, 1).toUpperCase()
            )}
          </div>
          <div>
            <strong>{user.display_name}</strong>
            <small>{user.role === "admin" ? "工坊管理员" : "奶酪学徒"}</small>
          </div>
          <button className="icon-button" onClick={logout} title="退出登录">
            <LogOut size={18} />
          </button>
        </div>
      </aside>
    </>
  );
}

function Stat({
  icon,
  label,
  value,
  note,
  tone = "",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  note: string;
  tone?: string;
}) {
  return (
    <div className={`stat ${tone}`}>
      <div className="stat-icon">{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{note}</small>
      </div>
    </div>
  );
}

function Overview({
  data,
  notice,
  goKeys,
  refresh,
}: {
  data: DashboardData;
  notice: string;
  goKeys: () => void;
  refresh: () => Promise<void>;
}) {
  const [now, setNow] = useState(new Date());
  const [checkingIn, setCheckingIn] = useState(false);
  const [checkinMessage, setCheckinMessage] = useState("");
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  const remaining = Math.max(0, data.user.quota_total - data.user.quota_used) + data.checkin.remaining;
  const totalQuota = data.user.quota_total + (data.checkin.claimed ? data.checkin.reward_quota : 0);
  const percent = Math.max(
    0,
    Math.min(100, (remaining / Math.max(1, totalQuota)) * 100),
  );
  const checkIn = async () => {
    setCheckingIn(true);
    setCheckinMessage("");
    try {
      const result = await request<{ reward_quota: number }>("/api/checkin", { method: "POST" });
      setCheckinMessage(`签到成功，今日获得 ${fishCount(result.reward_quota, data.quota_per_fish)} 条鱼干`);
      await refresh();
    } catch (error) {
      setCheckinMessage((error as Error).message);
    } finally {
      setCheckingIn(false);
    }
  };
  return (
    <>
      <section className="welcome-band">
        <div>
          <p className="eyebrow">CHEESE O'CLOCK</p>
          <h1>
            {now.toLocaleTimeString("zh-CN", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </h1>
          <p>
            {now.toLocaleDateString("zh-CN", {
              month: "long",
              day: "numeric",
              weekday: "long",
            })}
          </p>
        </div>
        <div className="clock-stamp">
          <Clock3 size={28} />
          <span>工坊营业中</span>
        </div>
        <div className="band-holes" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
      </section>
      <div className="notice">
        <Sparkles size={18} />
        <span>
          <strong>工坊广播</strong>
          {notice}
        </span>
      </div>
      <section className="stats-grid">
        <Stat
          icon={<Fish />}
          label="我的鱼干"
          value={`${fishCount(remaining, data.quota_per_fish)} 条`}
          note={`${formatNumber(remaining)} 配额可用`}
          tone="yellow"
        />
        <Stat
          icon={<Database />}
          label="公共鱼干池"
          value={`${fishCount(data.public_remaining, data.quota_per_fish)} 条`}
          note="所有学徒共同使用"
          tone="teal"
        />
        <Stat
          icon={<CircleGauge />}
          label="今日消耗"
          value={formatNumber(data.today_usage)}
          note="过去 24 小时"
          tone="red"
        />
      </section>
      <section className="daily-fish-strip">
        <div className="daily-fish-icon"><Fish /></div>
        <div>
          <p className="eyebrow">DAILY FISH</p>
          <h2>今日签到鱼干</h2>
          <p>
            每日随机领取 {fishCount(data.checkin.reward_min_quota, data.quota_per_fish)} - {fishCount(data.checkin.reward_max_quota, data.quota_per_fish)} 条，
            仅限今天使用，未用完会在香港时间当天结束后失效。
          </p>
        </div>
        <button className="primary" onClick={checkIn} disabled={data.checkin.claimed || checkingIn}>
          <Fish size={17} />
          {data.checkin.claimed ? `已领取，剩余 ${fishCount(data.checkin.remaining, data.quota_per_fish)} 条` : checkingIn ? "领取中" : "签到领取"}
        </button>
      </section>
      {checkinMessage && <p className="checkin-message success-text">{checkinMessage}</p>}
      <section className="quota-section section-block">
        <div className="section-heading">
          <div>
            <p className="eyebrow">YOUR RATION</p>
            <h2>我的奶酪配额</h2>
          </div>
          <button className="primary" onClick={goKeys}>
            <KeyRound size={17} />
            领取钥匙
          </button>
        </div>
        <div className="quota-row">
          <div>
            <strong>{formatNumber(remaining)}</strong>
            <span> / {formatNumber(totalQuota)} 配额</span>
          </div>
          <span>{percent.toFixed(0)}% 剩余</span>
        </div>
        <div className="progress">
          <i style={{ width: `${percent}%` }} />
        </div>
        <p className="hint">
          <Fish size={15} /> 每条鱼干可兑换 {formatNumber(data.quota_per_fish)}{" "}
          配额，公共池和个人额度任一耗尽都会暂停调用。
        </p>
      </section>
      <section className="section-block home-announcements">
        <div className="section-heading">
          <div>
            <p className="eyebrow">NOTICE BOARD</p>
            <h2>最新公告</h2>
          </div>
        </div>
        <div className="home-notice-list">
          {data.announcements.map((item) => (
            <article key={item.id}>
              <time>{new Date(`${item.created_at}Z`).toLocaleDateString("zh-CN")}</time>
              <div>
                <h3>{item.title}</h3>
                <p>{item.content}</p>
              </div>
            </article>
          ))}
          {!data.announcements.length && <p className="empty">暂时没有公告。</p>}
        </div>
      </section>
    </>
  );
}

function KeysPage({
  data,
  refresh,
}: {
  data: DashboardData;
  refresh: () => void;
}) {
  const [name, setName] = useState("我的钥匙");
  const [fish, setFish] = useState("");
  const [created, setCreated] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    try {
      const result = await request<{ key: string }>("/api/keys", {
        method: "POST",
        body: JSON.stringify({ name, quota_fish: fish }),
      });
      setCreated(result.key);
      setCopied(false);
      refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const copyCreated = async () => {
    try {
      await navigator.clipboard.writeText(created);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("复制失败，请手动选择并复制 Key");
    }
  };
  const revoke = async (id: number) => {
    if (!confirm("确定停用这把钥匙吗？停用后不能恢复。")) return;
    await request(`/api/keys/${id}`, { method: "DELETE" });
    refresh();
  };
  return (
    <section className="section-block">
      <div className="section-heading">
        <div>
          <p className="eyebrow">API KEYS</p>
          <h1>API 钥匙</h1>
          <p>每把钥匙可以单独设置使用上限。</p>
        </div>
      </div>
      <form className="inline-form" onSubmit={create}>
        <label>
          钥匙名称
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          最多鱼干数 <small>留空则不限</small>
          <input
            type="number"
            min="1"
            value={fish}
            onChange={(e) => setFish(e.target.value)}
            placeholder="不限"
          />
        </label>
        <button className="primary">
          <Plus size={17} />
          生成新钥匙
        </button>
      </form>
      {error && <p className="form-error">{error}</p>}
      {created && (
        <div className="secret-reveal">
          <div>
            <Check size={20} />
            <span>
              <strong>钥匙已生成，仅显示这一次</strong>
              <code>{created}</code>
            </span>
          </div>
          <button className="secondary" onClick={copyCreated}>
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? "已复制" : "复制"}
          </button>
        </div>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>名称</th>
              <th>钥匙前缀</th>
              <th>已用 / 上限</th>
              <th>最近使用</th>
              <th>
                <span className="sr-only">操作</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.keys.map((key) => (
              <tr key={key.id} className={key.revoked ? "disabled-row" : ""}>
                <td>
                  <strong>{key.name}</strong>
                  {key.revoked ? <small>已停用</small> : null}
                </td>
                <td>
                  <code>{key.prefix}••••</code>
                </td>
                <td>
                  {formatNumber(key.quota_used)} /{" "}
                  {key.quota_limit == null
                    ? "不限"
                    : formatNumber(key.quota_limit)}
                </td>
                <td>
                  {key.last_used_at
                    ? new Date(`${key.last_used_at}Z`).toLocaleString("zh-CN")
                    : "还未使用"}
                </td>
                <td>
                  {!key.revoked && (
                    <button
                      className="icon-button danger"
                      onClick={() => revoke(key.id)}
                      title="停用钥匙"
                    >
                      <Trash2 size={17} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!data.keys.length && (
              <tr>
                <td colSpan={5} className="empty">
                  还没有钥匙，先生成一把吧。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ModelsPage() {
  const [models, setModels] = useState<
    Array<{ model_id: string; display_name: string; description: string }>
  >([]);
  useEffect(() => {
    request<typeof models>("/api/models").then(setModels);
  }, []);
  return (
    <section className="section-block">
      <div className="section-heading">
        <div>
          <p className="eyebrow">MODEL SHELF</p>
          <h1>模型货架</h1>
          <p>管理员当前开放的模型。</p>
        </div>
      </div>
      <div className="model-grid">
        {models.map((model, index) => (
          <article className="model-item" key={model.model_id}>
            <div className={`model-glyph g${index % 3}`}>
              <Sparkles />
            </div>
            <div>
              <h3>{model.display_name}</h3>
              <code>{model.model_id}</code>
              <p>{model.description}</p>
            </div>
            <span className="status-dot">可用</span>
          </article>
        ))}
      </div>
    </section>
  );
}

function DocsPage() {
  const base = window.location.origin;
  const curl = `curl ${base}/v1/chat/completions \\\n+  -H "Authorization: Bearer sk-xldc-你的钥匙" \\\n+  -H "Content-Type: application/json" \\\n+  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"你好"}]}'`;
  return (
    <section className="docs-layout">
      <aside className="docs-index">
        <strong>快速开始</strong>
        <a href="#endpoint">接口地址</a>
        <a href="#example">请求示例</a>
        <a href="#rules">额度规则</a>
      </aside>
      <article className="docs-content">
        <p className="eyebrow">DOCUMENTATION</p>
        <h1>使用文档</h1>
        <p>接口兼容 OpenAI Chat Completions。只需替换 Base URL 和 API Key。</p>
        <h2 id="endpoint">接口地址</h2>
        <div className="endpoint">
          <span>POST</span>
          <code>{base}/v1/chat/completions</code>
          <button
            className="icon-button"
            onClick={() => navigator.clipboard.writeText(`${base}/v1`)}
            title="复制接口地址"
          >
            <Copy size={17} />
          </button>
        </div>
        <h2 id="example">请求示例</h2>
        <pre>
          <code>{curl}</code>
        </pre>
        <h2 id="rules">额度规则</h2>
        <p>
          每次成功请求会按照上游返回的 token usage
          扣除配额。公共鱼干池、你的总额度或单把钥匙额度任意一个用尽时，接口返回{" "}
          <code>429 insufficient_quota</code>。
        </p>
        <div className="doc-callout">
          <ShieldCheck />
          <span>
            <strong>安全提示</strong>不要把钥匙提交到 Git
            仓库、网页前端代码或公开聊天中。目前请使用非流式请求（
            <code>stream=false</code>）。
          </span>
        </div>
      </article>
    </section>
  );
}

function AnnouncementsPage() {
  const [items, setItems] = useState<
    Array<{ id: number; title: string; content: string; created_at: string }>
  >([]);
  useEffect(() => {
    request<typeof items>("/api/announcements").then(setItems);
  }, []);
  return (
    <section className="section-block">
      <div className="section-heading">
        <div>
          <p className="eyebrow">NOTICE BOARD</p>
          <h1>工坊公告</h1>
        </div>
      </div>
      <div className="timeline">
        {items.map((item) => (
          <article key={item.id}>
            <time>
              {new Date(`${item.created_at}Z`).toLocaleDateString("zh-CN")}
            </time>
            <div>
              <h3>{item.title}</h3>
              <p>{item.content}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function AdminPage({
  perFish,
  refreshDashboard,
}: {
  perFish: number;
  refreshDashboard: () => void;
}) {
  const [tab, setTab] = useState("settings");
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [users, setUsers] = useState<any[]>([]);
  const [models, setModels] = useState<any[]>([]);
  const [notices, setNotices] = useState<any[]>([]);
  const [usage, setUsage] = useState<any[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("");
  const [adminError, setAdminError] = useState("");
  const load = () =>
    Promise.all([
      request<Record<string, string>>("/api/admin/settings"),
      request<any[]>("/api/admin/users"),
      request<any[]>("/api/admin/models"),
      request<any[]>("/api/admin/announcements"),
      request<any[]>("/api/admin/usage?limit=200"),
    ]).then(([s, u, m, n, logs]) => {
      setSettings(s);
      setUsers(u);
      setModels(m);
      setNotices(n);
      setUsage(logs);
    });
  useEffect(() => {
    load().catch((error) => setAdminError((error as Error).message));
  }, []);
  const saveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminError("");
    try {
      await request("/api/admin/settings", {
        method: "PUT",
        body: JSON.stringify(settings),
      });
      setMessage("配置已保存");
      refreshDashboard();
      load();
    } catch (error) {
      setAdminError((error as Error).message);
    }
  };
  const updateUser = async (user: any, changes: any) => {
    setAdminError("");
    try {
      await request(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          quota_fish: user.quota_total / perFish,
          disabled: user.disabled,
          ...changes,
        }),
      });
      load();
      refreshDashboard();
    } catch (error) {
      setAdminError((error as Error).message);
    }
  };
  const addModel = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setAdminError("");
    try {
      await request("/api/admin/models", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(fd)),
      });
      form.reset();
      load();
    } catch (error) {
      setAdminError((error as Error).message);
    }
  };
  const addNotice = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setAdminError("");
    try {
      await request("/api/admin/announcements", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(fd)),
      });
      form.reset();
      setMessage("公告已发布");
      await load();
    } catch (error) {
      setAdminError((error as Error).message);
    }
  };
  const addUser = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setAdminError("");
    try {
      await request("/api/admin/users", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(fd)),
      });
      form.reset();
      setMessage("用户已创建");
      load();
    } catch (error) {
      setAdminError((error as Error).message);
    }
  };
  const syncModels = async () => {
    setSyncing(true);
    setMessage("");
    setAdminError("");
    try {
      const result = await request<{ fetched: number; added: number }>(
        "/api/admin/models/sync",
        { method: "POST" },
      );
      setMessage(
        `已从上游获取 ${result.fetched} 个模型，新增 ${result.added} 个`,
      );
      await load();
    } catch (error) {
      setAdminError((error as Error).message);
    } finally {
      setSyncing(false);
    }
  };
  const del = async (type: "models" | "announcements", id: number) => {
    setAdminError("");
    try {
      await request(`/api/admin/${type}/${id}`, { method: "DELETE" });
      load();
    } catch (error) {
      setAdminError((error as Error).message);
    }
  };
  return (
    <section className="section-block admin-page">
      <div className="section-heading">
        <div>
          <p className="eyebrow">CONTROL ROOM</p>
          <h1>管理后台</h1>
          <p>配置上游、鱼干兑换与站内内容。</p>
        </div>
      </div>
      <div className="segmented">
        {[
          ["settings", "站点配置"],
          ["users", "用户额度"],
          ["models", "模型"],
          ["notices", "公告"],
          ["usage", "调用记录"],
        ].map(([id, label]) => (
          <button
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
            key={id}
          >
            {label}
          </button>
        ))}
      </div>
      {adminError && <p className="form-error">{adminError}</p>}
      {tab === "settings" && (
        <form className="admin-form" onSubmit={saveSettings}>
          <div className="form-grid">
            <label>
              站点名称
              <input
                value={settings.site_name || ""}
                onChange={(e) =>
                  setSettings({ ...settings, site_name: e.target.value })
                }
              />
            </label>
            <label>
              每条鱼干兑换配额
              <input
                type="number"
                value={settings.quota_per_fish || ""}
                onChange={(e) =>
                  setSettings({ ...settings, quota_per_fish: e.target.value })
                }
              />
            </label>
            <label>
              新用户默认鱼干
              <input
                type="number"
                min="0"
                value={settings.new_user_default_fish || "0"}
                onChange={(e) => setSettings({ ...settings, new_user_default_fish: e.target.value })}
              />
            </label>
            <label>
              每日签到最少鱼干
              <input
                type="number"
                min="0"
                value={settings.checkin_min_fish || "0"}
                onChange={(e) => setSettings({ ...settings, checkin_min_fish: e.target.value })}
              />
            </label>
            <label>
              每日签到最多鱼干
              <input
                type="number"
                min="0"
                value={settings.checkin_max_fish || "0"}
                onChange={(e) => setSettings({ ...settings, checkin_max_fish: e.target.value })}
              />
            </label>
            <label className="full">
              首页广播
              <input
                value={settings.notice || ""}
                onChange={(e) =>
                  setSettings({ ...settings, notice: e.target.value })
                }
              />
            </label>
            <label>
              上游地址
              <input
                value={settings.upstream_url || ""}
                onChange={(e) =>
                  setSettings({ ...settings, upstream_url: e.target.value })
                }
              />
            </label>
            <label>
              上游 API Key
              <input
                type="password"
                value={settings.upstream_api_key || ""}
                placeholder={
                  settings.upstream_api_key_configured === "true"
                    ? "已配置，留空不修改"
                    : "尚未配置"
                }
                onChange={(e) =>
                  setSettings({ ...settings, upstream_api_key: e.target.value })
                }
              />
            </label>
            <label>
              公共鱼干池（条）
              <input
                type="number"
                value={Math.floor(
                  Number(settings.public_quota_total || 0) /
                    Math.max(1, Number(settings.quota_per_fish || 5000)),
                )}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    public_quota_total: String(
                      Number(e.target.value) *
                        Math.max(1, Number(settings.quota_per_fish || 5000)),
                    ),
                  })
                }
              />
            </label>
            <label className="admin-toggle">
              <span>
                <strong>新用户注册</strong>
                <small>
                  {settings.registration_enabled === "true"
                    ? "账号密码与 Discord 均可创建新用户"
                    : "已关闭，现有用户仍可登录"}
                </small>
              </span>
              <span className="switch">
                <input
                  type="checkbox"
                  checked={settings.registration_enabled === "true"}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      registration_enabled: String(e.target.checked),
                    })
                  }
                />
                <span />
              </span>
            </label>
            <label className="admin-toggle">
              <span>
                <strong>测试拦截</strong>
                <small>
                  {settings.test_intercept_enabled === "true"
                    ? "已开启"
                    : "已关闭"}
                </small>
              </span>
              <span className="switch">
                <input
                  type="checkbox"
                  checked={settings.test_intercept_enabled === "true"}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      test_intercept_enabled: String(e.target.checked),
                    })
                  }
                />
                <span />
              </span>
            </label>
            <label>
              测试拦截 Token 上限
              <input
                type="number"
                min="0"
                value={settings.test_intercept_max_tokens || "0"}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    test_intercept_max_tokens: e.target.value,
                  })
                }
              />
            </label>
            <label>
              Discord Client ID
              <input
                value={settings.discord_client_id || ""}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    discord_client_id: e.target.value,
                  })
                }
              />
            </label>
            <label>
              Discord Client Secret
              <input
                type="password"
                value={settings.discord_client_secret || ""}
                placeholder={
                  settings.discord_client_secret_configured === "true"
                    ? "已配置，留空不修改"
                    : "尚未配置"
                }
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    discord_client_secret: e.target.value,
                  })
                }
              />
            </label>
            <label className="full">
              Discord 回调地址
              <input
                value={settings.discord_redirect_uri || ""}
                placeholder={`${location.origin}/api/auth/discord/callback`}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    discord_redirect_uri: e.target.value,
                  })
                }
              />
            </label>
          </div>
          <button className="primary">
            <Check size={17} />
            保存配置
          </button>
          {message && <span className="success-text">{message}</span>}
        </form>
      )}
      {tab === "users" && (
        <>
          <form className="inline-form" onSubmit={addUser}>
            <label>
              登录账号
              <input name="username" required placeholder="user_001" />
            </label>
            <label>
              显示名称
              <input name="display_name" placeholder="奶酪学徒" />
            </label>
            <label>
              初始密码
              <input name="password" type="password" minLength={8} required />
            </label>
            <label>
              初始鱼干
              <input
                name="quota_fish"
                type="number"
                min="0"
                placeholder={`默认 ${settings.new_user_default_fish || "10"}`}
              />
            </label>
            <button className="primary">
              <Plus size={17} />
              创建用户
            </button>
          </form>
          {message && <p className="success-text">{message}</p>}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>用户</th>
                  <th>角色</th>
                  <th>已用配额</th>
                  <th>总鱼干</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <div className="user-cell">
                        <div className="avatar small">
                          {user.avatar_url ? (
                            <img
                              src={user.avatar_url}
                              alt=""
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            user.display_name.slice(0, 1).toUpperCase()
                          )}
                        </div>
                        <span>
                          <strong>{user.display_name}</strong>
                          <small>{user.username || "Discord 用户"}</small>
                        </span>
                      </div>
                    </td>
                    <td>{user.role}</td>
                    <td>{formatNumber(user.quota_used)}</td>
                    <td>
                      <input
                        className="table-input"
                        type="number"
                        defaultValue={user.quota_total / perFish}
                        onBlur={(e) =>
                          updateUser(user, {
                            quota_fish: Number(e.target.value),
                          })
                        }
                      />
                    </td>
                    <td>
                      <label className="switch">
                        <input
                          type="checkbox"
                          checked={!user.disabled}
                          onChange={(e) =>
                            updateUser(user, { disabled: !e.target.checked })
                          }
                        />
                        <span />
                        {user.disabled ? "停用" : "正常"}
                      </label>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {tab === "models" && (
        <>
          <div className="model-toolbar">
            <button
              className="secondary"
              onClick={syncModels}
              disabled={syncing}
            >
              <RefreshCw size={17} />
              {syncing ? "正在同步" : "从上游同步模型"}
            </button>
            {message && <span className="success-text">{message}</span>}
          </div>
          <form className="inline-form" onSubmit={addModel}>
            <label>
              模型 ID
              <input name="model_id" required placeholder="gpt-4o-mini" />
            </label>
            <label>
              显示名称
              <input name="display_name" required />
            </label>
            <label>
              说明
              <input name="description" />
            </label>
            <button className="primary">
              <Plus size={17} />
              添加
            </button>
          </form>
          <div className="simple-list">
            {models.map((m) => (
              <div key={m.id}>
                <span>
                  <strong>{m.display_name}</strong>
                  <code>{m.model_id}</code>
                </span>
                <button
                  className="icon-button danger"
                  onClick={() => del("models", m.id)}
                >
                  <Trash2 size={17} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
      {tab === "notices" && (
        <>
          <form className="inline-form notice-form" onSubmit={addNotice}>
            <label>
              标题
              <input name="title" required />
            </label>
            <label className="grow">
              公告内容
              <input name="content" required />
            </label>
            <button className="primary">
              <Plus size={17} />
              发布
            </button>
          </form>
          {message && <p className="success-text">{message}</p>}
          <div className="simple-list">
            {notices.map((n) => (
              <div key={n.id}>
                <span>
                  <strong>{n.title}</strong>
                  <small>{n.content}</small>
                </span>
                <button
                  className="icon-button danger"
                  onClick={() => del("announcements", n.id)}
                >
                  <Trash2 size={17} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
      {tab === "usage" && (
        <div className="table-wrap usage-table">
          <table>
            <thead>
              <tr>
                <th>用户</th>
                <th>Key 名称</th>
                <th>时间</th>
                <th>模型</th>
                <th>Token</th>
                <th>首字节</th>
                <th>总耗时</th>
                <th>调用 IP</th>
                <th>状态</th>
                <th>请求头</th>
              </tr>
            </thead>
            <tbody>
              {usage.map((log) => (
                <tr key={log.id}>
                  <td>
                    <strong>{log.display_name}</strong>
                    <small>{log.username || "Discord 用户"}</small>
                  </td>
                  <td>{log.key_name || "已删除 Key"}</td>
                  <td>
                    {new Date(`${log.created_at}Z`).toLocaleString("zh-CN")}
                  </td>
                  <td>
                    <code>{log.model || "-"}</code>
                  </td>
                  <td>{formatNumber(log.tokens)}</td>
                  <td>{formatNumber(log.first_byte_ms)} ms</td>
                  <td>{formatNumber(log.duration_ms)} ms</td>
                  <td>
                    <code>{log.ip || "-"}</code>
                  </td>
                  <td>{log.status}</td>
                  <td>
                    <details className="header-details">
                      <summary>查看</summary>
                      <pre>{log.request_headers}</pre>
                    </details>
                  </td>
                </tr>
              ))}
              {!usage.length && (
                <tr>
                  <td colSpan={10} className="empty">
                    暂无调用记录
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function App() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [page, setPage] = useState("overview");
  const [menu, setMenu] = useState(false);
  const [loading, setLoading] = useState(true);
  const loadPublic = () => request<PublicConfig>("/api/public").then(setConfig);
  const refresh = async () => {
    try {
      const me = await request<User>("/api/auth/me");
      setUser(me);
      setData(await request<DashboardData>("/api/dashboard"));
    } catch {
      setUser(null);
      setData(null);
    }
  };
  useEffect(() => {
    Promise.all([loadPublic(), refresh()]).finally(() => setLoading(false));
  }, []);
  const logout = async () => {
    await request("/api/auth/logout", { method: "POST" });
    setUser(null);
    setData(null);
  };
  if (loading || !config)
    return (
      <div className="splash">
        <img className="brand-icon" src="/site-icon.png" alt="网站图标" />
        <p>正在打开工坊…</p>
      </div>
    );
  if (!user || !data) return <Login config={config} onSuccess={refresh} />;
  const title = navItems.find(([id]) => id === page)?.[1] || "管理后台";
  return (
    <div className="app-shell">
      <Sidebar
        page={page}
        setPage={setPage}
        user={user}
        logout={logout}
        open={menu}
        close={() => setMenu(false)}
      />
      <main className="workspace">
        <header className="topbar">
          <button
            className="icon-button menu-button"
            onClick={() => setMenu(true)}
            title="打开菜单"
          >
            <Menu />
          </button>
          <div>
            <span>小老鼠的奶酪工坊</span>
            <strong>{title}</strong>
          </div>
        </header>
        <div className="page-content">
          {page === "overview" && (
            <Overview
              data={data}
              notice={config.notice}
              goKeys={() => setPage("keys")}
              refresh={refresh}
            />
          )}{" "}
          {page === "keys" && <KeysPage data={data} refresh={refresh} />}{" "}
          {page === "models" && <ModelsPage />}{" "}
          {page === "docs" && <DocsPage />}{" "}
          {page === "announcements" && <AnnouncementsPage />}{" "}
          {page === "admin" && user.role === "admin" && (
            <AdminPage
              perFish={data.quota_per_fish}
              refreshDashboard={() => {
                refresh();
                loadPublic();
              }}
            />
          )}
        </div>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
