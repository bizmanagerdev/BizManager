"use client";

import { useState } from "react";
import { Loader2, Square, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAudioTranscription } from "@/hooks/useAudioTranscription";
import { toHebrewError } from "@/lib/error-messages";
import { cn } from "@/lib/utils";

export type ParsedTaskFields = {
  subject: string;
  description: string;
  due_date: string;
  due_time: string;
  priority: string;
  business_domain: string;
  assigned_user_id: string;
  city: string;
};

type Props = {
  users: { id: string; label: string }[];
  domains: { code: string; label: string }[];
  onParsed: (fields: ParsedTaskFields) => void;
  disabled?: boolean;
  className?: string;
};

// Record the whole task by voice, transcribe it, then let Claude extract the
// structured fields and pre-fill the card. Records → transcribes → "ממלא..." → done.
export function TaskVoiceFillButton({ users, domains, onParsed, disabled = false, className }: Props) {
  const [parsing, setParsing] = useState(false);

  async function parse(transcript: string) {
    setParsing(true);
    try {
      const now = new Date();
      const nowLabel = now.toLocaleString("he-IL", { dateStyle: "full", timeStyle: "short" });
      const pad = (n: number) => String(n).padStart(2, "0");
      const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      const res = await fetch("/api/tasks/parse-voice", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transcript, users, domains, today, nowLabel }),
      });
      const json = (await res.json().catch(() => ({}))) as { task?: ParsedTaskFields; error?: unknown };
      if (!res.ok) {
        toast.error(typeof json?.error === "string" ? json.error : "מילוי המשימה נכשל. נסו שוב.");
        return;
      }
      if (json?.task) {
        onParsed(json.task);
        toast.success("המשימה מולאה מהדיבור");
      }
    } catch (err) {
      toast.error(toHebrewError(err, "מילוי המשימה נכשל."));
    } finally {
      setParsing(false);
    }
  }

  const { supported, state, toggle } = useAudioTranscription({
    onResult: (text) => void parse(text),
    onError: (message) => toast.error(message),
  });

  if (!supported) return null;

  const recording = state === "recording";
  const busy = state === "transcribing" || parsing;

  return (
    <Button
      type="button"
      variant={recording ? "destructive" : "secondary"}
      size="sm"
      disabled={disabled || busy}
      onClick={toggle}
      title="הקלטת כל פרטי המשימה ומילוי הכרטיס אוטומטית"
      className={cn(recording && "animate-pulse", className)}
    >
      {busy ? <Loader2 className="animate-spin" /> : recording ? <Square /> : <Wand2 />}
      {recording ? "עצירה ומילוי" : busy ? "ממלא..." : "מילוי בדיבור"}
    </Button>
  );
}
