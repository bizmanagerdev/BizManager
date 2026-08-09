"use client";

import { useEffect, useState } from "react";
import { DownloadIcon, ShareIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { ViewDialog } from "@/components/ui/view-dialog";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
};

function isIosDevice() {
  if (typeof window === "undefined") return false;

  const userAgent = window.navigator.userAgent.toLowerCase();
  const platform = window.navigator.platform.toLowerCase();
  const maxTouchPoints = window.navigator.maxTouchPoints ?? 0;

  return /iphone|ipad|ipod/.test(userAgent) || (platform === "macintel" && maxTouchPoints > 1);
}

function isStandaloneMode() {
  if (typeof window === "undefined") return false;

  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    (typeof window.navigator !== "undefined" &&
      "standalone" in window.navigator &&
      Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone))
  );
}

export default function PwaInstallButton() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(isStandaloneMode);
  const [isIos] = useState(isIosDevice);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    function handleBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    }

    function handleInstalled() {
      setDeferredPrompt(null);
      setIsInstalled(true);
    }

    function handleDisplayModeChange() {
      setIsInstalled(isStandaloneMode());
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);

    const displayMode = window.matchMedia("(display-mode: standalone)");
    displayMode.addEventListener("change", handleDisplayModeChange);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
      displayMode.removeEventListener("change", handleDisplayModeChange);
    };
  }, []);

  async function handleInstall() {
    if (!deferredPrompt) return;

    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome !== "accepted") {
      setDeferredPrompt(null);
      return;
    }

    setDeferredPrompt(null);
    setIsInstalled(true);
  }

  if (isInstalled) return null;

  if (deferredPrompt) {
    return (
      <Button
        variant="secondary"
        size="sm"
        className="gap-2 rounded-xl"
        type="button"
        onClick={() => void handleInstall()}
      >
        <DownloadIcon className="h-4 w-4" />
        <span className="hidden sm:inline">התקנת האפליקציה</span>
      </Button>
    );
  }

  if (!isIos) return null;

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        className="gap-2 rounded-xl"
        type="button"
        onClick={() => setHelpOpen(true)}
      >
        <DownloadIcon className="h-4 w-4" />
        <span className="hidden sm:inline">התקנת האפליקציה</span>
      </Button>

      <ViewDialog
        open={helpOpen}
        onOpenChange={setHelpOpen}
        title="התקנת BizH"
        description="באייפון ובאייפד, ספארי מתקין אפליקציות מתפריט השיתוף במקום להציג חלון קופץ."
        size="formSm"
      >
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>1. הקישו על כפתור השיתוף <ShareIcon className="mx-1 inline h-4 w-4 align-text-bottom" /> בספארי.</p>
          <p>2. בחרו באפשרות <strong>הוספה למסך הבית</strong>.</p>
          <p>3. הקישו על <strong>הוספה</strong> כדי להוסיף את BizH למסך הבית.</p>
        </div>
      </ViewDialog>
    </>
  );
}
