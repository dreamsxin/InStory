import type { AuthUser } from "@instory/shared";
import { logoutAction } from "@/app/auth/actions";

export function AccountBar({ user }: { user: AuthUser }) {
  return (
    <div className="account-bar">
      <span className="account-name">{user.displayName}</span>
      {user.role === "admin" ? <span className="account-role">管理员</span> : null}
      <form action={logoutAction}>
        <button className="account-logout" type="submit">
          退出登录
        </button>
      </form>
    </div>
  );
}
