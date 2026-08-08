import { useRef } from "react";

import { AppHeader } from "@/components/custom/app-header";
import { ActionPickerPanel } from "@/components/custom/action-picker-panel";
import { LoginScreen } from "@/components/custom/login-screen";
import { PresenterControlBar } from "@/components/custom/presenter-control-bar";
import { PresenterStage } from "@/components/custom/presenter-stage";
import { useAvatarSession } from "@/hooks/use-avatar-session";
import { useAuth } from "@/hooks/use-auth";
import { useAppErrorToasts } from "@/hooks/use-app-error-toasts";
import { useAvatarBrowserState } from "@/hooks/use-avatar-browser-state";
import { useCatalog } from "@/hooks/use-catalog";
import { usePresenterLaunch } from "@/hooks/use-presenter-launch";

function App() {
  const auth = useAuth();

  if (!auth.isAuthenticated) {
    return (
      <LoginScreen
        onLogin={auth.login}
        isLoggingIn={auth.isLoggingIn}
        error={auth.loginError}
      />
    );
  }

  return <AuthenticatedApp email={auth.email} onSignOut={auth.logout} />;
}

function AuthenticatedApp({
  email,
  onSignOut,
}: {
  email: string | null;
  onSignOut: () => void;
}) {
  const { avatars, voices, scenes, error: catalogError } = useCatalog();
  const stageRef = useRef<HTMLDivElement>(null);
  const session = useAvatarSession(stageRef);

  const {
    composerRef,
    motions,
    motionsError,
    resolvedSelection,
    selectedMotionId,
    setSelection,
    handleMotionChange,
  } = useAvatarBrowserState({ avatars, scenes, voices });

  useAppErrorToasts({
    catalogError,
    loadError: session.loadError,
    launchError: session.launchError,
    speakError: session.speakError,
    motionsError,
  });

  usePresenterLaunch({
    engineReady: session.engineReady,
    launch: session.launch,
    avatarId: resolvedSelection.avatar,
    sceneId: resolvedSelection.scene,
    voiceId: resolvedSelection.voice,
  });

  return (
    /* Full-page stack: presenter is the background, all UI overlaid on top */
    <div className="relative min-h-svh overflow-hidden bg-grey-900">
      <PresenterStage
        stageRef={stageRef}
        loadError={session.loadError}
        onRetryLoad={session.retryLoad}
      />

      {/* Header — overlaid at top, semi-transparent */}
      <AppHeader
        className="absolute inset-x-0 top-0 z-20"
        account={{ name: email ?? "Account" }}
        onSignOut={onSignOut}
      />

      <ActionPickerPanel
        composerRef={composerRef}
        motions={motions}
        selectedMotionId={selectedMotionId}
        isSpeaking={session.isSpeaking}
        onSend={(text) => void session.speak(text)}
        onMotionChange={handleMotionChange}
        onMotionClick={session.playMotion}
      />

      <PresenterControlBar
        avatars={avatars}
        scenes={scenes}
        voices={voices}
        selection={resolvedSelection}
        onAvatarChange={(avatar) =>
          setSelection((current) => ({ ...current, avatar }))
        }
        onSceneChange={(scene) =>
          setSelection((current) => ({ ...current, scene }))
        }
        onVoiceChange={(voice) =>
          setSelection((current) => ({ ...current, voice }))
        }
      />
    </div>
  );
}

export default App;
