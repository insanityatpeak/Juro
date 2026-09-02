/** scales-of-justice mark, shared by Nav and Footer */
export function Scales({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="var(--c-brass)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3 V21 M7 21 H17" />
      <path d="M12 6 L5 9 M12 6 L19 9" />
      <path d="M3 9 a3 3 0 0 0 6 0 M15 9 a3 3 0 0 0 6 0" />
    </svg>
  );
}
