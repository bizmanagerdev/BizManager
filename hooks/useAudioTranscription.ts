"use client";

// Records a short voice clip with MediaRecorder and transcribes it via our own
// /api/transcribe route (OpenAI behind the scenes). Unlike the browser's built-in
// Web Speech API, this routes audio through our backend — so it works on networks
// and content filters that block Google/Microsoft speech endpoints, and on more
// browsers (anything with getUserMedia + MediaRecorder, including iOS Safari).

import { useCallback, useEffect, useRef, useState } from "react";

export type TranscriptionState = "idle" | "recording" | "transcribing";

export type UseAudioTranscriptionOptions = {
  /** ISO-639-1 language hint sent to the transcriber. Defaults to Hebrew. */
  language?: string;
  /** Called with the recognized text. */
  onResult: (text: string) => void;
  /** Called with a ready-to-show Hebrew message on errors. */
  onError?: (message: string) => void;
};

export type UseAudioTranscription = {
  supported: boolean;
  state: TranscriptionState;
  start: () => void;
  stop: () => void;
  toggle: () => void;
};

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return "";
}

function extForMime(mime: string): string {
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("ogg")) return "ogg";
  return "webm";
}

function micErrorMessage(err: unknown): string {
  const name = err && typeof err === "object" ? (err as { name?: string }).name : undefined;
  if (name === "NotAllowedError" || name === "SecurityError")
    return "אין הרשאה למיקרופון. אפשרו גישה בהגדרות הדפדפן ונסו שוב.";
  if (name === "NotFoundError" || name === "OverconstrainedError")
    return "לא נמצא מיקרופון.";
  return "לא ניתן להתחיל הקלטה. נסו שוב.";
}

export function useAudioTranscription({
  language = "he",
  onResult,
  onError,
}: UseAudioTranscriptionOptions): UseAudioTranscription {
  const [supported, setSupported] = useState(false);
  const [state, setState] = useState<TranscriptionState>("idle");

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Latest callbacks without re-creating the recorder.
  const onResultRef = useRef(onResult);
  const onErrorRef = useRef(onError);
  const languageRef = useRef(language);
  onResultRef.current = onResult;
  onErrorRef.current = onError;
  languageRef.current = language;

  useEffect(() => {
    setSupported(
      typeof navigator !== "undefined" &&
        Boolean(navigator.mediaDevices?.getUserMedia) &&
        typeof window !== "undefined" &&
        typeof window.MediaRecorder !== "undefined"
    );
  }, []);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const transcribe = useCallback(async (mime: string) => {
    const blob = new Blob(chunksRef.current, { type: mime || "audio/webm" });
    chunksRef.current = [];
    if (blob.size === 0) {
      setState("idle");
      onErrorRef.current?.("לא נקלט דיבור. נסו שוב.");
      return;
    }
    setState("transcribing");
    try {
      const type = blob.type || mime || "audio/webm";
      const file = new File([blob], `recording.${extForMime(type)}`, { type });
      const form = new FormData();
      form.set("file", file);
      form.set("language", languageRef.current);
      const res = await fetch("/api/transcribe", { method: "POST", body: form });
      const json = (await res.json().catch(() => ({}))) as {
        text?: unknown;
        error?: unknown;
      };
      if (!res.ok) {
        onErrorRef.current?.(
          typeof json.error === "string" ? json.error : "תמלול ההקלטה נכשל. נסו שוב."
        );
        return;
      }
      const text = typeof json.text === "string" ? json.text.trim() : "";
      if (text) onResultRef.current(text);
      else onErrorRef.current?.("לא זוהה דיבור בהקלטה. נסו שוב.");
    } catch {
      onErrorRef.current?.("תמלול ההקלטה נכשל. בדקו את החיבור ונסו שוב.");
    } finally {
      setState("idle");
    }
  }, []);

  const start = useCallback(() => {
    if (recorderRef.current) return;
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof window === "undefined" ||
      typeof window.MediaRecorder === "undefined"
    ) {
      return;
    }
    void navigator.mediaDevices
      .getUserMedia({
        audio: {
          // Boost quiet/far speech and clean it up so you don't have to shout.
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      .then((stream) => {
        streamRef.current = stream;
        const mime = pickMimeType();
        const recorder = mime
          ? new MediaRecorder(stream, { mimeType: mime })
          : new MediaRecorder(stream);
        chunksRef.current = [];
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) chunksRef.current.push(event.data);
        };
        recorder.onstop = () => {
          releaseStream();
          recorderRef.current = null;
          void transcribe(recorder.mimeType || mime);
        };
        recorderRef.current = recorder;
        recorder.start();
        setState("recording");
      })
      .catch((err) => {
        releaseStream();
        recorderRef.current = null;
        setState("idle");
        onErrorRef.current?.(micErrorMessage(err));
      });
  }, [releaseStream, transcribe]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }, []);

  const toggle = useCallback(() => {
    if (recorderRef.current) stop();
    else start();
  }, [start, stop]);

  useEffect(() => {
    return () => {
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
      releaseStream();
      recorderRef.current = null;
    };
  }, [releaseStream]);

  return { supported, state, start, stop, toggle };
}
