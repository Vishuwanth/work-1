import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import {
  pageTargets,
  buildPrompt,
  buildFixture,
  parseSectionFromOutput,
} from "@/lib/generate";
import { validateFixture } from "@/lib/validate";
import type { Row, FaqSection } from "@/lib/types";

const PROMPT = resolve(process.cwd(), "docs/prompts/faq-generation-prompt.md");

function row(extra: Partial<Row> = {}): Row {
  return {
    collection: "treatments",
    slug: "carbon-ion-therapy",
    title: "Carbon Ion Therapy",
    faqDone: false,
    role: "",
    pillarAssociation: "Proton therapy",
    ...extra,
  };
}

function section(items: number, groups = 1): FaqSection {
  const per = items / groups;
  return {
    type: "faq",
    id: "faq",
    h2: "Frequently Asked Questions",
    groups: Array.from({ length: groups }, (_, g) => ({
      title: groups === 1 ? "" : `Group ${g}`,
      items: Array.from({ length: per }, (_, i) => ({
        q: `Q${g}${i}?`,
        a: g === 0 && i === 0 ? "<p>CancerFax can help coordinate this.</p>" : `<p>A${g}${i}.</p>`,
      })),
    })),
  };
}

describe("pageTargets", () => {
  it("is 20 items in 5 titled groups for a pillar page", () => {
    expect(pageTargets("PILLAR PAGE")).toEqual({ count: 20, groups: 5, grouped: true });
  });
  it("is 10 items in one flat group for a support page", () => {
    expect(pageTargets("Support Page")).toEqual({ count: 10, groups: 1, grouped: false });
  });
  it("treats a blank role as a support page", () => {
    expect(pageTargets("")).toEqual({ count: 10, groups: 1, grouped: false });
  });
});

describe("buildFixture", () => {
  it("builds the canonical wrapper with no VERIFY anywhere", () => {
    const fx = buildFixture(row(), section(10));
    expect(fx).toMatchObject({
      pillar: "Proton therapy",
      contentType: "Treatments",
      runner: "apply-pillar-faqs.js",
      slug: "carbon-ion-therapy",
      route: "/treatments/carbon-ion-therapy",
    });
    expect(JSON.stringify(fx)).not.toContain("⚠");
  });

  it("falls back to the title when pillar_association is blank", () => {
    const fx = buildFixture(row({ pillarAssociation: "" }), section(10));
    expect(fx.pillar).toBe("Carbon Ion Therapy");
  });

  it("omits legacy fields", () => {
    const fx = buildFixture(row(), section(10)) as unknown as Record<string, unknown>;
    expect(fx.schemaRecommendation).toBeUndefined();
    expect(fx.medicalDisclaimer).toBeUndefined();
    expect(fx.section).toBeUndefined();
  });

  it("produces a fixture the validator accepts", () => {
    const r = row();
    expect(validateFixture(buildFixture(r, section(10)), r)).toEqual([]);
  });

  it("produces a valid pillar fixture too", () => {
    const r = row({ role: "PILLAR PAGE" });
    expect(validateFixture(buildFixture(r, section(20, 5)), r)).toEqual([]);
  });
});

describe("buildPrompt", () => {
  it("states the exact count and flat shape for a support page", () => {
    const p = buildPrompt(row(), PROMPT);
    expect(p).toContain("exactly 10");
    expect(p).toContain('"title": ""');
    expect(p).toContain("Carbon Ion Therapy");
    expect(p).toContain("/treatments/carbon-ion-therapy");
  });

  it("states the grouped shape for a pillar page", () => {
    const p = buildPrompt(row({ role: "PILLAR PAGE" }), PROMPT);
    expect(p).toContain("exactly 20");
    expect(p).toContain("4-5 themed groups");
  });

  it("carries the CancerFax mention rule", () => {
    expect(buildPrompt(row(), PROMPT)).toContain("exactly 1 or 2");
  });

  it("never leaks a VERIFY placeholder into the prompt", () => {
    expect(buildPrompt(row(), PROMPT)).not.toContain("⚠ VERIFY");
  });
});

describe("parseSectionFromOutput", () => {
  it("extracts JSON from a fenced, prefaced reply", () => {
    const s = parseSectionFromOutput(
      'Sure!\n```json\n{"type":"faq","id":"faq","h2":"H","groups":[]}\n```\nDone.',
    );
    expect(s.type).toBe("faq");
  });

  it("throws when there is no object", () => {
    expect(() => parseSectionFromOutput("no json here")).toThrow(/no JSON object/);
  });
});
