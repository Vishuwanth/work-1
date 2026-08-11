import { describe, expect, it } from "vitest";

import { entryKey, mergeRelationRows, type RelationCheck, type RelationEntryListItem } from "@/lib/relation-reports";

describe("entryKey", () => {
  it("joins content type and slug with a slash", () => {
    expect(entryKey("condition", "lung-cancer")).toBe("condition/lung-cancer");
  });
});

describe("mergeRelationRows", () => {
  const list: RelationEntryListItem[] = [
    { contentType: "treatment", documentId: "d1", slug: "car-t-therapy", title: "CAR-T Therapy", excerpt: "" },
    { contentType: "condition", documentId: "d2", slug: "lung-cancer", title: "Lung Cancer", excerpt: "" },
  ];

  it("marks a list item with no matching check as never-run, not an error", () => {
    const rows = mergeRelationRows(list, {});
    expect(rows).toHaveLength(2);
    expect(rows[0].checked).toBe(false);
    expect(rows[0].proposedRelations).toEqual([]);
    expect(rows[0].writeStatus).toBe("");
  });

  it("joins a persisted check onto its matching entry by key, leaving the other untouched", () => {
    const checks: Record<string, RelationCheck> = {
      "treatment/car-t-therapy": {
        key: "treatment/car-t-therapy",
        contentType: "treatment",
        slug: "car-t-therapy",
        title: "CAR-T Therapy",
        status: "ok",
        write_status: "dry-run",
        proposedRelations: [
          {
            relationType: "conditions",
            targetContentType: "condition",
            targetSlug: "lung-cancer",
            targetTitle: "Lung Cancer",
            targetDocumentId: "d2",
            rationale: "CAR-T is used for lung cancer.",
            writable: true,
          },
        ],
      },
    };
    const rows = mergeRelationRows(list, checks);
    const treatmentRow = rows.find((r) => r.key === "treatment/car-t-therapy")!;
    const conditionRow = rows.find((r) => r.key === "condition/lung-cancer")!;

    expect(treatmentRow.checked).toBe(true);
    expect(treatmentRow.proposedRelations).toHaveLength(1);
    expect(treatmentRow.writeStatus).toBe("dry-run");
    expect(conditionRow.checked).toBe(false);
  });
});
