import { useCallback, useSyncExternalStore } from "react";
import { useMutation } from "@tanstack/react-query";

import * as auth from "@/lib/auth";

/**
 * React binding for the module-scoped Connect auth store (see `lib/auth.ts`).
 * `login` is a mutation so forms get `isPending`/`error` for free.
 */
export function useAuth() {
  const token = useSyncExternalStore(auth.subscribe, auth.getToken);
  const email = useSyncExternalStore(auth.subscribe, auth.getEmail);

  const loginMutation = useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      auth.login(email, password),
  });

  const login = useCallback(
    (email: string, password: string) =>
      loginMutation.mutateAsync({ email, password }),
    [loginMutation],
  );

  const logout = useCallback(() => auth.logout(), []);

  return {
    isAuthenticated: !!token,
    email,
    login,
    isLoggingIn: loginMutation.isPending,
    loginError: loginMutation.error as Error | null,
    logout,
  };
}
