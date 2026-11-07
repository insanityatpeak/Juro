import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { HearingState } from "@/lib/useBackgroundHearing";
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
          {pb.status === "partial" || pb.status === "failed" || pb.status === "paused"
            ? `Ruling locked. This hearing is ${pb.status}, so it is not a complete record. Continue it from the banner above; the ruling unlocks only once every turn is on the record.`
            : "Hear both sides through. The ruling unlocks once deliberation is complete."}
        </p>
      )}

      {ready && !pb.canControl && (
        <p className="rounded-sm border border-cinkline bg-cink2 px-3 py-3 text-[12.5px] leading-relaxed text-cchalkdim">
          {pb.controllable
            ? "View only. The ruling can be delivered from the browser that started this hearing."
            : "Read-only. This hearing was created before access control, so no ruling can be recorded. Start a new hearing to rule."}
        </p>
      )}

      {ready && pb.canControl && (
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
            {pb.backend === "browser" ? "Deliver sample ruling" : "Record ruling"}
          </button>
          {pb.rulingError && <p className="text-[12px] text-coxblood">{pb.rulingError}</p>}
        </div>
      )}

      {ruled && pb.humanDecision && (
        <div className="flex flex-col gap-4">
          <div className="rounded-sm border border-cinkline bg-cink2 p-4">
            <div className="keb !text-[9px] text-cchalkdim">Your ruling</div>
            <div
              className="display mt-1 text-2xl"
              style={{ color: pb.humanDecision === "UPHELD" ? "var(--c-oxblood)" : "var(--c-brass)" }}
            >
              {pb.humanDecision}
            </div>
            <div className="mono mt-2 text-[10px] leading-relaxed text-cslate">
              {pb.backend === "browser"
                ? "sample · kept in this browser only · not recorded or sealed"
                : `recorded from the browser that started this hearing · reviewer identity not verified${pb.auditRoot ? ` · transcript chain ${pb.auditRoot}` : ""}`}
            </div>
          </div>

          {/* The AI recommendation stays a separate record from the reviewer's ruling. */}
          <div className="rounded-sm border border-cinkline px-4 py-3">
            <div className="keb !text-[9px] text-cchalkdim">
              {pb.live ? "AI recommendation" : "Sample recommendation (pre-written)"} · {v.decision}
            </div>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-cchalkdim">{v.rationale}</p>
          </div>

          <AnimatePresence>
            {/* The bundled letter argues for overturning; only show it when that matches the ruling. */}
            {transcript.appealLetter && pb.humanDecision === "OVERTURNED" && <AppealLetter text={transcript.appealLetter} />}
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
        <span className="keb !text-[9px] text-cchalkdim">Sample appeal letter (pre-written)</span>
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
