/**
 * Connect Kit API client — calls the Perxona API directly.
 *
 * Auth model: the bearer token comes from `lib/auth.ts` (interactive login,
 * see `useAuth`/`LoginScreen`) — this module never handles credentials
 * itself. A 401 here means the session expired; it clears the stored token
 * so the UI falls back to the login screen.
 */

import { getToken, logout } from "./auth";
import { getApiBaseUrl, getPresenterUrl } from "./env";

export interface CatalogItem {
  id: string;
  name: string;
  thumbnail_urls?: Record<string, string>;
}

export interface AppConfig {
  mock: boolean;
  chat: boolean;
  presenterUrl: string;
}

export interface ApiError extends Error {
  status?: number;
  data?: unknown;
}

async function request<T>(
  path: string,
  {
    method = "GET",
    body,
    auth = true,
  }: { method?: string; body?: unknown; auth?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (auth) {
    const token = getToken();
    if (!token) {
      throw Object.assign(new Error("Not signed in"), {
        status: 401,
      }) as ApiError;
    }
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!res.ok) {
    if (res.status === 401 && auth) logout();
    const data = await res.json().catch(() => ({}) as Record<string, unknown>);
    const detail = (data as { detail?: unknown }).detail;
    const message =
      (Array.isArray(detail)
        ? (detail[0] as { msg?: string })?.msg
        : (detail as string)) ??
      (data as { error?: string }).error ??
      res.statusText;
    throw Object.assign(new Error(message), {
      status: res.status,
      data,
    }) as ApiError;
  }
  return res.json() as Promise<T>;
}

/** Static config — no upstream call needed. */
export const getConfig = (): Promise<AppConfig> =>
  Promise.resolve({
    mock: false,
    chat: false,
    presenterUrl: getPresenterUrl(),
  });

export const getAvatars = async () => {
  const data = await request<{
    items: Array<{
      avatar_id: string;
      name: string;
      thumbnail_urls?: Record<string, string>;
    }>;
  }>("/api/v1/connect/assets/avatars");
  return {
    items: data.items.map(
      ({ avatar_id, ...rest }) => ({ id: avatar_id, ...rest }) as CatalogItem,
    ),
  };
};

export const getScenes = async () => {
  const data = await request<{
    items: Array<{
      scene_id: string;
      name: string;
      thumbnail_urls?: Record<string, string>;
    }>;
  }>("/api/v1/connect/assets/scenes");
  return {
    items: data.items.map(
      ({ scene_id, ...rest }) => ({ id: scene_id, ...rest }) as CatalogItem,
    ),
  };
};

export const getVoices = () =>
  request<{ items: CatalogItem[] }>("/api/v1/connect/voices");

/** Returns the current Connect bearer token for the presenter SDK.
 *  The login `access_token` IS the connect token — no separate exchange needed. */
export const getConnectToken = () => {
  const token = getToken();
  if (!token) {
    const error: ApiError = new Error("Not signed in");
    error.status = 401;
    throw error;
  }
  return { connect_token: token } as { connect_token: string };
};

export interface MotionApiItem {
  id: string;
  name: string;
  thumbnail: string | undefined;
  tags: string[];
}

export const getMotions = async (avatarId: string) => {
  const data = await request<{
    items: Array<{
      motion_id: string;
      name: string;
      tags: string[];
      thumbnail?: string;
    }>;
  }>(`/api/v1/connect/assets/avatars/${encodeURIComponent(avatarId)}/motions`);
  return {
    items: data.items.map(
      ({ motion_id, name, tags, thumbnail }): MotionApiItem => ({
        id: motion_id,
        name,
        tags,
        thumbnail,
      }),
    ),
  };
};
