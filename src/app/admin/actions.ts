"use server";
// Every export of this file is a public endpoint (M2 plan D11, D23): only login and logout. logout is protected,
// login is on the gate test's allow-list (D12).
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { attemptLogin, createSession, deleteSession, requireAdmin, SESSION_COOKIE } from "@/lib/auth";
import { db } from "@/lib/db";

export type LoginState = { error: "invalid" | "server" } | null;

export async function login(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = form.get("email");
  const password = form.get("password");
  if (typeof email !== "string" || typeof password !== "string") return { error: "invalid" };
  try {
    const now = new Date();
    const result = await attemptLogin(db, { email, password, now });
    if (!result.ok) return { error: "invalid" };
    const { token } = await createSession(db, result.adminId, now);
    // D2, D8: no maxAge or expires; sessions.expires_at is the only clock.
    (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: "lax", path: "/" });
  } catch (error) {
    // Name and code only: a driver message could quote the input.
    const { name, code } = (error ?? {}) as { name?: unknown; code?: unknown };
    console.error("[login] failed", String(name ?? "Error"), String(code ?? ""));
    return { error: "server" };
  }
  redirect("/admin");
}

export async function logout(): Promise<void> {
  const { sessionId } = await requireAdmin();
  await deleteSession(db, sessionId);
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/admin/login");
}
