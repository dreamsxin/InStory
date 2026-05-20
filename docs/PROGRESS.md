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
- 抽出服务端 `buildApp`，将路由注册与进程启动解耦，便于测试和后续部署。
- 新增服务端 API 测试，覆盖健康检查、故事详情、创建会话、推进回合、读取会话、回溯分支和错误响应。
- MVP 规划新增“极简管理后台 / AI 叙事系统控制台”，用于模型配置查看、运行状态、故事配置查看、会话审计和审核占位。
- 新增 Admin API：
  - `GET /api/admin/status`
  - `GET /api/admin/models`
  - `GET /api/admin/stories`
  - `GET /api/admin/sessions`
  - `GET /api/admin/sessions/:sessionId`
  - `GET /api/admin/moderation/events`
- Admin API 支持 `ADMIN_TOKEN` Bearer 鉴权，本地未设置 token 时允许访问。
- `SessionStore` 增加会话统计和最近会话列表能力。
- Admin API 测试覆盖状态、模型配置、故事配置、会话审计、审核占位和鉴权。
- 新增 Web `/admin` 极简只读控制台，展示运行状态、模型配置、存储路径、故事配置、最近会话和审核事件占位。
- 新增 InStory 图标资产，用作 Web favicon、客户端品牌 logo 和 512px 备用图标。
- 新增共享 `AppDatabase` SQLite 连接层。
- 新增 `StoryStore`，将 stories、worlds、characters、story_anchors 写入 SQLite 表。
- `StoryCatalog` 改为从 SQLite 读取故事配置，并在空库时从 `stories.seed.json` 自动导入。
- 新增 `StoryStore` 单元测试。
- 新增 `docs/PRODUCT_PLAN.md`，将 README 中的产品规划内容迁入独立文档。
- README 收敛为开源项目入口，仅保留项目概览、当前状态、技术栈、代码结构、文档导航和开发启动说明。
- 新增 `npm run verify:llm`，用于验证 Mock 或 OpenAI-compatible `LLMProvider` 的端到端叙事输出 schema。
- 管理后台支持保存正式 OpenAI-compatible Provider 配置，包含 Provider、Base URL、Model 和 API Key。
- 模型配置写入 SQLite，运行时立即重建 `LLMProvider`，API Key 不通过 Admin API 回显。
- 管理后台新增“验证当前 Provider”按钮，调用 `POST /api/admin/models/verify` 执行最小叙事生成并校验输出 schema。
- OpenAI-compatible Provider 支持根地址或完整 `/chat/completions` 地址，并兼容真实模型把 `memoryEvents` 返回为对象数组的情况。
- 作者工具 MVP 起步：管理后台支持编辑故事基础配置，新增 `PUT /api/admin/stories/:storyId`，可更新标题、标语、类型和 AI 自由度。
- 产品规划和架构调整为“连续阅读 + 随时入戏”的交互模型，新增我的角色、关键介入节点和阅读/入戏双模式。
- 新增 `docs/INTERACTION_DESIGN.md`，定义首页、我的角色、角色选择、阅读器、入戏按钮、关键介入节点和创作入口的 MVP 交互基线。
- 新增 `docs/ADR-UI-STACK.md`，确定 HeroUI 作为基础交互组件库，并明确阅读器等核心体验组件保持自定义。
- 新增“我的角色”服务端基础能力：`ReaderProfile` 共享类型、SQLite `reader_profiles` 存储、`GET/POST /api/reader/profiles`，创建会话时可通过 `readerProfileId` 注入用户角色上下文。
- Web 客户端完成 HeroUI 基础依赖接入，先引入样式与组件包，核心阅读体验仍保持自定义。
- 首页升级为“故事世界 + 我的角色”工作台，支持创建我的角色，并在进入故事前选择入戏身份。

### 验证结果

- `npm install` 成功。
- `npm run typecheck` 通过。
- `npm run build` 通过。
- `npm run test` 通过。
- 服务端健康检查通过：`http://localhost:4000/api/health`。
- Web 首页返回 200：`http://localhost:3000`。

### 已知问题

- `npm audit` 报告 2 个 moderate，来源是 `next@16.2.6` 依赖的 `postcss`。当前 `npm audit fix --force` 会降级到破坏性旧版本，暂不执行。
- 故事、世界、角色和锚点已进入 SQLite 表，但仍以 JSON payload 存储，尚未拆成完全关系化字段。
- SQLite 当前使用 Node.js 内置 `node:sqlite`，在 Node 24 下可能出现实验性 API 提示。
- AI 叙事默认使用 Mock provider；真实模型可通过 `npm run verify:llm` 在配置 API Key 后手动验证。

### 下一步

1. 改造阅读器：增加当前身份胶囊、常驻“入戏”按钮和入戏面板。
2. 扩展服务端叙事模型：阅读段落、关键介入节点、入戏回写。
3. 扩展作者工具，支持编辑世界、角色和剧情锚点。
4. 增加 Web 阅读器交互测试和 `/admin` 页面级测试。
