const DEFAULT_PRESENTER_URL =
  "https://cdn.perxona.ai/asia/prod/latest/widget/entry/presenter.js";

export interface AppEnvironment {
  apiBaseUrl: string;
  presenterUrl: string;
}

export function getAppEnvironment(): AppEnvironment {
  const apiBaseUrl = import.meta.env.VITE_PERXONA_API_BASE_URL as
    | string
    | undefined;
  if (!apiBaseUrl) {
    throw new Error("Missing required env var: VITE_PERXONA_API_BASE_URL");
  }

  return {
    apiBaseUrl,
    presenterUrl:
      (import.meta.env.VITE_PRESENTER_URL as string | undefined) ||
      DEFAULT_PRESENTER_URL,
  };
}

export function getApiBaseUrl(): string {
  return getAppEnvironment().apiBaseUrl;
}

export function getPresenterUrl(): string {
  return getAppEnvironment().presenterUrl;
}
