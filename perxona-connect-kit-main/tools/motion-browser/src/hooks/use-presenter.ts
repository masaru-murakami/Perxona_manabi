import { useCallback, useEffect, useRef, useState } from "react";

import {
  loadPresenterEngine,
  type Presenter,
  type PresentationResult,
  type PresentationTarget,
} from "@/lib/presenter";

export interface UsePresenterOptions {
  /** The ref to the container element for the presenter stage. */
  stageRef: React.RefObject<HTMLDivElement | null>;
  /** Called when the presenter's Connect token has expired. */
  onConnectTokenExpired?: () => void;
}

export interface UsePresenter {
  /** True once the engine is loaded and the `<sv-presenter>` element is mounted. */
  mounted: boolean;
  ready: boolean;
  /** Set when the presenter engine (CDN script, WASM, etc.) fails to load. */
  loadError: Error | null;
  /** Re-runs the mount sequence after a `loadError`. */
  retry: () => void;
  resumeAudio: () => Promise<void>;
  initialize: (
    connectToken: string,
    target: PresentationTarget,
  ) => Promise<void>;
  present: (content: string) => Promise<PresentationResult | undefined>;
  interruptPresentation: () => void;
  refreshConnectToken: (token: string) => void;
  playMotion: (motionId: string) => Promise<PresentationResult | undefined>;
}

/**
 * Owns the imperative `<sv-presenter>` web component lifecycle: loads the engine
 * once, mounts the element into `stageRef`, wires status/token events, and
 * exposes typed imperative methods. Kept out of React Query because the
 * presenter is stateful and event-driven, not a fetchable resource.
 */
export function usePresenter(options: UsePresenterOptions): UsePresenter {
  const { stageRef } = options;
  const presenterRef = useRef<Presenter | null>(null);
  const [mounted, setMounted] = useState(false);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<Error | null>(null);
  // Bumping this re-runs the mount effect so a failed load can be retried.
  const [retryCount, setRetryCount] = useState(0);

  // Keep the latest token-expiry handler without re-running the mount effect.
  const onExpiredRef = useRef(options.onConnectTokenExpired);

  useEffect(() => {
    let disposed = false;
    const stage = stageRef.current;

    async function mount() {
      try {
        setLoadError(null);
        await loadPresenterEngine();
        if (disposed || !stage) return;

        const el = document.createElement("sv-presenter") as Presenter;
        el.hidden = true;
        el.style.width = "100%";
        el.style.height = "100%";
        el.addEventListener("PRESENTER_STATUS", (event) => {
          const { status: next } = (event as CustomEvent<{ status: string }>)
            .detail;
          if (next === "Ready") {
            el.hidden = false;
            setReady(true);

            // Set a default FOV to avoid the default 90° vertical FOV, which is too narrow for most scenes.
            el.updateCameraFOV({
              distance: 1,
              vertical: 0,
              horizontal: 4.5,
            });

            // On first mount, the element goes from hidden (0x0) to visible, which is
            // itself a real resize that the presenter's internal ResizeObserver-driven
            // canvas scaling picks up. On a re-initialization (e.g. switching avatars)
            // the element is already visible and stays the same size, so that internal
            // resize logic never re-fires and the canvas keeps a stale scale. Nudge the
            // element's width by a pixel and back on the next frame to force a genuine,
            // ResizeObserver-detectable size change and trigger it again.
            const width = el.style.width;
            el.style.width = "calc(100% - 1px)";
            requestAnimationFrame(() => {
              el.style.width = width;
            });
          } else {
            // A re-initialization (e.g. avatar/scene/voice switch) has started;
            // the previous presenter state is no longer valid until Ready fires again.
            setReady(false);
          }
        });
        el.addEventListener("CONNECT_TOKEN_EXPIRED", () => {
          onExpiredRef.current?.();
        });
        stage.append(el);
        presenterRef.current = el;
        setMounted(true);
      } catch (err) {
        if (!disposed) {
          const error = err instanceof Error ? err : new Error(String(err));
          setLoadError(error);
        }
      }
    }

    void mount();
    return () => {
      disposed = true;
      presenterRef.current?.remove();
      presenterRef.current = null;
      setMounted(false);
    };
  }, [stageRef, retryCount]);

  const retry = useCallback(() => {
    setRetryCount((count) => count + 1);
  }, []);

  const resumeAudio = useCallback(async () => {
    await presenterRef.current?.resumeAudioPlayback();
  }, []);

  const initialize = useCallback(
    async (connectToken: string, target: PresentationTarget) => {
      await presenterRef.current?.initialize(connectToken, target);
    },
    [],
  );

  const playMotion = useCallback(async (motionId: string) => {
    return presenterRef.current?.playMotion(motionId);
  }, []);

  const present = useCallback(async (content: string) => {
    return presenterRef.current?.present(content);
  }, []);

  const interruptPresentation = useCallback(() => {
    presenterRef.current?.interruptPresentation();
  }, []);

  const refreshConnectToken = useCallback((token: string) => {
    presenterRef.current?.refreshConnectToken(token);
  }, []);

  return {
    mounted,
    ready,
    loadError,
    retry,
    resumeAudio,
    initialize,
    present,
    playMotion,
    interruptPresentation,
    refreshConnectToken,
  };
}
