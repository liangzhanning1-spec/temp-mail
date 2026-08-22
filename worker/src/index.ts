/* ============================================================
   1m.de5.net — 临时邮箱 Worker
   收信：Email Routing catch-all → email() handler → D1
   API：/api/inbox* 生成/查看/销毁收件箱（前端 assets 同源）
   清理：cron 每 5 分钟清除过期收件箱与邮件
   前端：wrangler [assets] 直接服务 www/，未命中才进 Worker
   ============================================================ */
import { Hono } from "hono";
import PostalMime from "postal-mime";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** 收件域名，如 "mail.example.com"。缺省回退到内置默认值 */
  MAIL_DOMAIN?: string;
}

/* 收件域名：可在 wrangler.toml [vars] 或 dashboard 环境变量中配置 MAIL_DOMAIN 覆盖 */
let DOMAIN = "1m.de5.net";
const DEFAULT_TTL_MIN = 60;
const TTL_WHITELIST: Record<string, number> = { "10": 10, "60": 60, "1440": 1440 };
const MAX_MESSAGES_PER_INBOX = 100; // 单收件箱保留上限，防刷爆
const MAX_NAME_LEN = 64;
const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/* 系统保留邮箱名：用户不可生成（管理员、收信路由、服务邮箱等） */
const RESERVED_NAMES = new Set([
  "admin", "administrator", "root", "superuser", "system", "sysadmin",
  "abuse", "postmaster", "webmaster", "hostmaster", "mailer-daemon", "mailerdaemon", "mail", "mta",
  "support", "service", "services", "help", "helpdesk", "contact", "info", "inquiries", "feedback",
  "sales", "marketing", "billing", "finance", "team", "office", "staff",
  "no-reply", "noreply", "no_reply", "donotreply", "do-not-reply", "notification", "notify", "alert",
  "security", "privacy", "legal", "press", "media", "newsletter", "lists", "list",
  "api", "status", "uptime", "dev", "test", "tests", "testing", "demo", "example", "sample",
  "spam", "junk", "trash", "null", "void", "guest", "operator", "ftp", "www", "www-data", "usenet", "uucp",
]);

/* ---------- 工具 ---------- */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    },
  });
}

function cleanName(raw: string): string | null {
  const n = String(raw || "").trim().toLowerCase();
  if (!n || n.length > MAX_NAME_LEN) return null;
  if (!NAME_RE.test(n)) return null;
  return n;
}

function randName(len = 10): string {
  // 去掉易混淆字符 i l o 0 1
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  const arr = crypto.getRandomValues(new Uint8Array(len));
  let s = "";
  for (let i = 0; i < len; i++) s += chars[arr[i] % chars.length];
  return s;
}

/* 轻量内存限流（按 IP） */
const hits = new Map<string, number[]>();
function limited(key: string, windowMs: number, max: number): boolean {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) {
    hits.set(key, arr);
    return true;
  }
  arr.push(now);
  hits.set(key, arr);
  return false;
}

/* ---------- 品牌页：密信已销毁（410）/ 不存在（404） ---------- */

