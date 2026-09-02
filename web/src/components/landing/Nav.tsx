import Link from "next/link";
import { Scales } from "./Scales";

export function Nav() {
  return (
    <nav className="absolute left-0 right-0 top-0 z-50">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between px-6 py-5 md:px-10">
        <div className="flex items-center gap-2.5 text-cchalk">
          <Scales className="h-7 w-7" />
          <span className="display text-2xl tracking-tight">Juro</span>
        </div>
        <div className="hidden items-center gap-9 text-[13px] text-cchalkdim md:flex">
          <a href="#how" className="transition-colors hover:text-cchalk">The tribunal</a>
          <a href="#demo" className="transition-colors hover:text-cchalk">In session</a>
          <a href="#law" className="transition-colors hover:text-cchalk">The law</a>
        </div>
        <Link href="/chamber" className="btn btn-line-ink !py-2 !text-[13px]">Enter the chamber</Link>
      </div>
    </nav>
  );
}
