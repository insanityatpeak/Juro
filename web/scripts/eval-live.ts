// Capped reasoning evaluation against Groq Free. NOT run by tests or verify.py.
//
//   JURO_EVAL_CONFIRMED=1 JURO_LIVE_PROVIDER=groq JURO_GROQ_FREE_CONFIRMED=1 GROQ_API_KEY=... \
//     npx tsx scripts/eval-live.ts [--max-calls 90]
//
// Each scenario runs twice (original and reordered evidence), 11 model calls per hearing, so the
// default 4 scenarios use 88 calls. The cap is enforced before every call. The provider policy
// still applies: an API key alone never runs this, and nothing paid is reachable.

import { EVAL_SCENARIOS, runEval } from "../src/lib/hearings/eval";
import { createAsk, createLiveSource } from "../src/lib/hearings/source";
import { groqBaseUrl } from "../src/lib/live";
import { providerPolicy } from "../src/lib/providers";

async function main() {
  if (process.env.JURO_EVAL_CONFIRMED !== "1") {
    console.error("Refusing to run: set JURO_EVAL_CONFIRMED=1 to authorize a capped Groq Free evaluation.");
    process.exit(2);
  }
  const policy = providerPolicy("groq");
  if (!policy.allowed) {
    console.error(`Refusing to run: ${policy.reason}`);
    process.exit(2);
  }
  const i = process.argv.indexOf("--max-calls");
  const cap = i > 0 ? Number(process.argv[i + 1]) : 90;
  if (!Number.isInteger(cap) || cap < 1) {
    console.error("--max-calls must be a positive integer.");
    process.exit(2);
  }

  let calls = 0;
  const inner = createAsk({
    fetch: (...a) => fetch(...a),
    timeoutMs: 25000,
    policy: () => providerPolicy("groq"),
    apiKey: () => process.env.GROQ_API_KEY,
    baseUrl: groqBaseUrl,
  });
  const ask = async (model: string, system: string, user: string) => {
    if (calls >= cap) throw new Error(`Call cap of ${cap} reached; stopping.`);
    calls++;
    return inner(model, system, user);
  };

  const report = await runEval(createLiveSource(ask), EVAL_SCENARIOS);
  console.table(report.results);
  console.log(
    `accuracy ${(report.accuracy * 100).toFixed(0)}% · order stability ${(report.orderStability * 100).toFixed(0)}% · ` +
      `flip respected: ${report.flipRespected} · model calls ${calls}/${cap}`,
  );
  console.log("All four roles share one model, so agreement among them is not independent confirmation.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
