import { describe, it, expect } from "vitest";
import { parseLedger, readLedger, APP_BATCH_FOLDER } from "@/lib/ledger";

const HEADER = "source_folder,file,target_collection,target_slug,status";
const F = APP_BATCH_FOLDER;

describe("parseLedger", () => {
  it("maps the three real verdicts", () => {
    const m = parseLedger(
      `${HEADER}\n` +
        `${F},a-faq-section.json,guides,a,DONE - verified live now\n` +
        `${F},b-faq-section.json,guides,b,UNDONE - never had a matching page\n` +
        `${F},c-faq-section.json,guides,c,RAN BUT NOW MISSING (slug drift/deleted)\n`,
    );
    expect(m.get("a-faq-section.json")).toBe("live");
    expect(m.get("b-faq-section.json")).toBe("no-page");
    expect(m.get("c-faq-section.json")).toBe("drifted");
  });

  it("matches DONE by prefix so a trailing parenthetical still counts as live", () => {
    const m = parseLedger(
      `${HEADER}\n${F},a-faq-section.json,guides,a,"DONE - verified live now (slug renamed cancer-immunotherapy -> immunotherapy)"\n`,
    );
    expect(m.get("a-faq-section.json")).toBe("live");
  });

  it("labels an unrecognized status as other", () => {
    const m = parseLedger(`${HEADER}\n${F},a-faq-section.json,guides,a,CSV REBUILT from live Strapi\n`);
    expect(m.get("a-faq-section.json")).toBe("other");
  });

  it("keeps only the requested source folder by default", () => {
    const m = parseLedger(
      `${HEADER}\n` +
        `${F},mine.json,guides,a,DONE - verified live now\n` +
        `batch-2026-07-20,theirs.json,guides,b,DONE - verified live now\n`,
    );
    expect(m.has("mine.json")).toBe(true);
    expect(m.has("theirs.json")).toBe(false);
  });

  it("reads every folder when sourceFolder is null", () => {
    const m = parseLedger(
      `${HEADER}\n` +
        `${F},mine.json,guides,a,DONE - verified live now\n` +
        `batch-2026-07-20,theirs.json,guides,b,DONE - verified live now\n`,
      null,
    );
    expect(m.size).toBe(2);
  });

  it("skips rows with no file name", () => {
    const m = parseLedger(`${HEADER}\n${F},,guides,a,DONE - verified live now\n`);
    expect(m.size).toBe(0);
  });
});

describe("readLedger (real source file)", () => {
  it("reproduces the team's 286 / 324 / 9 split for this app's batch", () => {
    const m = readLedger();
    const count = (s: string) => [...m.values()].filter((v) => v === s).length;
    expect(m.size).toBe(619);
    expect(count("live")).toBe(286);
    expect(count("no-page")).toBe(324);
    expect(count("drifted")).toBe(9);
  });
});
