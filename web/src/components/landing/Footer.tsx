import { Scales } from "./Scales";

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <div className="keb mb-3 text-cchalkdim">{title}</div>
      <ul className="flex flex-col gap-2 text-[13px]">
        {links.map(([t, h]) => (
          <li key={t}>
            <a href={h} className="text-cchalkdim transition-colors hover:text-cchalk">{t}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Footer() {
  return (
    <footer className="bg-cink text-cchalkdim">
      <div className="mx-auto max-w-[1400px] px-6 py-14 md:px-10">
        <div className="grid gap-10 border-b border-cinkline pb-12 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2 text-cchalk">
              <Scales className="h-5 w-5" />
              <span className="display text-lg">Juro</span>
            </div>
            <p className="mt-3 max-w-xs text-[13px] leading-relaxed text-cchalkdim">
              Both sides heard. One ruling. An adversarial tribunal for denied claims, grounded in
              real law and run on Band.
            </p>
          </div>
          <FooterCol title="Product" links={[["Enter the chamber", "/chamber"], ["How it works", "#how"], ["See a hearing", "#demo"]]} />
          <FooterCol title="The case" links={[["Real cases", "#cases"], ["The law", "#law"], ["Where it goes", "#next"]]} />
          <FooterCol title="More" links={[["GitHub", "https://github.com/PiyushMalik01/juro"], ["Built on Band", "https://www.band.ai"]]} />
        </div>
        <div className="flex flex-col gap-3 pt-7 text-[12px] md:flex-row md:items-center md:justify-between">
          <p className="max-w-2xl leading-relaxed text-cchalkdim">
            Juro provides decision support, not legal advice. A human delivers every ruling. Citations
            are informational. Verify deadlines and rights for your plan, program, and state.
          </p>
          <span className="mono shrink-0">Band of Agents Hackathon · 2026</span>
        </div>
      </div>
    </footer>
  );
}