function gonePage(title: string, desc: string, status: number, code: string): Response {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} — ${DOMAIN} 临时邮箱</title>
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#f6f3ee">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="canonical" href="https://${DOMAIN}/">
<link rel="preconnect" href="https://fonts.loli.net" crossorigin>
<link href="https://fonts.loli.net/css2?family=Bricolage+Grotesque:wght@600;700;800&family=Noto+Serif+SC:wght@300;400;500;700&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{min-height:100vh;background:#f6f3ee;color:#15140f;font-family:'Inter',sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;overflow:hidden;-webkit-font-smoothing:antialiased}
.bg{position:fixed;inset:0;z-index:0;background:url('/img/hero-bg.jpg') center/cover no-repeat}
.scrim{position:fixed;inset:0;z-index:0;background:linear-gradient(180deg,rgba(246,243,238,.84) 0%,rgba(246,243,238,.55) 50%,rgba(246,243,238,.84) 100%)}
nav{position:fixed;top:0;left:0;right:0;z-index:5;display:flex;align-items:center;justify-content:space-between;padding:1.3rem 2.5rem}
.logo{display:flex;align-items:center;gap:.6rem;text-decoration:none;color:#15140f}
.mark{width:30px;height:30px;background:#15140f;border-radius:8px;display:flex;align-items:center;justify-content:center;font-family:'Bricolage Grotesque',sans-serif;font-size:.65rem;font-weight:800;color:#f6f3ee}
.logo-txt{font-family:'JetBrains Mono',monospace;font-size:.82rem;color:#6a6358;letter-spacing:.04em}
.cta{font-family:'JetBrains Mono',monospace;font-size:.78rem;padding:.5rem 1.2rem;background:#15140f;color:#f6f3ee;border-radius:100px;text-decoration:none;letter-spacing:.03em;transition:all .3s}
.cta:hover{background:#4f46e5;transform:translateY(-1px);box-shadow:0 8px 24px rgba(79,70,229,.25)}
.card{position:relative;z-index:3;text-align:center;padding:3rem 2rem;max-width:560px;width:100%}
.badge{display:inline-flex;align-items:center;gap:.5rem;font-family:'JetBrains Mono',monospace;font-size:.7rem;color:#fb7185;letter-spacing:.15em;text-transform:uppercase;padding:.35rem .9rem;background:rgba(251,113,133,.08);border:1px solid rgba(251,113,133,.25);border-radius:100px;margin-bottom:1.6rem}
.badge .dot{width:6px;height:6px;border-radius:50%;background:#fb7185;box-shadow:0 0 8px rgba(251,113,133,.5);animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.big{font-family:'Bricolage Grotesque',sans-serif;font-size:clamp(6.5rem,20vw,10rem);font-weight:800;line-height:1;letter-spacing:-.04em;color:transparent;-webkit-text-stroke:2px rgba(21,20,15,.16);position:relative}
.big::after{content:'${code}';position:absolute;inset:0;background:linear-gradient(135deg,#4f46e5,#fb7185);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;opacity:.28;transform:translate(6px,6px)}
h1{font-family:'Bricolage Grotesque',sans-serif;font-size:clamp(1.5rem,5vw,2.1rem);font-weight:700;letter-spacing:-.02em;margin-bottom:1rem}
.desc{font-family:'Noto Serif SC',serif;font-size:1.02rem;font-weight:300;line-height:2;color:#6a6358;margin-bottom:2.4rem}
.desc strong{color:#15140f;font-weight:600}
.actions{display:flex;gap:.8rem;justify-content:center;flex-wrap:wrap}
.btn{font-family:'JetBrains Mono',monospace;font-size:.8rem;font-weight:600;letter-spacing:.03em;padding:.8rem 1.6rem;border-radius:12px;text-decoration:none;transition:all .3s;display:inline-flex;align-items:center;gap:.4rem}
.btn-p{background:#15140f;color:#f6f3ee}
.btn-p:hover{background:#4f46e5;transform:translateY(-2px);box-shadow:0 10px 30px rgba(79,70,229,.3)}
.btn-g{border:1px solid rgba(21,20,15,.15);color:#6a6358;background:rgba(255,253,248,.8)}
.btn-g:hover{border-color:#4f46e5;color:#4f46e5}
</style>
</head>
<body>
<div class="bg"></div>
<div class="scrim"></div>
<nav>
  <a class="logo" href="/"><div class="mark">1m</div><span class="logo-txt">${DOMAIN}</span></a>
  <a class="cta" href="/">生成邮箱 →</a>
</nav>
<div class="card">
  <div class="badge"><span class="dot"></span>${code} · BURNED · 阅后即焚</div>
  <div class="big">${code}</div>
  <h1>${title}</h1>
  <p class="desc">${desc}</p>
  <div class="actions">
    <a class="btn btn-p" href="/">⚡ 生成一个新邮箱</a>
    <a class="btn btn-g" href="/blog">← 博客</a>
  </div>
</div>
</body>
</html>`;
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    },
  });
}

/* ---------- 路由 ---------- */

const app = new Hono<{ Bindings: Env }>();

app.options("*", (c) =>
  new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  })
);

/* 生成 / 复用收件箱 */
app.post("/api/inbox", async (c) => {
  const ip = c.req.header("CF-Connecting-IP") || "unknown";
  if (limited(`create:${ip}`, 60_000, 30)) return json({ error: "创建太频繁，请稍后再试" }, 429);

  const body = (await c.req.json().catch(() => null) ?? {}) as { name?: string; ttl?: string | number };
  const ttlMin = TTL_WHITELIST[String(body.ttl)] ?? DEFAULT_TTL_MIN;
  const requested = cleanName(body.name || "");
  if (requested && RESERVED_NAMES.has(requested)) {
    return json({ error: "该邮箱名为系统保留，请换一个" }, 409);
  }
  const name = requested || randName();
  const now = Date.now();

  const existing = await c.env.DB.prepare(
    "SELECT address, created_at, expires_at FROM inboxes WHERE address = ?"
  ).bind(name).first<{ address: string; created_at: number; expires_at: number }>();

  if (existing && existing.expires_at > now) {
    return json({
      address: name,
      fullAddress: `${name}@${DOMAIN}`,
      createdAt: existing.created_at,
      expiresAt: existing.expires_at,
      ttlMinutes: Math.max(1, Math.round((existing.expires_at - now) / 60000)),
      reused: true,
    });
  }
  if (existing) {
    // 过期残留：清空重建
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM messages WHERE address = ?").bind(name),
      c.env.DB.prepare("DELETE FROM inboxes WHERE address = ?").bind(name),
    ]);
  }

  const createdAt = now;
  const expiresAt = now + ttlMin * 60_000;
  await c.env.DB.prepare(
    "INSERT INTO inboxes (address, created_at, expires_at) VALUES (?, ?, ?)"
  ).bind(name, createdAt, expiresAt).run();

  return json({
    address: name,
    fullAddress: `${name}@${DOMAIN}`,
    createdAt,
    expiresAt,
    ttlMinutes: ttlMin,
    reused: false,
  });
});

/* 收件箱列表（轮询） */
app.get("/api/inbox/:address", async (c) => {
  const addr = cleanName(c.req.param("address") || "");
  if (!addr) return json({ error: "地址无效" }, 400);
  const ip = c.req.header("CF-Connecting-IP") || "unknown";
  if (limited(`list:${ip}`, 60_000, 240)) return json({ error: "请求太频繁" }, 429);

  const now = Date.now();
  const inbox = await c.env.DB.prepare(
    "SELECT address, created_at, expires_at FROM inboxes WHERE address = ?"
  ).bind(addr).first<{ address: string; created_at: number; expires_at: number }>();
  if (!inbox) return json({ error: "收件箱不存在" }, 404);
  if (inbox.expires_at <= now) {
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM messages WHERE address = ?").bind(addr),
      c.env.DB.prepare("DELETE FROM inboxes WHERE address = ?").bind(addr),
    ]);
    return json({ error: "收件箱已过期，邮件已销毁", expired: true, address: addr }, 410);
  }

  const rows = await c.env.DB.prepare(
    `SELECT id, from_addr, from_name, subject,
            substr(text_content, 1, 160) AS snippet,
            received_at, is_read
     FROM messages WHERE address = ? ORDER BY id DESC LIMIT ${MAX_MESSAGES_PER_INBOX}`
  ).bind(addr).all<{ id: number; from_addr: string | null; from_name: string | null; subject: string | null; snippet: string | null; received_at: number; is_read: number }>();

  return json({
    address: inbox.address,
    fullAddress: `${inbox.address}@${DOMAIN}`,
    createdAt: inbox.created_at,
    expiresAt: inbox.expires_at,
    messages: rows.results.map((m) => ({
      id: m.id,
      fromAddr: m.from_addr,
      fromName: m.from_name,
      subject: m.subject,
      snippet: m.snippet,
      receivedAt: m.received_at,
      isRead: !!m.is_read,
    })),
  });
});

/* 邮件详情（标记已读） */
app.get("/api/inbox/:address/m/:id", async (c) => {
  const addr = cleanName(c.req.param("address") || "");
  const id = Number(c.req.param("id"));
  if (!addr || !Number.isInteger(id) || id <= 0) return json({ error: "参数无效" }, 400);

  const now = Date.now();
  const inbox = await c.env.DB.prepare(
    "SELECT expires_at FROM inboxes WHERE address = ?"
  ).bind(addr).first<{ expires_at: number }>();
  if (!inbox) return json({ error: "收件箱不存在" }, 404);
  if (inbox.expires_at <= now) return json({ error: "收件箱已过期" }, 410);

  const m = await c.env.DB.prepare(
    "SELECT id, from_addr, from_name, subject, text_content, html_content, received_at, is_read FROM messages WHERE id = ? AND address = ?"
  ).bind(id, addr).first<{
    id: number; from_addr: string | null; from_name: string | null; subject: string | null;
    text_content: string | null; html_content: string | null; received_at: number; is_read: number;
  }>();
  if (!m) return json({ error: "邮件不存在" }, 404);

  if (!m.is_read) {
    await c.env.DB.prepare("UPDATE messages SET is_read = 1 WHERE id = ?").bind(id).run();
  }

  return json({
    id: m.id,
    fromAddr: m.from_addr,
    fromName: m.from_name,
    subject: m.subject,
    text: m.text_content,
    html: m.html_content,
    receivedAt: m.received_at,
    isRead: true,
  });
});

/* 销毁收件箱 */
app.delete("/api/inbox/:address", async (c) => {
  const addr = cleanName(c.req.param("address") || "");
  if (!addr) return json({ error: "地址无效" }, 400);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM messages WHERE address = ?").bind(addr),
    c.env.DB.prepare("DELETE FROM inboxes WHERE address = ?").bind(addr),
  ]);
  return json({ success: true, address: addr });
});

/* 续期（在当前到期时间上追加） */
app.post("/api/inbox/:address/extend", async (c) => {
  const addr = cleanName(c.req.param("address") || "");
  if (!addr) return json({ error: "地址无效" }, 400);
  const ip = c.req.header("CF-Connecting-IP") || "unknown";
  if (limited(`extend:${ip}`, 60_000, 20)) return json({ error: "续期太频繁，请稍后再试" }, 429);

  const body = (await c.req.json().catch(() => null) ?? {}) as { ttl?: string | number };
  const ttlMin = TTL_WHITELIST[String(body.ttl)] ?? 60;
  const now = Date.now();

  const inbox = await c.env.DB.prepare(
    "SELECT expires_at FROM inboxes WHERE address = ?"
  ).bind(addr).first<{ expires_at: number }>();
  if (!inbox) return json({ error: "收件箱不存在" }, 404);
  if (inbox.expires_at <= now) {
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM messages WHERE address = ?").bind(addr),
      c.env.DB.prepare("DELETE FROM inboxes WHERE address = ?").bind(addr),
    ]);
    return json({ error: "收件箱已过期" }, 410);
  }

  const newExp = inbox.expires_at + ttlMin * 60_000;
  await c.env.DB.prepare("UPDATE inboxes SET expires_at = ? WHERE address = ?")
    .bind(newExp, addr).run();
  return json({ address: addr, expiresAt: newExp, ttlMinutes: ttlMin });
});

/* 公开链接：/inbox/:address —— 有效跳转收件箱，过期/销毁返回品牌 410 页 */
app.get("/inbox/:address", async (c) => {
  const ip = c.req.header("CF-Connecting-IP") || "unknown";
  if (limited(`gone:${ip}`, 60_000, 240)) {
    return gonePage("请求过于频繁", "探测太快了，稍后再试。", 429, "429");
  }
  const addr = cleanName(c.req.param("address") || "");
  if (!addr) {
    return gonePage("链接无效", "这个链接看起来不太对，像一封写错了地址的信。", 400, "400");
  }
  const now = Date.now();
  const inbox = await c.env.DB.prepare(
    "SELECT expires_at FROM inboxes WHERE address = ?"
  ).bind(addr).first<{ expires_at: number }>();

  if (!inbox) {
    return gonePage("密信不存在或已被销毁", "它从未存在过，或早已被读取销毁——<strong>阅后即焚，不留痕迹</strong>。", 404, "404");
  }
  if (inbox.expires_at <= now) {
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM messages WHERE address = ?").bind(addr),
      c.env.DB.prepare("DELETE FROM inboxes WHERE address = ?").bind(addr),
    ]);
    return gonePage("密信已过期销毁", "有效期已过，收件箱与全部邮件已从服务器彻底清除——<strong>0 数据保留</strong>。", 410, "410");
  }
  return c.redirect(`/?addr=${encodeURIComponent(addr)}`, 302);
});

/* 未命中 API → 静态资源（未匹配的 /api/* 返回 JSON 404，其余走 404.html） */
app.notFound(async (c) => {
  if (c.req.path.startsWith("/api/")) {
    return json({ error: "接口不存在" }, 404);
  }
  const res = await c.env.ASSETS.fetch(c.req.raw);
  const headers = new Headers(res.headers);
  if (!headers.has("X-Content-Type-Options")) headers.set("X-Content-Type-Options", "nosniff");
  return new Response(res.body, { status: res.status, headers });
});

/* ---------- 收信（Email Routing catch-all） ---------- */

async function handleEmail(message: ForwardableEmailMessage, env: Env): Promise<void> {
  const to = String(message.to || "").trim().toLowerCase();
  if (!to.endsWith(`@${DOMAIN}`)) return;
  const addr = to.split("@")[0].toLowerCase();
  if (!addr) return;

  const now = Date.now();
  // 仅生成过且未过期的地址收信，其余直接丢弃
  const inbox = await env.DB.prepare(
    "SELECT address FROM inboxes WHERE address = ? AND expires_at > ?"
  ).bind(addr, now).first<{ address: string }>();
  if (!inbox) return;

  // 超大邮件直接丢弃：防止内存占用与 D1 写入配额被打爆
  if (message.rawSize > 1_500_000) return;

  const parser = new PostalMime();
  const parsed = await parser.parse(message.raw);

  const subject = String(parsed.subject || "").slice(0, 500);
  const text = String(parsed.text || "").slice(0, 200_000);
  const html = String(parsed.html || "").slice(0, 500_000);
  const fromAddr = parsed.from?.address || null;
  const fromName = parsed.from?.name ? String(parsed.from.name).slice(0, 200) : null;
  const mailId = parsed.messageId ? String(parsed.messageId).slice(0, 300) : null;

  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO messages (address, mail_id, from_addr, from_name, subject, text_content, html_content, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(addr, mailId, fromAddr, fromName, subject, text, html, now),
    env.DB.prepare("UPDATE inboxes SET last_seen = ? WHERE address = ?").bind(now, addr),
    // 超出上限时只保留最新 100 封
    env.DB.prepare(
      `DELETE FROM messages WHERE address = ? AND id NOT IN
       (SELECT id FROM messages WHERE address = ? ORDER BY id DESC LIMIT ${MAX_MESSAGES_PER_INBOX})`
    ).bind(addr, addr),
  ]);
}

/* ---------- 定时清理 ---------- */

async function handleScheduled(env: Env): Promise<void> {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      "DELETE FROM messages WHERE address IN (SELECT address FROM inboxes WHERE expires_at <= ?)"
    ).bind(now),
    env.DB.prepare("DELETE FROM inboxes WHERE expires_at <= ?").bind(now),
  ]);
}

/* ---------- 入口 ---------- */

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    DOMAIN = env.MAIL_DOMAIN || "1m.de5.net";
    return app.fetch(request, env, ctx);
  },

  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
    DOMAIN = env.MAIL_DOMAIN || "1m.de5.net";
    try {
      await handleEmail(message, env);
    } catch (err) {
      console.error("[1m-mail] email handler error:", err);
    }
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    DOMAIN = env.MAIL_DOMAIN || "1m.de5.net";
    try {
      await handleScheduled(env);
    } catch (err) {
      console.error("[1m-mail] cron error:", err);
    }
  },
};
