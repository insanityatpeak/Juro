"use client";

import { useCallback, useEffect, useRef } from "react";
import type { Faction, Turn } from "@/lib/types";

/**
 * Read turns aloud with the browser's built-in speech synthesis (free, no server call).
 * Each faction gets a slightly different pitch/rate so the seats are distinguishable.
 * If the browser has no speech synthesis, `speak` resolves immediately and nothing plays.
 */
const VOICE_STYLE: Record<Faction, { pitch: number; rate: number }> = {
  adjudicator: { pitch: 0.8, rate: 0.95 },
  advocate: { pitch: 1.1, rate: 1.02 },
  scrutinizer: { pitch: 0.95, rate: 1.05 },
  evidence: { pitch: 1.0, rate: 1.0 },
  human: { pitch: 1.0, rate: 1.0 },
};

const synth = () => (typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null);

export function useVoice() {
  // Bumped on stop/reset so a pending speak() never starts after Listen was turned off.
  const generation = useRef(0);

  const stop = useCallback(() => {
    generation.current++;
    synth()?.cancel();
  }, []);

  /** Speak a turn and resolve when it finishes (or is stopped). */
  const speak = useCallback(
    (turn: Turn) =>
      new Promise<void>((resolve) => {
        const s = synth();
        if (!s) return resolve();
        const mine = generation.current;
        s.cancel();
        if (mine !== generation.current) return resolve();
        const u = new SpeechSynthesisUtterance(turn.text);
        const style = VOICE_STYLE[turn.agent] ?? VOICE_STYLE.evidence;
        u.pitch = style.pitch;
        u.rate = style.rate;
        u.onend = () => resolve();
        u.onerror = () => resolve();
        s.speak(u);
      }),
    [],
  );

  const reset = stop;

  // Stop speaking when the component goes away (navigation, tab close).
  useEffect(() => stop, [stop]);

  return { speak, stop, reset };
}
