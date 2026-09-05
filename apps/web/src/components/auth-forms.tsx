"use client";

import { useActionState } from "react";
import { Button, Input, Label, TextField } from "@heroui/react";
import { loginAction, registerAction, type AuthFormState } from "@/app/auth/actions";

const initialState: AuthFormState = { error: null };

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, initialState);

  return (
    <form className="auth-form" action={action}>
      <TextField isRequired>
        <Label>邮箱</Label>
        <Input name="email" type="email" autoComplete="email" placeholder="you@example.com" />
      </TextField>
      <TextField isRequired>
        <Label>密码</Label>
        <Input name="password" type="password" autoComplete="current-password" />
      </TextField>
      {state.error ? (
        <p className="auth-error" role="alert">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" isDisabled={pending}>
        {pending ? "登录中…" : "登录"}
      </Button>
    </form>
  );
}

export function RegisterForm() {
  const [state, action, pending] = useActionState(registerAction, initialState);

  return (
    <form className="auth-form" action={action}>
      <TextField isRequired>
        <Label>邮箱</Label>
        <Input name="email" type="email" autoComplete="email" placeholder="you@example.com" />
      </TextField>
      <TextField isRequired>
        <Label>昵称</Label>
        <Input name="displayName" autoComplete="nickname" placeholder="你在故事里的名字" />
      </TextField>
      <TextField isRequired>
        <Label>密码</Label>
        <Input name="password" type="password" autoComplete="new-password" placeholder="至少 8 位" />
      </TextField>
      {state.error ? (
        <p className="auth-error" role="alert">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" isDisabled={pending}>
        {pending ? "创建中…" : "创建账号"}
      </Button>
    </form>
  );
}
