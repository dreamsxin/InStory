import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";

/** A story that no longer exists, or an address nobody typed correctly. */
export default function NotFound() {
  return (
    <main className="auth-page">
      <header className="auth-header">
        <BrandMark />
        <p className="auth-tagline">这一页不在书里。</p>
      </header>

      <section className="auth-card">
        <h1 className="fallback-title">找不到这个页面</h1>
        <p className="fallback-body">
          地址可能输错了，或者这个故事、这段阅读进度已经被删除。
        </p>
        <div className="fallback-actions">
          <Link className="fallback-link" href="/">
            回到书架
          </Link>
        </div>
      </section>
    </main>
  );
}
