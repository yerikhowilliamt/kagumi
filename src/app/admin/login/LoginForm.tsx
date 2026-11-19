"use client";

import { useActionState, useState } from "react";
import { login } from "../actions";
import Button from "@/components/Button";
import Field from "@/components/Field";
import styles from "./page.module.css";

// design.md §7 Login: one generic message for every failure (FR20), M2 plan D11 / D20.
export const LOGIN_ALERTS = {
  invalid: "Email atau password salah.",
  server: "Sedang ada gangguan. Coba lagi sebentar lagi.",
} as const;

export default function LoginForm() {
  const [state, action, pending] = useActionState(login, null);
  // Controlled, so React's form reset after the action keeps the email; the password is uncontrolled and clears.
  const [email, setEmail] = useState("");
  return (
    <form action={action} noValidate>
      {state && (
        <div className={styles.alert} role="alert">
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
      <Field admin label="Password" name="password" type="password" autoComplete="current-password" required />
      <div className={styles.submit}>
        <Button type="submit" size="nav" block disabled={pending}>
          {pending ? "Masuk…" : "Masuk"}
        </Button>
      </div>
    </form>
  );
}
