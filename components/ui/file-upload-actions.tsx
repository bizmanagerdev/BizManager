"use client";

/* eslint-disable @next/next/no-img-element */

import { Camera, FileText, RefreshCcw, Upload, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { compressImageFiles } from "@/lib/images";
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
  /** Show thumbnails / file chips for the currently selected files. Default: true. */
  showPreview?: boolean;
  /** Show a toast when files are added (chosen or captured). Default: true. */
  notifyOnAdd?: boolean;
  /** Downscale large images before handing them back, so uploads stay fast. Default: true. */
  compressImages?: boolean;
};

type FilePreview = { file: File; url: string | null };

function announceAdded(added: File[], fromCamera: boolean) {
  if (added.length === 0) return;
  if (fromCamera) {
    toast.success("התמונה צולמה ונוספה");
    return;
  }
  if (added.length === 1) {
    const isImage = added[0].type.startsWith("image/");
    toast.success(isImage ? "התמונה נוספה" : "הקובץ נוסף");
    return;
  }
  toast.success(`${added.length} קבצים נוספו`);
}

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
  showPreview = true,
  notifyOnAdd = true,
  compressImages = true,
}: FileUploadActionsProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string>("");
  const [cameraReady, setCameraReady] = useState(false);
  const [startingCamera, setStartingCamera] = useState(false);
  const [cameraSession, setCameraSession] = useState(0);
  const [previews, setPreviews] = useState<FilePreview[]>([]);

  useEffect(() => {
    if (files.length > 0) return;
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [files]);

  // Build (and clean up) object URLs so selected images can be previewed.
  useEffect(() => {
    const next: FilePreview[] = files.map((file) => ({
      file,
      url: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
    }));
    setPreviews(next);

    return () => {
      next.forEach((preview) => {
        if (preview.url) URL.revokeObjectURL(preview.url);
      });
    };
  }, [files]);

  // Attach the live stream to the <video> as soon as BOTH the element is
  // mounted and the stream is ready — regardless of which happens first.
  // (Radix portals the dialog content, so the element often mounts after the
  // stream resolves; relying on a single read of videoRef caused a blank feed
  // until the user pressed "refresh".)
  const attachVideo = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;
    if (node && streamRef.current) {
      node.srcObject = streamRef.current;
      void node.play().catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    if (!cameraOpen) return;

    let cancelled = false;

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

        const node = videoRef.current;
        if (node) {
          node.srcObject = stream;
          await node.play().catch(() => undefined);
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

      const node = videoRef.current;
      if (node) {
        node.pause();
        node.srcObject = null;
      }

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };
  }, [cameraOpen, cameraSession]);

  async function handleFilesChosen(chosen: File[]) {
    const prepared = compressImages && chosen.length > 0 ? await compressImageFiles(chosen) : chosen;
    onFilesSelected(prepared);
    if (notifyOnAdd && prepared.length > 0) announceAdded(prepared, false);
  }

  function removeFile(index: number) {
    onFilesSelected(files.filter((_, fileIndex) => fileIndex !== index));
  }

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
        if (notifyOnAdd) announceAdded([capturedFile], true);
        setCameraOpen(false);
      },
      "image/jpeg",
      0.85
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
        onChange={(event) => void handleFilesChosen(Array.from(event.target.files ?? []))}
      />
      <div className={cn("flex flex-wrap items-center gap-2", className)}>
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
      {showPreview && previews.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {previews.map((preview, index) => (
            <div
              key={`${preview.file.name}-${preview.file.size}-${index}`}
              className="relative w-24"
            >
              <div className="relative h-24 w-24 overflow-hidden rounded-lg border bg-muted/40">
                {preview.url ? (
                  <img
                    src={preview.url}
                    alt={preview.file.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-1 px-1 text-center text-muted-foreground">
                    <FileText className="h-7 w-7" />
                    <span className="text-[10px]">קובץ</span>
                  </div>
                )}
                {!disabled ? (
                  <button
                    type="button"
                    onClick={() => removeFile(index)}
                    aria-label="הסר קובץ"
                    className="absolute left-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-foreground/70 text-background transition hover:bg-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                ) : null}
              </div>
              <div className="mt-1 truncate text-[11px] text-muted-foreground" title={preview.file.name}>
                {preview.file.name}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <Dialog open={cameraOpen} onOpenChange={setCameraOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>צילום מתוך המערכת</DialogTitle>
            <DialogDescription>
              התמונה תצולם כאן ותתווסף ישירות להעלאה בלי לצאת מהמערכת.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="overflow-hidden rounded-xl border bg-primary-1">
              <video
                ref={attachVideo}
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
