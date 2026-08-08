import type { RefObject } from "react";

import { Button } from "@/components/ui/button";

interface PresenterStageProps {
  stageRef: RefObject<HTMLDivElement | null>;
  loadError: Error | null;
  onRetryLoad: () => void;
}

export function PresenterStage({
  stageRef,
  loadError,
  onRetryLoad,
}: PresenterStageProps) {
  return (
    <>
      <div ref={stageRef} className="absolute inset-0 isolate" />

      {loadError && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-grey-900/90 text-center text-white">
          <p className="max-w-md px-6 text-sm">Presenter failed to load.</p>
          <Button variant="secondary" onClick={onRetryLoad}>
            Retry
          </Button>
        </div>
      )}

      <div className="pointer-events-none absolute left-1/2 top-1/3 size-[340px] -translate-x-1/2 rounded-full bg-[rgba(243,133,111,0.5)] blur-[120px]" />
    </>
  );
}
