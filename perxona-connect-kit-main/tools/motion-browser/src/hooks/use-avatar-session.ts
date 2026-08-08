import type React from "react";
import { useCallback } from "react";
import { useMutation } from "@tanstack/react-query";

import { getConnectToken } from "@/lib/api";
import { logout } from "@/lib/auth";
import { usePresenter } from "./use-presenter";

export interface LaunchParams {
  avatarId: string;
  sceneId: string;
  voiceId: string;
}

/**
 * Bridges the Connect API with the imperative presenter.
 *
 *  - `launch` fetches a Connect token then initializes the presenter with the
 *    chosen avatar/scene/voice (React Query mutation drives `isLaunching`).
 *  - `speak` calls `presenter.present(text)` directly — the presenter builds
 *    the performance internally via the Connect API.
 *  - This tool doesn't implement real token refresh: on
 *    `CONNECT_TOKEN_EXPIRED` the session is simply cleared via `logout()`,
 *    which routes the user back to the login screen.
 */
export function useAvatarSession(
  stageRef: React.RefObject<HTMLDivElement | null>,
) {
  const presenter = usePresenter({
    stageRef,
    onConnectTokenExpired: () => {
      logout();
    },
  });

  const launchMutation = useMutation({
    mutationFn: async ({ avatarId, sceneId, voiceId }: LaunchParams) => {
      const { connect_token } = await getConnectToken();

      await presenter.initialize(connect_token, {
        avatarId,
        sceneId,
        voiceId,
      });
    },
  });

  const speakMutation = useMutation({
    mutationFn: async (text: string) => {
      const message = text.trim();
      if (!message || !presenter.ready) return;
      // Resume AudioContext from this user-gesture click before synthesizing speech.
      await presenter.resumeAudio();
      const result = await presenter.present(message);
      if (result && !result.success) {
        throw new Error(
          `Playback failed (${result.code}): ${result.message ?? ""}`,
        );
      }
    },
  });

  const launch = useCallback(
    (params: LaunchParams) => launchMutation.mutateAsync(params),
    [launchMutation],
  );

  const speak = useCallback(
    (text: string) => speakMutation.mutate(text),
    [speakMutation],
  );

  const interrupt = useCallback(() => {
    presenter.interruptPresentation();
  }, [presenter]);

  const playMotion = useCallback(
    (motionId: string) => presenter.playMotion(motionId),
    [presenter],
  );

  return {
    engineReady: presenter.mounted,
    ready: presenter.ready,
    loadError: presenter.loadError,
    retryLoad: presenter.retry,
    launch,
    isLaunching: launchMutation.isPending,
    launchError: launchMutation.error as Error | null,
    speak,
    isSpeaking: speakMutation.isPending,
    speakError: speakMutation.error as Error | null,
    interrupt,
    playMotion,
  };
}
