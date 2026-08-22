# 1m Mail — 免费临时邮箱（开源版）

[![GitHub stars](https://img.shields.io/github/stars/linxk8/-1m-mail?style=social&label=Star)](https://github.com/linxk8/-1m-mail)
[![GitHub forks](https://img.shields.io/github/forks/linxk8/-1m-mail?style=social)](https://github.com/linxk8/-1m-mail/fork)
[![License: MIT](https://img.shields.io/badge/License-MIT-4f46e5.svg)](https://github.com/linxk8/-1m-mail/blob/main/LICENSE)
[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/linxk8/-1m-mail)

1 秒生成、无需注册、限时有效、阅后即焚的临时邮箱服务，基于 Cloudflare Workers 构建，可部署到你自己的域名。
前端原生 HTML/CSS/JS（无框架），后端 Hono + D1，收信走 Cloudflare Email Routing，支持 PWA 安装。

> ⚠️ 免责声明：本项目仅供合法用途（接收网站注册验证码、一次性试用等）。请遵守你所在地区的法律法规，
> 勿用于垃圾邮件、诈骗或任何滥用场景。部署者需自行对实例的运营负责。

## 演示站点

线上实例：[https://1m.de5.net](https://1m.de5.net) —— 无需注册，打开即可体验完整功能：
1 秒生成临时邮箱、4 秒收信、验证码自动高亮、到期自动销毁。推广文章页见 [/blog](https://1m.de5.net/blog)。

## 功能

| 模块 | 说明 |
|------|------|
| 临时邮箱 | 自定义名或随机生成（10 位，避开易混淆字符），有效期 10 分钟 / 1 小时 / 24 小时 |
| 收信 | Email Routing Catch-all → Worker `email()` → postal-mime 解析 → D1；**仅已生成且未过期的地址收信** |
| 收件箱 | 4 秒轮询、验证码（OTP）自动识别高亮一键复制、倒计时 + 一键续期、换一个 / 销毁 |
| 公开链接 | `/inbox/:地址`：有效 302 跳转 / 过期 410「密信已销毁」品牌页 / 不存在 404 品牌页 |
| 系统保留名 | 70+ 保留名（admin / noreply / postmaster 等）不可生成，可自行扩展名单 |
| 隐私 | 到期自动销毁、0 数据保留、外链追踪像素被 CSP 阻断 |
| PWA / SEO | Service Worker + manifest（可安装）、结构化数据、OG 卡片、sitemap |

## 项目结构

```
public/
├── www/                      # 静态前端（Worker assets 直接服务）
│   ├── index.html            # 首页：生成器 + 首屏收件箱（单页双模式）
│   ├── blog.html             # 演示博客页（/blog）
│   ├── 404.html              # 品牌 404 页
│   ├── sw.js / manifest.json # PWA
│   ├── _headers              # 安全响应头（CSP / HSTS 等）
│   └── blog-img/ img/        # 配图与背景（AVIF > WebP > PNG/JPG 多格式）
├── worker/                   # Cloudflare Worker 后端
│   ├── src/index.ts          # REST API / email() 收信 / cron 清理 / 410·404 品牌页
│   ├── schema.sql            # D1 建表（inboxes / messages）
│   ├── wrangler.toml         # assets + D1 绑定 + cron 触发器
│   └── package.json
├── .github/workflows/deploy.yml  # 一键部署：D1 自动建库 + wrangler deploy
├── LICENSE                   # MIT
└── README.md
```

## 部署到自己的域名

### ⚡ 一键部署（推荐）

点击上面的 **Deploy to Cloudflare Workers** 按钮：

1. 登录你的 Cloudflare 账号并授权
2. 选择本仓库，点击 Deploy
3. GitHub Actions 会自动完成：安装依赖 → 创建 D1 数据库（de5_mailhub）→ 初始化表结构 → 部署 Worker

部署完成后还剩两个需在 Cloudflare Dashboard 手动操作的步骤：

- **收件域名**：Workers → 你的 worker → Settings → Variables 添加 `MAIL_DOMAIN` = 你的域名（如 `mail.example.com`）
- **自定义域**：Settings → Domains & Routes → 添加你的域名
- **收信**：域名 → Email → Email Routing → Routing rules → **Catch-all** → Send to a Worker → 你的 worker 名

> 之后每次 `git push` 到 main 都会自动重新部署。D1 数据库只需第一次创建。

### 手动部署

前置：一个 Cloudflare 账号 + 一个托管在 Cloudflare 的域名（如 `mail.example.com`）。

### 1. 启用 Email Routing 并准备 DNS

在 Cloudflare Dashboard 打开域名 → **Email** → **Email Routing** 并启用，按提示添加 MX 记录；
SPF / DKIM / DMARC 记录按页面引导补齐（或使用自动添加）。

### 2. 安装依赖

```bash
cd worker
npm install
```

### 3. 创建 D1 数据库并建表

```bash
npx wrangler d1 create de5_mailhub
# 把返回的 database_id 填入 wrangler.toml 的 [[d1_databases]] database_id

npx wrangler d1 execute de5_mailhub --remote --file=schema.sql
```

### 4. 配置域名

编辑 `worker/wrangler.toml`：

- `name`：改成你自己的 worker 名（如 `my-tempmail`）
- `[[d1_databases]] database_id`：填上一步拿到的 id
- `[vars] MAIL_DOMAIN`：取消注释并填你的域名（如 `mail.example.com`）

前端会自动用访问者的域名（`location.hostname`）渲染站点内的邮箱地址与分享链接，无需改前端代码。

### 5. 部署

```bash
export CLOUDFLARE_API_TOKEN=<你的 token>
export CLOUDFLARE_ACCOUNT_ID=<你的 account id>
npx wrangler deploy
```

部署后：

- **自定义域**：Dashboard → Workers → 你的 worker → Settings → Domains & Routes → 添加 `mail.example.com`
- **收信**：Dashboard → 域名 → Email → Email Routing → Routing rules → **Catch-all** → Send to a Worker → 你的 worker 名
- cron 触发器（每 5 分钟清理过期数据）随部署自动注册

### 6. 验证

- 打开你的域名 → 点「生成邮箱」→ 复制地址
- 向该地址发一封邮件 → 4 秒内出现在收件箱，验证码自动高亮
- 有效期结束后访问 `/inbox/:地址` → 显示 410「密信已过期销毁」页

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/inbox` | 生成/复用收件箱。`name` 自定义名（可省，随机生成）；`ttl` 10/60/1440（默认 60）。保留名返回 409 |
| GET | `/api/inbox/:address` | 邮件列表。过期返回 410 并清理，不存在 404 |
| GET | `/api/inbox/:address/m/:id` | 邮件详情（自动标记已读） |
| DELETE | `/api/inbox/:address` | 销毁收件箱与全部邮件 |
| POST | `/api/inbox/:address/extend` | 续期（`ttl` 默认 60 分钟） |
| GET | `/inbox/:address` | 公开链接：有效 302 / 过期 410 / 不存在 404 |

限流（按 IP）：创建 30 次/分 · 列表 240 次/分 · 续期 20 次/分 · 公开链接探测 240 次/分。

## 自定义

- **保留名单**：`worker/src/index.ts` 顶部 `RESERVED_NAMES`，按需增删
- **有效期选项**：`TTL_WHITELIST`（10 / 60 / 1440 分钟），改这里 + 前端 `#ttlSeg` 按钮
- **收信体积上限**：`handleEmail` 中 `rawSize > 1_500_000` 直接丢弃，可调
- **品牌页**：404 / 410 页面模板在 `worker/src/index.ts` 的 `gonePage` 与 `www/404.html`

## 数据库

```sql
inboxes(address PK, created_at, expires_at, last_seen);
messages(id, address, mail_id, from_addr, from_name, subject, text_content, html_content, received_at, is_read);
```

## 安全设计

SQL 全参数化、前端全量转义、邮件 HTML 仅渲染于无脚本沙箱、1.5MB 收信上限、保留名拦截、
安全响应头（HSTS/CSP/nosniff）、接口限流。发现漏洞请在 GitHub Issues 中报告（附复现步骤）。

## 许可

[MIT](./LICENSE)
