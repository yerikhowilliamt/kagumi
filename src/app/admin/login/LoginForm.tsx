"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { login, type LoginState } from "../actions";
import Button from "@/components/Button";
import Field from "@/components/Field";
import styles from "./page.module.css";

// design.md §7 Login: one generic message for every failure (FR20), M2 plan D11 / D20.
export const LOGIN_ALERTS = {
  invalid: "Email atau password salah.",
  server: "Sedang ada gangguan. Coba lagi sebentar lagi.",
} as const;

export default function LoginForm() {
  // attempt keys the alert, so a repeated failure re-mounts it and is announced again (design.md §8, TR-M2.2-04).
  const [state, action, pending] = useActionState(
    async (prev: (LoginState & { attempt: number }) | null, form: FormData) => {
      const result = await login(null, form);
      return result && { ...result, attempt: (prev?.attempt ?? 0) + 1 };
    },
    null,
  );
  const password = useRef<HTMLInputElement>(null);
  // After a failure, focus goes to the cleared password field (design.md §8).
  useEffect(() => {
    if (state) password.current?.focus();
  }, [state]);
  // Controlled, so React's form reset after the action keeps the email; the password is uncontrolled and clears.
  const [email, setEmail] = useState("");
  return (
    <form action={action} noValidate>
      {state && (
        <div key={state.attempt} className={styles.alert} role="alert">
          {LOGIN_ALERTS[state.error]}
        </div>
      )}
      <Field
        admin
        label="Email"
        name="email"
        type="email"
        autoComplete="username"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <Field admin ref={password} label="Password" name="password" type="password" autoComplete="current-password" required />
      <div className={styles.submit}>
        <Button type="submit" size="nav" block disabled={pending}>
          {pending ? "Masuk…" : "Masuk"}
        </Button>
      </div>
    </form>
  );
}
