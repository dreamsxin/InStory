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

### 验证结果

- `npm install` 成功。
- `npm run typecheck` 通过。
- `npm run build` 通过。
- 服务端健康检查通过：`http://localhost:4000/api/health`。
- Web 首页返回 200：`http://localhost:3000`。

### 已知问题

- `npm audit` 报告 2 个 moderate，来源是 `next@16.2.6` 依赖的 `postcss`。当前 `npm audit fix --force` 会降级到破坏性旧版本，暂不执行。
- 当前会话、故事和角色数据仍为内存数据，重启服务后会丢失。
- AI 叙事暂时使用 Mock provider，尚未接入真实模型。
- 真实模型 Provider 已接入配置，但尚未用实际 API Key 做端到端验证。

### 下一步

1. 增加持久化层，优先接入 PostgreSQL/SQLite 二选一的开发环境。
2. 为 `story-engine` 增加单元测试。
3. 完善作者配置数据结构与示例故事种子数据。
4. 增加真实模型端到端验证用例。
