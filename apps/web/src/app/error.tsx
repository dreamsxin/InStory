"use client";

import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";

/**
 * The app had no error boundary at all, so anything that threw - an expired
 * session, a story that was deleted, an API that is down - handed the reader the
 * framework's own error screen with no way back and no explanation.
 */
export default function AppError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main className="auth-page">
      <header className="auth-header">
        <BrandMark />
        <p className="auth-tagline">这一页没能打开。</p>
      </header>

      <section className="auth-card">
        <h1 className="fallback-title">出了点问题</h1>
        <p className="fallback-body">
          {error.message || "服务暂时没有响应。"}
        </p>
        <p className="fallback-body muted">
          你的阅读进度保存在服务端，不会因为这一次失败而丢失。
        </p>
        <div className="fallback-actions">
          <button className="fallback-button" onClick={reset} type="button">
            重试这一页
          </button>
          <Link className="fallback-link" href="/">
            回到书架
          </Link>
        </div>
      </section>
    </main>
  );
}
