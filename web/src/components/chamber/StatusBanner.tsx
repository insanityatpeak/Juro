"use client";

import { useState } from "react";
import type { HearingState } from "@/lib/useBackgroundHearing";

/** Tells the reviewer exactly where the hearing stands and what they can do next. */
export function StatusBanner({ pb, onNewHearing }: { pb: HearingState; onNewHearing: () => void }) {
  const [copied, setCopied] = useState(false);
  if (!pb.status) return null;
  if (pb.backend === "browser") return <BrowserBanner pb={pb} />;
  if (!pb.hearingId) return null;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/chamber/${pb.hearingId}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard can be blocked; the address bar still has the link */
    }
  };

  const where = `${pb.turnCount} of ${pb.totalTurns} turns`;
  let tone = "var(--c-brass)";
  let title = "";
  let detail = "";
  let action: { label: string; onClick: () => void } | null = null;
  let showLink = false;

  switch (pb.status) {
    case "waiting":
      title = "Queued";
      detail = "The hearing starts in a moment. It runs on the server, so you can close this page.";
      showLink = true;
      break;
    case "running":
      if (pb.pauseRequested) {
        title = `Pausing… · ${where}`;
        detail =
          "The current step will finish and be saved, then the hearing pauses before the next one." +
          (pb.live ? " The current request may finish and incur a charge." : "");
        action = { label: "Keep going", onClick: pb.resume };
      } else {
        title = `In session · ${where}`;
        detail =
          pb.attempt > 0
            ? `Temporary problem${pb.error?.message ? `: ${pb.error.message}` : ""}. Retrying (attempt ${pb.attempt + 1}).`
            : "Running on the server. You can close this page and come back with the link.";
        action = { label: "Pause", onClick: pb.pause };
      }
      showLink = true;
      break;
    case "paused":
      title = pb.pauseReason === "reviewer" ? `Paused by you · ${where}` : `Paused by the system · ${where}`;
      detail = [pb.error?.message, pb.error?.nextAction].filter(Boolean).join(" ") || "Resume to continue from the next turn.";
      action = { label: "Resume", onClick: pb.resume };
      showLink = true;
      break;
    case "partial":
      tone = "var(--c-oxblood)";
      title = `Partial hearing · ${where}`;
      detail = `${[pb.error?.message, pb.error?.nextAction].filter(Boolean).join(" ")} This is not a complete record and cannot be ruled on.`;
      action = { label: "Retry", onClick: pb.retry };
      showLink = true;
      break;
    case "failed":
      tone = "var(--c-oxblood)";
      title = "Hearing failed";
      detail = [pb.error?.message, pb.error?.nextAction].filter(Boolean).join(" ");
      action = { label: "Retry", onClick: pb.retry };
      showLink = true;
      break;
    case "complete":
      return pb.offline ? <Offline /> : null;
  }

  if (!pb.controllable) {
    // Legacy hearing (created before control tokens): nobody can control it, so offer a fresh start instead.
    action = { label: "Start a new hearing", onClick: onNewHearing };
    detail = `${detail} This hearing was created before access control and is read-only.`;
  } else if (!pb.canControl && action) {
    action = null;
    detail = `${detail} View only: the controls are in the browser that started this hearing.`;
  }

  return (
    <div className="border-b border-cinkline bg-cink2 px-6 py-3" role="status" aria-live="polite">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: tone }} />
        <div className="min-w-0 flex-1">
          <div className="keb !text-[10px]" style={{ color: tone }}>
            {title}
          </div>
          {detail && <p className="mt-0.5 text-[12.5px] leading-snug text-cchalkdim">{detail}</p>}
        </div>
        {showLink && (
          <button onClick={copyLink} className="btn btn-line-ink !px-3 !py-1.5 !text-[11px]">
            {copied ? "Link copied" : "Copy link"}
          </button>
        )}
        {action && (
          <button onClick={action.onClick} disabled={pb.busy} className="btn btn-brass !px-3 !py-1.5 !text-[12px] disabled:opacity-50">
            {action.label}
          </button>
        )}
      </div>
      {pb.offline && <Offline inline />}
    </div>
  );
}

/** A hearing held in this browser (sample replay or live on Groq's free tier); nothing is saved elsewhere. */
function BrowserBanner({ pb }: { pb: HearingState }) {
  if (pb.status === "complete") return null;
  const where = `${pb.turnCount} of ${pb.totalTurns} turns`;
  const reason = [pb.error?.message, pb.error?.nextAction].filter(Boolean).join(" ");
  let tone = "var(--c-brass)";
  let title: string;
  let detail: string;
  let action: { label: string; onClick: () => void } | null;

  if (pb.status === "paused") {
    title = pb.pauseReason === "system" ? `Paused by the system · ${where}` : `Paused · ${where}`;
    detail = reason || "Resume to continue from the next turn.";
    action = { label: "Resume", onClick: pb.resume };
  } else if (pb.status === "failed" || pb.status === "partial") {
    tone = "var(--c-oxblood)";
    title = pb.status === "partial" ? `Stopped · ${where}` : "Hearing failed";
    detail = `${reason} This is not a complete record and cannot be ruled on.`;
    // Retry only when it can work; an expired or invalid session needs a new hearing instead.
    action = pb.canRetry ? { label: "Retry", onClick: pb.retry } : { label: "Start a new hearing", onClick: pb.restart }; // this case's intro: new session or sample
  } else if (pb.pauseRequested) {
    title = `Pausing… · ${where}`;
    detail = "The current step will finish and be kept, then the hearing pauses before the next one.";
    action = { label: "Keep going", onClick: pb.resume };
  } else if (pb.live) {
    title = `Live · Groq free tier · ${where}`;
    detail =
      pb.attempt > 0
        ? `Temporary problem${pb.error?.message ? `: ${pb.error.message}` : ""}. Retrying (attempt ${pb.attempt + 1}).`
        : "Agents are generating new turns now. Leaving the page ends the hearing; nothing is saved.";
    action = { label: "Pause", onClick: pb.pause };
  } else {
    title = `Sample playback · ${where}`;
    detail = "Pre-written sample turns, played in this browser. Leaving the page ends the playback; nothing is saved.";
    action = { label: "Pause", onClick: pb.pause };
  }

  return (
    <div className="border-b border-cinkline bg-cink2 px-6 py-3" role="status" aria-live="polite">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: tone }} />
        <div className="min-w-0 flex-1">
          <div className="keb !text-[10px]" style={{ color: tone }}>
            {title}
          </div>
          <p className="mt-0.5 text-[12.5px] leading-snug text-cchalkdim">{detail}</p>
        </div>
        <button onClick={action.onClick} className="btn btn-brass !px-3 !py-1.5 !text-[12px]">
          {action.label}
        </button>
      </div>
    </div>
  );
}

function Offline({ inline = false }: { inline?: boolean }) {
  return (
    <p className={`text-[12px] text-coxblood ${inline ? "mt-2" : "border-b border-cinkline bg-cink2 px-6 py-2"}`}>
      Connection lost. Reconnecting. The hearing keeps running on the server, and nothing is lost.
    </p>
  );
}
