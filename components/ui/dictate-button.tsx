"use client";

import { Loader2, Mic, Square } from "lucide-react";
import { toast } from "sonner";
import { Button, type ButtonProps } from "@/components/ui/button";
import { useAudioTranscription } from "@/hooks/useAudioTranscription";
import { cn } from "@/lib/utils";

type DictateButtonProps = {
  /** Receives the recognized Hebrew text. The caller decides append vs replace. */
  onTranscript: (text: string) => void;
  /** ISO-639-1 language hint. Defaults to Hebrew. */
  language?: string;
  disabled?: boolean;
  size?: Extract<ButtonProps["size"], "icon" | "icon-sm">;
  title?: string;
  className?: string;
};

// A mic toggle that records speech and transcribes it (server-side) into any text
// field. Records → "ממיר..." while transcribing → text. Auto-hides on browsers
// without microphone recording support.
export function DictateButton({
  onTranscript,
  language,
  disabled = false,
  size = "icon-sm",
  title = "הכתבה קולית",
  className,
}: DictateButtonProps) {
  const { supported, state, toggle } = useAudioTranscription({
    language,
    onResult: (text) => {
      onTranscript(text);
      toast.success("הטקסט נוסף");
    },
    onError: (message) => toast.error(message),
  });

  if (!supported) return null;

  const recording = state === "recording";
  const busy = state === "transcribing";

  return (
    <Button
      type="button"
      variant={recording ? "destructive" : "outline"}
      size={size}
      disabled={disabled || busy}
      onClick={toggle}
      aria-label={recording ? "עצירת הקלטה" : busy ? "ממיר הקלטה" : title}
      title={recording ? "עצירת הקלטה" : busy ? "ממיר הקלטה לטקסט" : title}
      className={cn(recording && "animate-pulse", className)}
    >
      {busy ? <Loader2 className="animate-spin" /> : recording ? <Square /> : <Mic />}
    </Button>
  );
}
