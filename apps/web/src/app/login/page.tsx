import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";
import { LoginForm, RegisterForm } from "@/components/auth-forms";
import { getCurrentUser } from "@/lib/api";

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  if (await getCurrentUser()) {
    redirect("/");
  }

  const { mode } = await searchParams;
  const isRegister = mode === "register";

  return (
    <main className="auth-page">
      <header className="auth-header">
        <BrandMark />
        <p className="auth-tagline">翻开下一章，主角就是你。</p>
      </header>

      <section className="auth-card">
        <nav className="auth-tabs" aria-label="登录或注册">
          <Link className={isRegister ? "auth-tab" : "auth-tab is-active"} href="/login">
            登录
          </Link>
          <Link className={isRegister ? "auth-tab is-active" : "auth-tab"} href="/login?mode=register">
            注册
          </Link>
        </nav>

        {isRegister ? <RegisterForm /> : <LoginForm />}

        <p className="auth-hint">
          {isRegister ? "已经有账号？" : "还没有账号？"}
          <Link href={isRegister ? "/login" : "/login?mode=register"}>
            {isRegister ? "去登录" : "创建一个"}
          </Link>
        </p>
      </section>
    </main>
  );
}
