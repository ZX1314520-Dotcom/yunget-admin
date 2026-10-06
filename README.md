# YunGet 管理后台

网盘下载工具 YunGet 的管理后台：设备注册/心跳、下载任务上报、Web 管理界面。

## 技术栈
- Node.js + Express
- SQLite（better-sqlite3）
- 原生 HTML/CSS/JS 单页管理界面

## 部署（Render）
登录 [render.com](https://render.com) → **New** → **Blueprint** → 选择本仓库，Render 会按 `render.yaml` 自动创建服务。

或本地运行：
```bash
npm install
npm start   # 或 ./start.sh
```

## 上报 API（供 YunGet App 调用）
- `POST /api/device/register` 设备注册
- `POST /api/device/heartbeat` 心跳 + 任务 + 账号批量上报
- `POST /api/task` 单任务上报

## 管理界面
启动后访问 `http://服务器:端口/`，包含：仪表盘、设备、下载任务、网盘账号、设置五个视图。

管理 API 可通过 `X-Admin-Token` 请求头鉴权（未设置令牌则公开）。
