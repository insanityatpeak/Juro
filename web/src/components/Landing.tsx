"use client";

import { SmoothScroll } from "@/components/motion";
import { Nav } from "@/components/landing/Nav";
import { Hero } from "@/components/landing/Hero";
import { TheScale } from "@/components/landing/TheScale";
import { WhatHappened } from "@/components/landing/WhatHappened";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { DemoSection } from "@/components/landing/DemoSection";
import { HowItFits } from "@/components/landing/HowItFits";
import { LawIndex } from "@/components/landing/LawIndex";
import { BuiltOnBand } from "@/components/landing/BuiltOnBand";
import { Provenance } from "@/components/landing/Provenance";
import { Expand } from "@/components/landing/Expand";
import { FinalCta } from "@/components/landing/FinalCta";
import { Footer } from "@/components/landing/Footer";

export default function Landing() {
  return (
    <SmoothScroll>
      <div className="bg-cpaper text-cink">
        <Nav />
        <Hero />
        <TheScale />
        <WhatHappened />
        <HowItWorks />
        <DemoSection />
        <HowItFits />
        <LawIndex />
        <BuiltOnBand />
        <Provenance />
        <Expand />
        <FinalCta />
        <Footer />
      </div>
    </SmoothScroll>
  );
}
