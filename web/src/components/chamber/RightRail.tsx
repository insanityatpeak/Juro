import type { EvidenceItem, Transcript } from "@/lib/types";
import type { HearingState } from "@/lib/useLiveHearing";
import { RulingPanel } from "./RulingPanel";

export function RightRail({
  transcript,
  activeRefs,
  focus,
  onFocus,
  pb,
}: {
  transcript: Transcript;
  activeRefs: Set<string>;
  focus: string | null;
  onFocus: (id: string | null) => void;
  pb: HearingState;
}) {
  const statutes = transcript.evidence.filter((e) => e.kind === "statute");
  const records = transcript.evidence.filter((e) => e.kind !== "statute");

  return (
    <div className="flex flex-col gap-7">
      <section>
        <div className="keb mb-3 text-cchalkdim">Authority & evidence</div>
        <div className="flex flex-col gap-2">
          {statutes.map((e) => (
            <StatuteCard
              key={e.id}
              e={e}
              hot={activeRefs.has(e.id) || focus === e.id}
              onClick={() => onFocus(e.id)}
            />
          ))}
          {records.map((e) => (
            <RecordCard
              key={e.id}
              e={e}
              hot={activeRefs.has(e.id) || focus === e.id}
              onClick={() => onFocus(e.id)}
            />
          ))}
        </div>
      </section>

      <RulingPanel transcript={transcript} pb={pb} />
    </div>
  );
}

function StatuteCard({ e, hot, onClick }: { e: EvidenceItem; hot: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-sm border bg-cink2 px-3 py-2.5 text-left transition-colors"
      style={{ borderColor: hot ? "var(--c-brass)" : "var(--c-ink-line)" }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12.5px] font-medium text-cchalk">{e.label}</span>
        <span className="mono shrink-0 text-[10px] text-cbrass">{e.cite}</span>
      </div>
      {e.authority && (
        <p className="mt-1 text-[11.5px] leading-snug text-cchalkdim">{e.authority}</p>
      )}
    </button>
  );
}

function RecordCard({ e, hot, onClick }: { e: EvidenceItem; hot: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-sm border bg-cink2 px-3 py-2 text-left transition-colors"
      style={{ borderColor: hot ? "var(--c-brass)" : "var(--c-ink-line)" }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="mono text-[10px] text-cchalkdim">{e.id}</span>
        <span className="keb !text-[9px] !tracking-[0.14em] text-cslate">{e.kind}</span>
      </div>
      <div className="mt-0.5 text-[12.5px] text-cchalk">{e.label}</div>
      {e.detail && <div className="mt-0.5 text-[11.5px] leading-snug text-cchalkdim">{e.detail}</div>}
      <div className="mono mt-1 text-[10px] text-cslate">{e.cite}</div>
    </button>
  );
}
