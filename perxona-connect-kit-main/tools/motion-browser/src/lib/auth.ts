import { queryClient } from "./query-client";
import { getApiBaseUrl } from "./env";

const STORAGE_KEY = "connect.token";
const EMAIL_STORAGE_KEY = "connect.email";

type TokenResponse = { access_token: string };

export interface AuthError extends Error {
  status?: number;
}

let token: string | null = sessionStorage.getItem(STORAGE_KEY);
let email: string | null = sessionStorage.getItem(EMAIL_STORAGE_KEY);
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getToken(): string | null {
  return token;
}

export function getEmail(): string | null {
  return email;
}

export async function login(
  loginEmail: string,
  password: string,
): Promise<void> {
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/v1/connect/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: loginEmail, password }),
    });

    if (!res.ok) {
      const error: AuthError = new Error("Login failed");
      error.status = res.status;
      throw error;
    }

    const { access_token } = (await res.json()) as TokenResponse;
    token = access_token;
    email = loginEmail;
    sessionStorage.setItem(STORAGE_KEY, access_token);
    sessionStorage.setItem(EMAIL_STORAGE_KEY, loginEmail);
    notify();
  } catch (err) {
    // Avoid leaking backend error details/environment info to the browser
    // console in production; keep full detail only for local debugging.
    if (import.meta.env.DEV) {
      console.error("Login failed:", err);
    } else {
      console.error("Login failed");
    }
    throw err;
  }
}

export function logout(): void {
  token = null;
  email = null;
  sessionStorage.removeItem(STORAGE_KEY);
  sessionStorage.removeItem(EMAIL_STORAGE_KEY);
  // Drop all cached queries (catalog, motions, etc.) so a subsequent login —
  // by the same or a different account, in the same tab — never serves stale
  // data from the previous session while within staleTime.
  queryClient.clear();
  notify();
}
