import { describe, expect, it } from "vitest";

import { validateRelations, buildVocabulary, entryKey, SEE_ALSO } from "@/lib/relations/classify";

const CANDIDATES_BY_KEY = new Map([
  ["condition/lung-cancer", { contentType: "condition", slug: "lung-cancer", title: "Lung Cancer", documentId: "d-lung" }],
  ["condition/breast-cancer", { contentType: "condition", slug: "breast-cancer", title: "Breast Cancer", documentId: "d-breast" }],
  ["doctor/dr-lee", { contentType: "doctor", slug: "dr-lee", title: "Dr. Lee", documentId: "d-lee" }],
]);

const VOCABULARY = [
  { field: "conditions", writable: true, targetApiId: "condition" },
  { field: "doctors", writable: true, targetApiId: "doctor" },
  { field: SEE_ALSO, writable: false, targetApiId: null },
];

const BASE_CTX = {
  vocabulary: VOCABULARY,
  candidatesByKey: CANDIDATES_BY_KEY,
  currentRelKeys: new Set(["conditions:condition/breast-cancer"]),
  sourceKey: "treatment/car-t-therapy",
};

describe("validateRelations", () => {
  it("accepts a well-formed, in-corpus proposal", () => {
    const result = validateRelations(
      { relations: [{ relationType: "conditions", targetContentType: "condition", targetSlug: "lung-cancer", rationale: "CAR-T treats this." }] },
      BASE_CTX,
    );
    expect(result.ok).toBe(true);
    expect(result.relations).toHaveLength(1);
    expect(result.relations![0]).toMatchObject({
      relationType: "conditions",
      targetSlug: "lung-cancer",
      targetDocumentId: "d-lung",
      writable: true,
    });
    expect(result.rejected).toHaveLength(0);
  });

  it("fails outright on a non-array relations field — the only whole-reply failure", () => {
    const result = validateRelations({ relations: "not an array" }, BASE_CTX);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("relations-not-array");
  });

  it("rejects an unknown relationType but keeps other valid proposals", () => {
    const result = validateRelations(
      {
        relations: [
          { relationType: "made_up_type", targetContentType: "condition", targetSlug: "lung-cancer" },
          { relationType: "doctors", targetContentType: "doctor", targetSlug: "dr-lee" },
        ],
      },
      BASE_CTX,
    );
    expect(result.ok).toBe(true);
    expect(result.relations).toHaveLength(1);
    expect(result.relations![0].targetSlug).toBe("dr-lee");
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected![0].reason).toContain("unknown-relation-type");
  });

  // Ground truth from the Strapi schema (see schema-registry.json), not a
  // guess: a `conditions` field can only ever point at `condition` entries,
  // so a model naming the right field but a wrong-typed target is caught
  // here — distinct from, and stricter than, the corpus-membership check.
  it("rejects a target whose content type doesn't match the field's declared target type", () => {
    const result = validateRelations(
      { relations: [{ relationType: "conditions", targetContentType: "doctor", targetSlug: "dr-lee" }] },
      BASE_CTX,
    );
    expect(result.relations).toHaveLength(0);
    expect(result.rejected![0].reason).toContain("target-type-mismatch");
  });

  it("does not type-check a see_also proposal — it has no declared target type", () => {
    const result = validateRelations(
      { relations: [{ relationType: SEE_ALSO, targetContentType: "doctor", targetSlug: "dr-lee" }] },
      BASE_CTX,
    );
    expect(result.relations).toHaveLength(1);
  });

  // The core anti-hallucination gate: a target that isn't in the fetched
  // corpus is never accepted, even if it's a plausible-looking slug — this is
  // what stops the model inventing a page that doesn't exist.
  it("rejects a target not present in the corpus", () => {
    const result = validateRelations(
      { relations: [{ relationType: "conditions", targetContentType: "condition", targetSlug: "made-up-condition" }] },
      BASE_CTX,
    );
    expect(result.ok).toBe(true);
    expect(result.relations).toHaveLength(0);
    expect(result.rejected![0].reason).toBe("target-not-in-corpus");
  });

  it("rejects a self-relation", () => {
    // Source and target must be the SAME type for this to reach the
    // self-relation check at all — a cross-type "relate to yourself" would
    // already be caught by the type-mismatch check above.
    const result = validateRelations(
      { relations: [{ relationType: "conditions", targetContentType: "condition", targetSlug: "lung-cancer" }] },
      { ...BASE_CTX, sourceKey: "condition/lung-cancer" },
    );
    expect(result.relations).toHaveLength(0);
    expect(result.rejected![0].reason).toBe("self-relation");
  });

  it("rejects a relation that's already current, so it's never re-proposed", () => {
    const result = validateRelations(
      { relations: [{ relationType: "conditions", targetContentType: "condition", targetSlug: "breast-cancer" }] },
      BASE_CTX,
    );
    expect(result.relations).toHaveLength(0);
    expect(result.rejected![0].reason).toBe("already-current");
  });

  it("drops a duplicate within the same reply, keeping the first", () => {
    const result = validateRelations(
      {
        relations: [
          { relationType: "conditions", targetContentType: "condition", targetSlug: "lung-cancer" },
          { relationType: "conditions", targetContentType: "condition", targetSlug: "lung-cancer" },
        ],
      },
      BASE_CTX,
    );
    expect(result.relations).toHaveLength(1);
    expect(result.rejected![0].reason).toBe("duplicate-in-reply");
  });

  it("accepts an empty relations array as a fully valid answer", () => {
    const result = validateRelations({ relations: [] }, BASE_CTX);
    expect(result.ok).toBe(true);
    expect(result.relations).toHaveLength(0);
  });

  it("marks a see_also proposal as non-writable — it has no backing Strapi field", () => {
    const result = validateRelations(
      { relations: [{ relationType: SEE_ALSO, targetContentType: "doctor", targetSlug: "dr-lee" }] },
      BASE_CTX,
    );
    expect(result.relations![0].writable).toBe(false);
  });
});

describe("buildVocabulary", () => {
  it("excludes fields reserved by another feature, excludes non-content (editorial) fields, and always includes see_also", () => {
    const typeConfig = {
      apiId: "resource",
      relationFields: [
        { field: "resource_category", reserved: true, nonContent: false, targetApiId: "resource-category" },
        { field: "author", reserved: false, nonContent: true, targetApiId: "author" },
        { field: "related_treatments", reserved: false, nonContent: false, targetApiId: "treatment" },
      ],
    };
    const vocab = buildVocabulary(typeConfig);
    const fields = vocab.map((v) => v.field);
    expect(fields).toContain("related_treatments");
    expect(fields).not.toContain("resource_category");
    expect(fields).not.toContain("author");
    expect(fields).toContain(SEE_ALSO);
    expect(vocab.find((v) => v.field === SEE_ALSO)?.writable).toBe(false);
    expect(vocab.find((v) => v.field === "related_treatments")?.targetApiId).toBe("treatment");
  });
});

describe("entryKey", () => {
  it("joins content type and slug with a slash, matching lib/page-key.ts's pageKey() convention", () => {
    expect(entryKey("condition", "lung-cancer")).toBe("condition/lung-cancer");
  });
});
