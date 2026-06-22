import { NextRequest } from "next/server";
import { CASES } from "@/data/cases";
import { MODEL_FOR, SYSTEM_PROMPTS, TURN_PLAN, VERDICT_MODEL, type Role } from "@/lib/roles";
import type { CaseEntry } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const ANTHROPIC = "https://api.anthropic.com/v1/messages";

function brief(entry: CaseEntry): string {
  const c = entry.transcript.case;
  const ev = entry.transcript.evidence
    .map((e) => `  ${e.id} [${e.kind}] ${e.label}: ${e.detail || e.authority || ""} (cite ${e.cite})`)
    .join("\n");
  return (
    `CLAIM ${c.claimId} — ${c.patient}\n` +
    `Procedure: ${c.procedure} (${c.amount})\n` +
    `Insurer: ${c.insurer}\nPlan: ${c.planType}\n` +
    `DENIAL: ${c.denialReason}\n\nEVIDENCE ON THE RECORD:\n${ev}`
  );
}

async function ask(key: string, model: string, system: string, user: string): Promise<string> {
  const r = await fetch(ANTHROPIC, {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: 400, system, messages: [{ role: "user", content: user }] }),
  });
  if (!r.ok) throw new Error(`anthropic ${r.status}`);
  const d = (await r.json()) as { content?: { type: string; text?: string }[] };
  return (d.content || []).filter((b) => b.type === "text").map((b) => b.text || "").join("").trim();
}

function parseJson(raw: string): Record<string, unknown> {
  const s = raw.indexOf("{");
  const e = raw.lastIndexOf("}");
  if (s < 0 || e <= s) throw new Error("no json");
  return JSON.parse(raw.slice(s, e + 1));
}

const estDur = (t: string) => Math.max(3500, Math.min(8000, t.length * 45));

export async function POST(req: NextRequest) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return new Response("no_key", { status: 503 });

  const body = (await req.json().catch(() => ({}))) as { caseId?: string };
  const entry = CASES.find((c) => c.id === body.caseId) ?? CASES[0];
  const b = brief(entry);
  const validIds = entry.transcript.evidence.map((e) => e.id);
  const enc = new TextEncoder();

  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (o: unknown) => ctrl.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      const turns: { agent: Role; text: string }[] = [];
      const soFar = () =>
        turns.length ? turns.map((t) => `${t.agent.toUpperCase()}: ${t.text}`).join("\n") : "(the floor is open)";
      try {
        for (let i = 0; i < TURN_PLAN.length; i++) {
          const [role, kind] = TURN_PLAN[i];
          send({ type: "thinking", agent: role });
          const user =
            `${b}\n\nDEBATE SO FAR:\n${soFar()}\n\n` +
            `It is your turn (${role}, ${kind}). Valid evidence ids: ${validIds.join(", ")}.\n` +
            'Respond ONLY with compact JSON: {"text":"<1-3 sentences>",' +
            '"addressedTo":"<advocate|scrutinizer|evidence|adjudicator|human|null>",' +
            '"evidenceRefs":["EX-..",...]}';
          const data = parseJson(await ask(key, MODEL_FOR[role], SYSTEM_PROMPTS[role], user));
          const text = String(data.text || "").trim();
          if (!text) throw new Error("empty turn");
          const refs = (Array.isArray(data.evidenceRefs) ? data.evidenceRefs : []).filter((r) =>
            validIds.includes(r as string),
          );
          let addressed = data.addressedTo as string | null;
          if (addressed === "null" || addressed === "") addressed = null;
          turns.push({ agent: role, text });
          send({
            type: "turn",
            turn: { id: `t${i + 1}`, agent: role, type: kind, text, addressedTo: addressed, evidenceRefs: refs, durationMs: estDur(text) },
          });
        }
        const vuser =
          `${b}\n\nFULL DEBATE:\n${soFar()}\n\n` +
          "You are the human medical reviewer delivering the FINAL verdict. " +
          'Respond ONLY with JSON: {"decision":"OVERTURNED|UPHELD","rationale":"<1-2 sentences>","confidence":<0..1>}';
        const vd = parseJson(
          await ask(key, VERDICT_MODEL, "You weigh both sides fairly and decide. Patients deserve a defense; insurers deserve rigor.", vuser),
        );
        send({
          type: "verdict",
          verdict: {
            decision: vd.decision || "OVERTURNED",
            rationale: vd.rationale || "",
            by: entry.transcript.verdict.by,
            confidence: Number(vd.confidence ?? 0.85),
          },
        });
        send({ type: "done" });
      } catch (e) {
        send({ type: "error", message: String((e as Error)?.message || e) });
      } finally {
        ctrl.close();
      }
    },
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}
