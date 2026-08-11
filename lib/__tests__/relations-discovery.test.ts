import { describe, expect, it } from "vitest";

import {
  isRelationValue,
  isInternalField,
  isWritableRelationField,
  SENSITIVE_FIELD_NAME_RE,
} from "@/lib/relations/discovery";

describe("isRelationValue", () => {
  it("accepts a populated to-one relation", () => {
    expect(isRelationValue({ documentId: "abc123", slug: "some-condition" })).toBe(true);
  });

  it("accepts a populated to-many relation", () => {
    expect(isRelationValue([{ documentId: "a" }, { documentId: "b" }])).toBe(true);
  });

  it("rejects an empty to-many relation — nothing to classify from", () => {
    expect(isRelationValue([])).toBe(false);
  });

  it("rejects null/undefined", () => {
    expect(isRelationValue(null)).toBe(false);
    expect(isRelationValue(undefined)).toBe(false);
  });

  it("rejects a plain string or number", () => {
    expect(isRelationValue("hello")).toBe(false);
    expect(isRelationValue(42)).toBe(false);
  });

  // Regression: `resource.featuredVideo` and `guide.featuredImage` were both
  // misclassified as content relations before this check existed — Strapi
  // media/upload entries are ALSO `{ documentId, url, ... }` objects.
  it("rejects a media/upload entry even though it has documentId", () => {
    expect(
      isRelationValue({
        documentId: "media123",
        url: "/uploads/photo.jpg",
        mime: "image/jpeg",
        ext: ".jpg",
      }),
    ).toBe(false);
  });

  it("rejects a many-relation array of media entries", () => {
    expect(
      isRelationValue([
        { documentId: "m1", url: "/a.jpg", mime: "image/jpeg" },
        { documentId: "m2", url: "/b.jpg", mime: "image/jpeg" },
      ]),
    ).toBe(false);
  });

  it("rejects a mixed array of one real relation and one media entry", () => {
    // every() must fail the whole array, not just skip the bad entry — a
    // partially-media array is not a clean relation field.
    expect(
      isRelationValue([{ documentId: "cond1", slug: "lung-cancer" }, { documentId: "m1", url: "/a.jpg", mime: "image/jpeg" }]),
    ).toBe(false);
  });
});

describe("isInternalField", () => {
  it("flags a field ending in _internal", () => {
    expect(isInternalField("consent_form_file_internal")).toBe(true);
    expect(isInternalField("email_internal")).toBe(true);
  });

  it("does not flag an ordinary field", () => {
    expect(isInternalField("conditions")).toBe(false);
    expect(isInternalField("internal_notes_internal")).toBe(true); // still ends with _internal
  });
});

describe("SENSITIVE_FIELD_NAME_RE", () => {
  // Regression: this exact field was found live on the `condition` content
  // type — a relation to prospective-patient contact/lead data, which must
  // never be treated as content to cross-link or feed to a prompt.
  it("matches cost_calculator_leads", () => {
    expect(SENSITIVE_FIELD_NAME_RE.test("cost_calculator_leads")).toBe(true);
  });

  it("does not false-positive on doctor.led_trials", () => {
    // "led" is not "lead" — a substring match would wrongly catch this.
    expect(SENSITIVE_FIELD_NAME_RE.test("led_trials")).toBe(false);
  });

  it("does not flag an ordinary relation field name", () => {
    expect(SENSITIVE_FIELD_NAME_RE.test("conditions")).toBe(false);
    expect(SENSITIVE_FIELD_NAME_RE.test("related_treatments")).toBe(false);
  });
});

describe("isWritableRelationField", () => {
  const contentType = {
    relationFields: [
      { field: "resource_category", cardinality: "one", reserved: true },
      { field: "related_treatments", cardinality: "many", reserved: false },
    ],
  };

  it("allows a discovered, non-reserved relation field", () => {
    expect(isWritableRelationField(contentType, "related_treatments")).toBe(true);
  });

  it("refuses a field reserved by another feature (the Resources classifier)", () => {
    expect(isWritableRelationField(contentType, "resource_category")).toBe(false);
  });

  it("refuses a field discovery never found at all", () => {
    expect(isWritableRelationField(contentType, "made_up_field")).toBe(false);
  });
});
