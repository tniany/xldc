# XLdc

一个带用户系统、配额计费和管理后台的 OpenAI 兼容 API 分发站。用户必须登录后才能查看内容和领取 API Key，管理员可以配置上游、鱼干兑换比例、公共池、用户额度、模型和公告。

## 已实现功能

- 账号密码注册、登录和 Discord OAuth 登录
- Discord 用户自动使用 Discord 头像
- SQLite 持久化，密码使用 scrypt，Session/API Key 只保存哈希
- 用户生成、查看前缀、停用自己的 API Key
- 公共鱼干池、用户总额度、单 Key 额度三层限制
- `/v1/*` OpenAI 兼容上游代理，根据返回的 usage 扣配额
- 实时时钟、公告、带输入/输出及按次定价的模型列表、接入文档
- 管理员配置上游、Discord、注册开关、兑换比例和内容
- 管理员创建用户、独立调用记录（含鱼干消耗）与站点调用统计、从上游同步模型及 New API 价格
- 管理员可直接校正当前公共鱼干、修改现有模型信息和价格
- Docker、Docker Compose、GitHub Actions 自动测试与 GHCR 镜像构建

## 小白部署教程

### 1. 准备服务器

准备一台安装了 Docker 和 Docker Compose 的 Linux 服务器。把仓库下载到服务器后，进入仓库目录：

```bash
git clone https://github.com/tniany/xldc.git
cd xldc
```

### 2. 创建配置

复制示例环境变量：

```bash
cp .env.example .env
```

打开 `.env`，把 `ADMIN_PASSWORD` 改成一个至少 12 位、别人猜不到的密码。这个账号用于第一次进入管理后台。

### 3. 启动

```bash
docker compose up -d --build
```

浏览器打开 `http://服务器IP:3000`，使用 `.env` 里的管理员账号密码登录。数据保存在 Docker 卷 `xldc-data` 中，更新容器不会丢失。

### 4. 配置 API 上游

登录后点击左侧“管理后台”，填写：

- 上游地址，例如 `https://api.openai.com`
- 上游 API Key
- 每条鱼干兑换配额，默认 `5000`
- 公共鱼干池的鱼干条数，例如填 `1000`

保存后，用户创建的 Key 就可以请求本站的 `/v1/chat/completions`。

### 5. 配置 Discord 登录（可选）

1. 打开 Discord Developer Portal，新建 Application。
2. 在 OAuth2 页面添加 Redirect URL：`https://你的域名/api/auth/discord/callback`。
3. 把 Client ID、Client Secret 和完全相同的回调地址填入管理后台。
4. 保存后，登录页会自动显示 Discord 登录按钮。

生产环境建议使用 Nginx 或 Caddy 配置 HTTPS。Discord 回调地址也应使用 HTTPS。

## 使用 API

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer sk-xldc-你的钥匙" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"你好"}]}'
```

当前版本只支持非流式调用，即不要传 `stream: true`。公共池、用户额度或单 Key 额度任意一个用尽时会返回 HTTP 429。

## 本地开发

要求 Node.js 24：

```bash
npm install
npm run dev
```

前端地址为 `http://localhost:5173`，后端为 `http://localhost:3000`。默认开发管理员为 `admin / change-me-now`，只可用于本地测试。

常用检查：

```bash
npm run typecheck
npm test
npm run build
```

## GitHub 镜像

推送到 `main` 后，工作流会构建 Linux 镜像并推送到：

```text
ghcr.io/tniany/xldc:latest
```

如果镜像仓库默认是私有的，需要在 GitHub 仓库的 Packages 设置中改成公开，服务器才能匿名拉取。

## 安全提醒

- 第一次部署必须修改默认管理员密码。
- 不要把 `.env`、上游 API Key 或用户 Key 提交进 Git。
- 定期备份 Docker 卷中的 `/app/data/xldc.db`。
- 建议在反向代理层增加登录和 API 请求频率限制。

## License

MIT
