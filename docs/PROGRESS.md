# InStory 项目进度

## 2026-05-20

### 已完成

- 建立 Node.js / TypeScript monorepo。
- 新增 `apps/server` Fastify 服务端骨架。
- 新增 `apps/web` Next.js Web 客户端骨架。
- 新增 `packages/shared` 共享领域类型与请求校验。
- 新增 `packages/story-engine` 叙事状态机基础能力。
- 新增 `packages/ai-orchestrator` Mock AI 叙事供应商。
- 实现 MVP API：
  - `GET /api/health`
  - `GET /api/stories`
  - `GET /api/stories/:storyId`
  - `POST /api/stories/:storyId/sessions`
  - `GET /api/sessions/:sessionId`
  - `POST /api/sessions/:sessionId/turns`
  - `POST /api/sessions/:sessionId/rewind`
- 实现 Web MVP：
  - 故事列表
  - 创建会话
  - 阅读器
  - 智能选项
  - 自由输入
  - 状态面板
  - 记忆书签展示
- README 增加开发启动说明。
- 新增 OpenAI-compatible `LLMProvider`。
- 服务端支持通过环境变量在 Mock AI 和 OpenAI-compatible 模型之间切换。
- 新增 `.env.example`。
- 为 `story-engine` 增加状态机单元测试，覆盖初始状态、状态差异合并、去重、时间线节点判定和摘要回退。
- 修正 workspace 测试脚本，允许暂未添加测试的应用包通过 `npm run test`。
- 接入 SQLite 会话存储，读者会话、回合、状态快照和时间线以 JSON payload 形式持久化到本地数据库。
- 新增 `SessionStore` 单元测试，覆盖保存、读取和更新。
- 将故事、世界、角色、剧情锚点从服务端入口硬编码迁移到 `stories.seed.json`。
- 新增 `StoryCatalog` 仓库层和测试，用 Zod 校验示例故事种子数据。
- `GET /api/stories/:storyId` 返回完整故事详情，包括 world、characters、anchors。

### 验证结果

- `npm install` 成功。
- `npm run typecheck` 通过。
- `npm run build` 通过。
- `npm run test` 通过。
- 服务端健康检查通过：`http://localhost:4000/api/health`。
- Web 首页返回 200：`http://localhost:3000`。

### 已知问题

- `npm audit` 报告 2 个 moderate，来源是 `next@16.2.6` 依赖的 `postcss`。当前 `npm audit fix --force` 会降级到破坏性旧版本，暂不执行。
- 故事、世界、角色和锚点已迁移为 JSON 种子数据，尚未进入 SQLite 表。
- SQLite 当前使用 Node.js 内置 `node:sqlite`，在 Node 24 下可能出现实验性 API 提示。
- AI 叙事暂时使用 Mock provider，尚未接入真实模型。
- 真实模型 Provider 已接入配置，但尚未用实际 API Key 做端到端验证。

### 下一步

1. 增加服务端 API 测试。
2. 增加真实模型端到端验证用例。
3. 将故事、角色、锚点种子数据迁移到 SQLite 表。
4. 在 Web 作者工具中展示/编辑故事配置。
