#!/usr/bin/env python3
"""
Verify everything locally (no hosted CI, no paid services, no network calls to model providers).

    python scripts/verify.py            # all checks, including the production build
    python scripts/verify.py --quick    # skip the web production build
    python scripts/verify.py --only backend|web|data

Checks:
  data      canonical case data is valid and both generated copies are up to date
  guards    paid-provider endpoints/clients appear only in their guarded files
  sample    nothing would turn the public build away from sample-only (env / .env files)
  backend   pytest backend/tests (uses this Python; needs pytest, and langchain-groq for full coverage)
  web       npm test, npm run lint, tsc --noEmit, npm run build (unless --quick)

Exit code 0 only if every check passes.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
BACKEND = ROOT / "backend"

# Paid providers may only be referenced where a provider guard runs first.
PAID_PATTERNS = {
    r"api\.anthropic\.com": set(),
    r"api\.deepgram\.com": {"web/src/app/api/speak/route.ts"},
    r"\bChatAnthropic\b": set(),
    r"anthropic\.Anthropic\(": {"backend/src/juro/generate.py"},
    r"langchain_anthropic": set(),
}
SAMPLE_ONLY_FLAGS = ("NEXT_PUBLIC_DURABLE_HEARINGS", "NEXT_PUBLIC_LIVE_HEARINGS")
SCAN_DIRS = ("web/src", "backend/src")
SCAN_SUFFIXES = {".ts", ".tsx", ".js", ".mjs", ".py"}

results: list[tuple[str, bool, str, float]] = []


def record(name: str, ok: bool, detail: str = "", started: float | None = None) -> None:
    secs = time.monotonic() - started if started else 0.0
    results.append((name, ok, detail, secs))
    print(f"{'PASS' if ok else 'FAIL'}  {name}{f'  ({detail})' if detail else ''}", flush=True)


def run(name: str, cmd: list[str], cwd: Path) -> None:
    started = time.monotonic()
    exe = shutil.which(cmd[0])
    if not exe:
        record(name, False, f"{cmd[0]} not found on PATH", started)
        return
    proc = subprocess.run([exe, *cmd[1:]], cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    ok = proc.returncode == 0
    tail = ""
    if not ok:
        lines = [ln for ln in (proc.stdout + proc.stderr).splitlines() if ln.strip()]
        tail = " | ".join(lines[-6:])[-600:]
    record(name, ok, tail, started)


def check_data() -> None:
    run("data: canonical cases valid, generated copies in sync", [sys.executable, "scripts/sync_cases.py", "--check"], ROOT)


def check_guards() -> None:
    started = time.monotonic()
    hits = []
    for d in SCAN_DIRS:
        for path in (ROOT / d).rglob("*"):
            if path.suffix not in SCAN_SUFFIXES or "node_modules" in path.parts or "__pycache__" in path.parts:
                continue
            rel = path.relative_to(ROOT).as_posix()
            if rel.endswith((".test.ts", ".test.tsx")):
                continue
            text = path.read_text(encoding="utf-8", errors="replace")
            for pattern, allowed in PAID_PATTERNS.items():
                if re.search(pattern, text) and rel not in allowed:
                    hits.append(f"{rel}: {pattern}")
    record("guards: paid providers only in guarded files", not hits, "; ".join(hits), started)


def check_sample_only() -> None:
    started = time.monotonic()
    problems = [f"env {k}={os.environ[k]}" for k in SAMPLE_ONLY_FLAGS if os.environ.get(k)]
    for f in WEB.glob(".env*"):
        if f.name.endswith(".example"):
            continue
        for line in f.read_text(encoding="utf-8", errors="replace").splitlines():
            key = line.split("=", 1)[0].strip()
            if key in SAMPLE_ONLY_FLAGS and line.split("=", 1)[-1].strip() not in ("", "0"):
                problems.append(f"{f.name}: {key}")
    detail = "; ".join(problems)
    if problems:
        detail += " (fine for local testing; never build the public app with these)"
    record("sample: build inputs keep the public app sample-only", not problems, detail, started)


def check_backend() -> None:
    try:
        import pytest  # noqa: F401
    except ImportError:
        record("backend: pytest", False, f"pytest not installed for {sys.executable}; run: pip install -e \"backend[dev]\"")
        return
    run("backend: pytest", [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", "tests"], BACKEND)


def check_web(quick: bool) -> None:
    if not (WEB / "node_modules").exists():
        record("web: dependencies", False, "web/node_modules missing; run: cd web && npm ci")
        return
    run("web: npm test", ["npm", "test"], WEB)
    run("web: lint", ["npm", "run", "lint"], WEB)
    run("web: typecheck", ["npx", "tsc", "--noEmit", "-p", "."], WEB)
    if not quick:
        env_flags = [k for k in SAMPLE_ONLY_FLAGS if os.environ.get(k)]
        if env_flags:
            record("web: production build", False, f"refusing to build with {', '.join(env_flags)} set")
        else:
            run("web: production build (sample-only)", ["npm", "run", "build"], WEB)


def main(argv: list[str]) -> int:
    quick = "--quick" in argv
    only = argv[argv.index("--only") + 1] if "--only" in argv and argv.index("--only") + 1 < len(argv) else None
    if only in (None, "data"):
        check_data()
        check_guards()
        check_sample_only()
    if only in (None, "backend"):
        check_backend()
    if only in (None, "web"):
        check_web(quick)
    failed = [r for r in results if not r[1]]
    total = sum(r[3] for r in results)
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed in {total:.0f}s")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
