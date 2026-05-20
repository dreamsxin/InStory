# InStory

<p align="center">
  <img src="apps/web/public/icon-512.png" alt="InStory logo" width="128" height="128" />
</p>

<p align="center">
  <strong>「入戏」InStory：AI 驱动互动小说平台</strong>
</p>

<p align="center">
  翻开下一章，主角就是你。
</p>

<p align="center">
  <a href="#开发启动">开发启动</a>
  ·
  <a href="docs/PRODUCT_PLAN.md">产品规划</a>
  ·
  <a href="docs/ARCHITECTURE.md">架构规划</a>
  ·
  <a href="docs/PROGRESS.md">项目进度</a>
</p>

## 项目概览

InStory 是一个开源的 AI 互动叙事项目，目标是让读者不再只是旁观故事，而是以角色身份进入小说世界，通过选择、对话和行动改变剧情走向。

当前 MVP 聚焦纯文本互动叙事闭环：

- Web 互动阅读器：故事列表、创建会话、选项、自由输入、状态面板、记忆书签。
- 服务端运行时：Fastify API、SQLite 持久化、故事状态机、回溯分支。
- AI 编排：Mock Provider 与 OpenAI-compatible Provider。
- 管理后台：只读 Admin 控制台，用于查看模型配置、运行状态、故事配置、最近会话和审核占位。

## 当前状态

| 模块 | 状态 |
| --- | --- |
| Web 客户端 | 已有阅读器、品牌图标、Admin 控制台 |
| 服务端 API | 已有故事、会话、回合、回溯、Admin API |
| 存储 | SQLite，本地默认 `data/instory.sqlite` |
| AI | 默认 Mock，可切换 OpenAI-compatible |
| 测试 | `npm run test` 覆盖核心状态机、存储和服务端 API |

## 技术栈

- Monorepo：npm workspaces
- Web：Next.js / React / TypeScript
- Server：Node.js / Fastify / TypeScript
- Storage：SQLite via Node.js `node:sqlite`
- Validation：Zod
- Test：Vitest

## 代码结构

```text
apps/
  server/      # Fastify API、SQLite 存储、Admin API
  web/         # Next.js Web 客户端、阅读器、Admin 控制台
packages/
  shared/      # 共享领域类型与 Zod schema
  story-engine/# 叙事状态机、状态差异、时间线节点
  ai-orchestrator/ # Mock / OpenAI-compatible 模型 Provider
docs/
  PRODUCT_PLAN.md
  ARCHITECTURE.md
  PROGRESS.md
```

## 文档

- [产品规划](docs/PRODUCT_PLAN.md)：产品愿景、用户体验、功能范围、商业模式、路线图和核心指标。
- [架构规划](docs/ARCHITECTURE.md)：服务端、客户端、AI 编排、数据模型和 MVP 工程实施路线。
- [项目进度](docs/PROGRESS.md)：已完成事项、验证结果、已知问题和下一步计划。

## 开发启动

当前工程采用 Node.js / TypeScript monorepo，包含服务端、Web 客户端和共享包。

### 环境要求

- Node.js 24+
- npm 11+

### 安装依赖

```bash
npm install
```

### 配置环境变量

复制 `.env.example` 为 `.env`，默认使用 Mock AI，无需 API Key：

```bash
cp .env.example .env
```

如需接入真实模型，将 `LLM_PROVIDER` 改为 `openai-compatible`，并配置：

- `LLM_BASE_URL`
- `LLM_API_KEY`
- `LLM_MODEL`

服务端默认使用 SQLite 保存读者会话：

- 默认路径：`data/instory.sqlite`
- 可通过 `SQLITE_DATABASE_PATH` 覆盖

Admin API 使用 `ADMIN_TOKEN` 保护：

```http
Authorization: Bearer dev-admin-token
```

本地开发如果不设置 `ADMIN_TOKEN`，Admin API 默认允许访问；部署环境必须设置。

### 启动服务端

```bash
npm run dev:server
```

默认地址：

- API: `http://localhost:4000`
- 健康检查: `http://localhost:4000/api/health`
- Admin 状态: `http://localhost:4000/api/admin/status`

### 启动 Web 客户端

```bash
npm run dev:web
```

默认地址：

- Web: `http://localhost:3000`
- Admin 控制台: `http://localhost:3000/admin`

如果服务端设置了 `ADMIN_TOKEN`，Web 服务也需要设置同样的 `ADMIN_TOKEN`，用于服务端渲染 `/admin` 时请求 Admin API。

### 常用检查

```bash
npm run typecheck
npm run test
npm run build
```

### 验证模型 Provider

默认使用 Mock Provider 验证叙事输出结构：

```bash
npm run verify:llm
```

验证真实 OpenAI-compatible 模型时，需要先配置：

```bash
LLM_PROVIDER=openai-compatible
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=...
LLM_MODEL=...
npm run verify:llm
```

