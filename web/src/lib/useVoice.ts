"use client";

import { useCallback, useRef } from "react";
import type { Turn } from "@/lib/types";

/**
 * Deepgram Aura-2 playback with pre-fetch.
 *
 * The old version fetched each turn's audio the moment it became active, so the
 * line appeared and then you waited a few seconds for the voice. Now `prime()`
 * kicks off every turn's request up front (in parallel) and caches the promise,
 * so `speak()` plays from cache and the voice lands with the text.
 */
export function useVoice() {
  const cache = useRef<Map<string, Promise<string>>>(new Map());
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const fetchAudio = useCallback((turn: Turn) => {
    const existing = cache.current.get(turn.id);
    if (existing) return existing;
    const p = fetch("/api/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: turn.text, agent: turn.agent }),
    })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.blob();
      })
      .then((b) => URL.createObjectURL(b));
    cache.current.set(turn.id, p);
    p.catch(() => cache.current.delete(turn.id)); // let a later attempt retry
    return p;
  }, []);

  /** Warm the cache for a whole hearing. Call when the case loads / Listen turns on. */
  const prime = useCallback(
    (turns: Turn[]) => {
      turns.forEach((t) => void fetchAudio(t));
    },
    [fetchAudio],
  );

  /** Resolve once a turn's audio is downloaded (so the line and the voice land together). */
  const ready = useCallback((turn: Turn) => fetchAudio(turn).then(() => undefined).catch(() => undefined), [fetchAudio]);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
  }, []);

  /** Play a turn (from cache if primed) and resolve when it finishes. */
  const speak = useCallback(
    (turn: Turn) =>
      new Promise<void>((resolve, reject) => {
        fetchAudio(turn)
          .then((url) => {
            stop();
            const a = new Audio(url);
            audioRef.current = a;
            a.onended = () => resolve();
            a.onerror = () => reject(new Error("audio"));
            void a.play().catch(() => reject(new Error("autoplay")));
          })
          .catch(reject);
      }),
    [fetchAudio, stop],
  );

  /** Drop cached audio (e.g. when switching cases). */
  const reset = useCallback(() => {
    stop();
    cache.current.forEach((p) => p.then((u) => URL.revokeObjectURL(u)).catch(() => {}));
    cache.current.clear();
  }, [stop]);

  return { speak, prime, ready, stop, reset };
}
