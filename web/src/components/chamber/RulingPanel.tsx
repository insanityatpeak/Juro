import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { HearingState } from "@/lib/useLiveHearing";
import type { Transcript } from "@/lib/types";

export function RulingPanel({
  transcript,
  pb,
}: {
  transcript: Transcript;
  pb: HearingState;
}) {
  const [choice, setChoice] = useState<"OVERTURNED" | "UPHELD" | "REMANDED">("OVERTURNED");
  const ruled = pb.phase === "verdict";
  const ready = pb.phase === "ready";
  const v = pb.verdict;

  return (
    <section>
      <div className="keb mb-3 text-cchalkdim">Your ruling</div>

      {!ready && !ruled && (
        <p className="rounded-sm border border-cinkline bg-cink2 px-3 py-3 text-[12.5px] leading-relaxed text-cchalkdim">
          Hear both sides through. The ruling unlocks once deliberation is complete.
        </p>
      )}

      {ready && (
        <div className="flex flex-col gap-3 rounded-sm border border-cinkline bg-cink2 p-3">
          <div className="grid grid-cols-3 gap-1.5">
            {(["OVERTURNED", "UPHELD", "REMANDED"] as const).map((c) => (
              <button
                key={c}
                onClick={() => setChoice(c)}
                className="rounded-sm border px-2 py-2 text-[12px] transition-colors"
                style={{
                  borderColor: choice === c ? "var(--c-brass)" : "var(--c-ink-line)",
                  color: choice === c ? "var(--c-chalk)" : "var(--c-chalk-dim)",
                  background: choice === c ? "var(--c-ink)" : "transparent",
                }}
              >
                {c === "OVERTURNED" ? "Overturn" : c === "UPHELD" ? "Uphold" : "Remand"}
              </button>
            ))}
          </div>
          <button onClick={() => pb.deliverVerdict(choice)} className="btn btn-brass !py-2.5 !text-[13px]">
            Seal ruling and draft appeal
          </button>
        </div>
      )}

      {ruled && (
        <div className="flex flex-col gap-4">
          <div className="rounded-sm border border-cinkline bg-cink2 p-4">
            <div
              className="display text-2xl"
              style={{ color: v.decision === "UPHELD" ? "var(--c-oxblood)" : "var(--c-brass)" }}
            >
              {v.decision}
            </div>
            <p className="mt-2 text-[13px] leading-relaxed text-cchalkdim">{v.rationale}</p>
            <div className="mono mt-3 text-[10px] text-cslate">
              {v.by} · sealed to audit · {pb.auditRoot ?? transcript.auditRoot}
            </div>
          </div>

          <AnimatePresence>
            {transcript.appealLetter && <AppealLetter text={transcript.appealLetter} />}
          </AnimatePresence>
        </div>
      )}
    </section>
  );
}

function AppealLetter({ text }: { text: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15 }}
      className="overflow-hidden rounded-sm border border-cinkline"
    >
      <div className="flex items-center justify-between border-b border-cinkline bg-cink2 px-3 py-2">
        <span className="keb !text-[9px] text-cchalkdim">Drafted appeal</span>
        <span className="keb !text-[9px]" style={{ color: "var(--c-brass)" }}>
          ready
        </span>
      </div>
      <div className="bg-cpaper px-4 py-4">
        <pre
          className="whitespace-pre-wrap text-[11.5px] leading-relaxed text-[#1a1d23]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {text}
        </pre>
      </div>
      <div className="flex gap-2 border-t border-cinkline bg-cink2 px-3 py-2">
        <button disabled title="Not yet available" className="btn btn-line-ink !px-3 !py-1.5 !text-[11px] opacity-50">
          Export PDF
        </button>
        <button disabled title="Not yet available" className="btn btn-brass !px-3 !py-1.5 !text-[11px] opacity-50">
          Send to insurer
        </button>
      </div>
    </motion.div>
  );
}
