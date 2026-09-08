import type { AuthUser } from "@instory/shared";
import Link from "next/link";
import { logoutAction } from "@/app/auth/actions";

export function AccountBar({ user }: { user: AuthUser }) {
  return (
    <div className="account-bar">
      <span className="account-identity">
        <span className="account-name">{user.displayName}</span>
        {/* The address, because a display name is not an identity: two accounts can
            carry the same one, and nothing on screen used to say which of them was
            signed in - or that a reader was signed in at all. */}
        <span className="account-email" title={user.email}>
          {user.email}
        </span>
      </span>
      {/* The badge doubles as the only way into the console: it used to be plain
          text, so even an administrator had to type the address by hand. */}
      {user.role === "admin" ? (
        <Link className="account-role" href="/admin">
          管理控制台
        </Link>
      ) : null}
      <form action={logoutAction}>
        <button className="account-logout" type="submit">
          退出登录
        </button>
      </form>
    </div>
  );
}
