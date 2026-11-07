"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { HearingTranscript } from "@/components/HearingTranscript";
import { useBackgroundHearing, type HearingState } from "@/lib/useBackgroundHearing";
import { useLiveBrowserHearing } from "@/lib/useLiveBrowserHearing";
import { useSampleHearing } from "@/lib/useSampleHearing";
import { useVoice } from "@/lib/useVoice";
import type { CaseEntry, Transcript } from "@/lib/types";
import { RightRail } from "./RightRail";
import { StatusBanner } from "./StatusBanner";

/** Durable hearing: runs on the server (SQLite) and keeps going without this page. Local use only. */
export function Hearing({
  entry,
  onBack,
  hearingId = null,
}: {
  entry: CaseEntry;
  onBack: () => void;
  /** Set when reopening an existing hearing from its link. */
  hearingId?: string | null;
}) {
  const pb = useBackgroundHearing(entry, hearingId);
  return <HearingRoom entry={entry} onBack={onBack} pb={pb} />;
}

/** Sample hearing played entirely in this browser: no server, no database, nothing recorded. */
export function SampleHearing({ entry, onBack, onSwitch }: { entry: CaseEntry; onBack: () => void; onSwitch?: () => void }) {
  const pb = useSampleHearing(entry);
  return <HearingRoom entry={entry} onBack={onBack} pb={pb} onSwitch={onSwitch} />;
}

/** Live hearing on Groq's free tier, driven step by step from this browser. Nothing is stored. */
export function LiveHearing({ entry, onBack, onSwitch }: { entry: CaseEntry; onBack: () => void; onSwitch?: () => void }) {
  const [inviteCode, setInviteCode] = useState("");
  const pb = useLiveBrowserHearing(entry, inviteCode);
  return <HearingRoom entry={entry} onBack={onBack} pb={pb} onSwitch={onSwitch}
    invite={{ value: inviteCode, onChange: setInviteCode }} />;
}

