"use client";

import { useEffect, useState } from "react";
import { Download, Share } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

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
        <Download className="h-4 w-4" />
        <span className="hidden sm:inline">Install app</span>
      </Button>
    );
  }

  if (!isIos) return null;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm" className="gap-2 rounded-xl" type="button">
          <Download className="h-4 w-4" />
          <span className="hidden sm:inline">Install app</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm rounded-3xl">
        <DialogHeader>
          <DialogTitle>Install BizH</DialogTitle>
          <DialogDescription>
            On iPhone and iPad, Safari installs PWAs from the share menu instead of showing a pop-up.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>1. Tap the <Share className="mx-1 inline h-4 w-4 align-text-bottom" /> share button in Safari.</p>
          <p>2. Choose <strong>Add to Home Screen</strong>.</p>
          <p>3. Tap <strong>Add</strong> to place BizH on your home screen.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
