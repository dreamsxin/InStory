import {
  getAdminModelConfig,
  getAdminModerationEvents,
  getAdminSessions,
  getAdminStatus,
  getAdminStories
} from "@/lib/api";
import { BrandMark } from "@/components/brand-mark";
import { updateModelConfigAction, updateStorySummaryAction, verifyModelConfigAction } from "./actions";

export default async function AdminPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const [status, modelConfig, stories, sessions, moderationEvents] = await Promise.all([
    getAdminStatus(),
    getAdminModelConfig(),
    getAdminStories(),
    getAdminSessions(),
    getAdminModerationEvents()
  ]);

  return (
    <main className="admin-page">
      <header className="admin-header">
        <div className="brand-row">
          <BrandMark size={42} />
          <div className="brand">
            <h1>InStory 控制台</h1>
            <p className="muted">模型、内容、会话和审核的 MVP 只读视图</p>
          </div>
        </div>
      </header>

      <section className="admin-kpis">
        <Metric label="服务" value={status.service} />
        <Metric label="存储" value={status.storage.type} />
        <Metric label="故事数" value={status.counts.stories.toString()} />
        <Metric label="会话数" value={status.counts.sessions.toString()} />
      </section>

      <section className="admin-grid">
        <article className="panel">
          <h2>模型配置</h2>
          <form className="admin-form" action={updateModelConfigAction}>
            <label>
              <span>Provider</span>
              <select name="provider" defaultValue={modelConfig.provider}>
                <option value="mock">Mock</option>
                <option value="openai-compatible">OpenAI-compatible</option>
              </select>
            </label>
            <label>
              <span>Base URL</span>
              <input name="baseUrl" type="url" defaultValue={modelConfig.baseUrl ?? ""} placeholder="https://api.openai.com/v1" />
            </label>
            <label>
              <span>Model</span>
              <input name="model" type="text" defaultValue={modelConfig.model ?? ""} placeholder="gpt-4.1-mini" />
            </label>
            <label>
              <span>API Key</span>
              <input name="apiKey" type="password" placeholder={modelConfig.apiKeyConfigured ? "保持现有 Key" : "输入 API Key"} />
            </label>
            <label className="checkbox-line">
              <input name="clearApiKey" type="checkbox" />
              <span>清除已保存 API Key</span>
            </label>
            <button className="primary" type="submit">保存模型配置</button>
          </form>
          <form className="admin-form compact" action={verifyModelConfigAction}>
            <button className="secondary" type="submit">验证当前 Provider</button>
          </form>
          <VerificationNotice query={query} />
          <dl className="admin-list">
            <div>
              <dt>Provider</dt>
              <dd>{modelConfig.provider}</dd>
            </div>
            <div>
              <dt>Base URL</dt>
              <dd>{modelConfig.baseUrl ?? "未配置"}</dd>
            </div>
            <div>
              <dt>Model</dt>
              <dd>{modelConfig.model ?? "未配置"}</dd>
            </div>
            <div>
              <dt>API Key</dt>
              <dd>{modelConfig.apiKeyConfigured ? "已配置" : "未配置"}</dd>
            </div>
            <div>
              <dt>更新时间</dt>
              <dd>{modelConfig.updatedAt ? formatDate(modelConfig.updatedAt) : "未记录"}</dd>
            </div>
          </dl>
        </article>

        <article className="panel">
          <h2>存储状态</h2>
          <dl className="admin-list">
            <div>
              <dt>类型</dt>
              <dd>{status.storage.type}</dd>
            </div>
            <div>
              <dt>路径</dt>
              <dd className="breakable">{status.storage.databasePath}</dd>
            </div>
          </dl>
        </article>
      </section>

      <section className="panel">
        <h2>故事配置</h2>
        <div className="story-editor-list">
          {stories.map((item) => (
            <form className="story-editor-row" action={updateStorySummaryAction} key={item.story.id}>
              <input name="storyId" type="hidden" value={item.story.id} />
              <label>
                <span>标题</span>
                <input name="title" type="text" defaultValue={item.story.title} required />
              </label>
              <label>
                <span>标语</span>
                <input name="tagline" type="text" defaultValue={item.story.tagline} required />
              </label>
              <label>
                <span>类型</span>
                <input name="genre" type="text" defaultValue={item.story.genre} required />
              </label>
              <label>
                <span>AI 自由度</span>
                <select name="aiFreedom" defaultValue={item.story.aiFreedom}>
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                </select>
              </label>
              <div className="story-editor-meta">
                <span>{item.world.locations.length} 地点</span>
                <span>{item.characters.length} 角色</span>
                <span>{item.anchors.length} 锚点</span>
              </div>
              <button className="secondary" type="submit">保存故事</button>
            </form>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>最近会话</h2>
        {sessions.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>会话</th>
                  <th>故事</th>
                  <th>回合</th>
                  <th>更新时间</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => (
                  <tr key={session.id}>
                    <td className="mono">{session.id}</td>
                    <td>{session.storyId}</td>
                    <td>{session.turnCount}</td>
                    <td>{formatDate(session.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">暂无会话。</p>
        )}
      </section>

      <section className="panel">
        <h2>审核事件</h2>
        {moderationEvents.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>类型</th>
                  <th>状态</th>
                  <th>时间</th>
                </tr>
              </thead>
              <tbody>
                {moderationEvents.map((event) => (
                  <tr key={event.id}>
                    <td className="mono">{event.id}</td>
                    <td>{event.type}</td>
                    <td>{event.status}</td>
                    <td>{formatDate(event.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">暂无审核事件。MVP 阶段先保留接口和视图占位。</p>
        )}
      </section>
    </main>
  );
}

function VerificationNotice({ query }: { query: Record<string, string | string[] | undefined> }) {
  const status = readQuery(query.verify);
  if (!status) {
    return null;
  }

  if (status === "ok") {
    return (
      <p className="notice success">
        验证通过：{readQuery(query.provider)}，耗时 {readQuery(query.latencyMs)}ms，返回 {readQuery(query.choices)} 个选项。
      </p>
    );
  }

  return <p className="notice error">验证失败：{readQuery(query.message) ?? "请检查 Provider 配置"}</p>;
}

function readQuery(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <article className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}