function HearingRoom({
  entry,
  onBack,
  pb,
  onSwitch,
  invite,
}: {
  entry: CaseEntry;
  onBack: () => void;
  pb: HearingState;
  /** Offered on the intro screen: switch between sample replay and a live hearing. */
  onSwitch?: () => void;
  invite?: { value: string; onChange: (value: string) => void };
}) {
  const transcript: Transcript = entry.transcript;
  const cf = transcript.case;

  const voice = useVoice();
  const [listen, setListen] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);

  // Listen: read newly arrived turns aloud, one after another.
  const spoken = useRef<Set<string>>(new Set());
  const speaking = useRef(false);
  const [voiceTick, setVoiceTick] = useState(0);
  useEffect(() => {
    if (!listen || speaking.current) return;
    const next = pb.turns.find((t) => !spoken.current.has(t.id));
    if (!next) return;
    speaking.current = true;
    spoken.current.add(next.id);
    voice
      .speak(next)
      .catch(() => {})
      .finally(() => {
        speaking.current = false;
        setVoiceTick((n) => n + 1);
      });
  }, [listen, pb.turns, voiceTick, voice]);

  const revealed = pb.turns;
  const current = revealed.length ? revealed[revealed.length - 1] : null;
  const activeRefs = new Set([...(current?.evidenceRefs ?? []), focus].filter(Boolean) as string[]);

  const toggleListen = () => {
    const next = !listen;
    setListen(next);
    if (!next) {
      voice.stop();
      speaking.current = false;
    }
  };

  const back = () => {
    voice.reset();
    speaking.current = false;
    pb.restart();
    setFocus(null);
    if (pb.backend === "server") window.history.replaceState(null, "", "/chamber");
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
            {pb.mode && (
              <span className="mono ml-1 flex items-center gap-1.5 text-[10px] text-cbrass">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--c-brass)" }} />
                {pb.live ? "live" : "sample"}
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

      <StatusBanner pb={pb} onNewHearing={back} />

      <div className="grid min-h-0 gap-0 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* main column */}
        <main className="flex min-h-0 flex-col border-cinkline lg:border-r">
          {pb.notFound ? (
            <Message title="Hearing not found." body="This link does not match a hearing on this server." action={{ label: "Back to cases", onClick: back }} />
          ) : pb.loading ? (
            <Message title="Loading the hearing…" body="" />
          ) : pb.phase === "idle" ? (
            <Intro
              onStart={pb.start}
              invite={invite}
              starting={pb.starting}
              error={pb.startError}
              backend={pb.backend}
              live={pb.live}
              onSwitch={onSwitch}
            />
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
                  live={pb.live}
                  engines={pb.engines}
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

function Message({ title, body, action }: { title: string; body: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center px-6 py-20 text-center">
      <div className="display text-2xl text-cchalk">{title}</div>
      {body && <p className="mt-3 text-[15px] leading-relaxed text-cchalkdim">{body}</p>}
      {action && (
        <button onClick={action.onClick} className="btn btn-brass mt-7">
          {action.label}
        </button>
      )}
    </div>
  );
}

function Intro({
  onStart,
  starting,
  error,
  backend,
  live,
  onSwitch,
  invite,
}: {
  onStart: () => void;
  starting: boolean;
  error: string | null;
  backend: "server" | "browser";
  live: boolean;
  onSwitch?: () => void;
  invite?: { value: string; onChange: (value: string) => void };
}) {
  const text =
    backend === "server"
      ? "Convene the tribunal and hear both sides argue from the record. This sample hearing runs on the server, so you can leave and come back to it. You deliver the ruling."
      : live
        ? "Invited live preview: four roles discuss this synthetic case using one model on Groq's free tier. Quota limits pause the hearing. Sessions last one hour; leaving or reloading ends the hearing. You deliver the ruling."
        : "Replay a sample hearing: both sides argue from the record in pre-written turns, played in your browser. Nothing is sent or saved. You deliver the ruling.";
  return (
    <div className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center px-6 py-20 text-center">
      <div className="display text-3xl text-cchalk">A claim was denied.</div>
      <p className="mt-3 text-[15px] leading-relaxed text-cchalkdim">{text}</p>
      <form onSubmit={(event) => { event.preventDefault(); onStart(); }} className="mt-7 flex w-full flex-col items-center gap-4">
      {invite && (
        <div className="w-full text-left">
          <label htmlFor="live-invite" className="block text-sm text-cchalk">Tester invite code</label>
          <input id="live-invite" type="password" autoComplete="off" required maxLength={256}
            value={invite.value} onChange={(event) => invite.onChange(event.target.value)} disabled={starting}
            aria-describedby={error ? "live-invite-help hearing-start-error" : "live-invite-help"} aria-invalid={!!error}
            className="mt-2 w-full rounded-sm border border-cinkline bg-cink2 px-3 py-3 text-base text-cchalk caret-cbrass focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cbrass" />
          <p id="live-invite-help" className="mt-2 text-sm text-cchalkdim">Use the code shared by the demo owner, not a provider API key.</p>
        </div>
      )}
      <button type="submit" disabled={starting || (!!invite && !invite.value.trim())} className="btn btn-brass disabled:opacity-50">
        {starting ? "Convening…" : live ? "Convene a live hearing" : "Convene the tribunal"}
      </button>
      </form>
      {onSwitch && (
        <button onClick={onSwitch} className="btn btn-line-ink mt-3 !px-3 !py-1.5 !text-[12px]">
          {live ? "Replay the sample instead" : "Run a live hearing instead (Groq free tier)"}
        </button>
      )}
      {error && <p id="hearing-start-error" role="alert" className="mt-4 text-sm text-cchalk">{error}</p>}
    </div>
  );
}

function Transport({ pb }: { pb: HearingState }) {
  const status =
    pb.phase === "verdict"
      ? "ruled"
      : pb.status === "complete"
        ? "deliberation complete"
        : pb.status === "paused"
          ? "paused"
          : pb.status === "partial"
            ? "partial · not a complete record"
            : pb.status === "failed"
              ? "failed"
              : pb.status === "waiting"
                ? "queued"
                : "in session";
  const moving = pb.status === "running";
  return (
    <div className="flex items-center gap-4 border-t border-cinkline px-6 py-4">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: moving ? "var(--c-brass)" : "var(--c-ink-line)" }} />
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
