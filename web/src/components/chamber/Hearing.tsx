"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { HearingTranscript } from "@/components/HearingTranscript";
import { useLiveHearing, type HearingState } from "@/lib/useLiveHearing";
import { useVoice } from "@/lib/useVoice";
import type { CaseEntry, Transcript } from "@/lib/types";
import { RightRail } from "./RightRail";

export function Hearing({ entry, onBack }: { entry: CaseEntry; onBack: () => void }) {
  const transcript: Transcript = entry.transcript;
  const cf = transcript.case;

  const voice = useVoice();
  const [listen, setListen] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);

  // The player (useLiveHearing) drives the voice: it reveals a turn and waits for
  // its audio to finish before the next, so reply and speech stay in lockstep.
  // A ref lets the player read the *current* Listen state without re-subscribing.
  const listenRef = useRef(listen);
  useEffect(() => {
    listenRef.current = listen;
  }, [listen]);
  const pb = useLiveHearing(entry, {
    speak: voice.speak,
    isListening: () => listenRef.current,
    prefetch: (t) => voice.prime([t]),
    ready: voice.ready,
  });

  const revealed = pb.turns;
  const current = revealed.length ? revealed[revealed.length - 1] : null;
  const activeRefs = new Set([...(current?.evidenceRefs ?? []), focus].filter(Boolean) as string[]);

  const toggleListen = () => {
    const next = !listen;
    setListen(next);
    if (!next) voice.stop();
  };

  const back = () => {
    voice.reset();
    pb.restart();
    setFocus(null);
    onBack();
  };

  return (
    <section className="grain-ink relative min-h-dvh bg-cink text-cchalk">
      {/* header */}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-cinkline px-6 py-4">
        <button onClick={back} className="btn btn-line-ink !px-3 !py-1.5 !text-[12px]">
          ← All cases
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="mono text-[12px] text-cchalkdim">{cf.claimId}</span>
            <span className="text-[14px] text-cchalk">{cf.patient}</span>
            <span className="text-cslate">·</span>
            <span className="text-[14px] text-cchalkdim">{cf.procedure}</span>
            {pb.live && pb.phase !== "idle" && (
              <span className="mono ml-1 flex items-center gap-1.5 text-[10px] text-cbrass">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--c-brass)" }} /> live
              </span>
            )}
          </div>
          <div className="mt-0.5 text-[13px] text-coxblood">Denied: {cf.denialReason}</div>
        </div>
        <button
          onClick={toggleListen}
          className={listen ? "btn btn-brass !px-3 !py-1.5 !text-[12px]" : "btn btn-line-ink !px-3 !py-1.5 !text-[12px]"}
        >
          {listen ? "Listening" : "Listen"}
        </button>
      </header>

      <div className="grid min-h-0 gap-0 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* main column */}
        <main className="flex min-h-0 flex-col border-cinkline lg:border-r">
          {pb.phase === "idle" ? (
            <Intro onStart={pb.start} />
          ) : (
            <>
              <div className="scroll-fade min-h-0 flex-1 overflow-y-auto px-6 py-6">
                <HearingTranscript
                  turns={revealed}
                  all={revealed}
                  activeId={pb.activeId}
                  thinkingAgent={pb.thinkingAgent}
                  onCite={(id) => setFocus(id)}
                  showBench
                />
              </div>
              <Transport pb={pb} />
            </>
          )}
        </main>

        {/* right rail */}
        <aside className="scroll-fade min-h-0 overflow-y-auto px-5 py-6">
          <RightRail
            transcript={transcript}
            activeRefs={activeRefs}
            focus={focus}
            onFocus={setFocus}
            pb={pb}
          />
        </aside>
      </div>
    </section>
  );
}

function Intro({ onStart }: { onStart: () => void }) {
  return (
    <div className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center px-6 py-20 text-center">
      <div className="display text-3xl text-cchalk">A claim was denied.</div>
      <p className="mt-3 text-[15px] leading-relaxed text-cchalkdim">
        Convene the tribunal and hear both sides argue from the record. You deliver the ruling.
      </p>
      <button onClick={onStart} className="btn btn-brass mt-7">
        Convene the tribunal
      </button>
    </div>
  );
}

function Transport({ pb }: { pb: HearingState }) {
  const status =
    pb.phase === "ready"
      ? "deliberation complete"
      : pb.phase === "verdict"
        ? "ruled"
        : pb.live
          ? "in session · live"
          : "in session";
  return (
    <div className="flex items-center gap-4 border-t border-cinkline px-6 py-4">
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ background: pb.phase === "debate" ? "var(--c-brass)" : "var(--c-ink-line)" }}
      />
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-cink2">
        <motion.div
          className="h-full bg-cbrass"
          animate={{ width: `${Math.round(pb.progress * 100)}%` }}
          transition={{ ease: "linear" }}
        />
      </div>
      <span className="keb shrink-0 text-cchalkdim">{status}</span>
    </div>
  );
}
