"use client";

import { Camera, RefreshCcw, Upload } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type FileUploadActionsProps = {
  files: File[];
  onFilesSelected: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  allowCamera?: boolean;
  chooseLabel: ReactNode;
  takePhotoLabel?: ReactNode;
  chooseVariant?: ButtonProps["variant"];
  takePhotoVariant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
};

export function FileUploadActions({
  files,
  onFilesSelected,
  accept,
  multiple = false,
  disabled = false,
  allowCamera = true,
  chooseLabel,
  takePhotoLabel = "צלם תמונה",
  chooseVariant = "secondary",
  takePhotoVariant = "outline",
  size = "default",
  className,
}: FileUploadActionsProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string>("");
  const [cameraReady, setCameraReady] = useState(false);
  const [startingCamera, setStartingCamera] = useState(false);
  const [cameraSession, setCameraSession] = useState(0);

  useEffect(() => {
    if (files.length > 0) return;
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [files]);

  useEffect(() => {
    if (!cameraOpen) return;

    let cancelled = false;
    const videoElement = videoRef.current;

    async function startCamera() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError("המצלמה לא נתמכת בדפדפן הזה.");
        return;
      }

      setStartingCamera(true);
      setCameraError("");
      setCameraReady(false);

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;

        if (videoElement) {
          videoElement.srcObject = stream;
          await videoElement.play().catch(() => undefined);
        }
      } catch (error) {
        const message =
          error instanceof Error && error.message
            ? error.message
            : "לא הצלחנו לפתוח את המצלמה. בדקו הרשאה למצלמה ונסו שוב.";
        setCameraError(message);
      } finally {
        if (!cancelled) setStartingCamera(false);
      }
    }

    void startCamera();

    return () => {
      cancelled = true;
      setCameraReady(false);

      if (videoElement) {
        videoElement.pause();
        videoElement.srcObject = null;
      }

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };
  }, [cameraOpen, cameraSession]);

  function handleCapture() {
    const video = videoRef.current;
    if (!video) return;

    const width = video.videoWidth || 1920;
    const height = video.videoHeight || 1080;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) {
      setCameraError("לא הצלחנו לשמור את התמונה. נסו שוב.");
      return;
    }

    context.drawImage(video, 0, 0, width, height);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setCameraError("לא הצלחנו לשמור את התמונה. נסו שוב.");
          return;
        }

        const capturedFile = new File([blob], `camera-${Date.now()}.jpg`, {
          type: "image/jpeg",
          lastModified: Date.now(),
        });

        onFilesSelected(multiple ? [...files, capturedFile] : [capturedFile]);
        setCameraOpen(false);
      },
      "image/jpeg",
      0.95
    );
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        multiple={multiple}
        accept={accept}
        className="hidden"
        onChange={(event) => onFilesSelected(Array.from(event.target.files ?? []))}
      />
      <div className={cn("flex items-center gap-2", className)}>
        <Button
          type="button"
          variant={chooseVariant}
          size={size}
          disabled={disabled}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="h-4 w-4" />
          {chooseLabel}
        </Button>
        {allowCamera ? (
          <Button
            type="button"
            variant={takePhotoVariant}
            size={size}
            disabled={disabled}
            onClick={() => setCameraOpen(true)}
          >
            <Camera className="h-4 w-4" />
            {takePhotoLabel}
          </Button>
        ) : null}
      </div>
      <Dialog open={cameraOpen} onOpenChange={setCameraOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>צילום מתוך המערכת</DialogTitle>
            <DialogDescription>
              התמונה תצולם כאן ותתווסף ישירות להעלאה בלי לצאת מהמערכת.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="overflow-hidden rounded-xl border bg-black">
              <video
                ref={videoRef}
                muted
                playsInline
                autoPlay
                className="aspect-[4/3] w-full object-cover"
                onLoadedMetadata={() => setCameraReady(true)}
              />
            </div>
            {startingCamera ? (
              <div className="text-sm text-muted-foreground">פותח מצלמה...</div>
            ) : null}
            {cameraError ? (
              <div className="text-sm text-destructive">{cameraError}</div>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setCameraOpen(false)}>
              ביטול
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setCameraSession((value) => value + 1)}
              disabled={startingCamera}
            >
              <RefreshCcw className="h-4 w-4" />
              פתח מחדש
            </Button>
            <Button
              type="button"
              onClick={handleCapture}
              disabled={!cameraReady || startingCamera || Boolean(cameraError)}
            >
              <Camera className="h-4 w-4" />
              שמור תמונה
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
