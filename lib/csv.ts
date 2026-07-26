// Quote-aware CSV reader. The source CSVs carry commas and colons inside titles,
// so a split(",") reader silently corrupts them.

/** Split CSV text into rows of raw cells, honouring quotes, doubled quotes, and embedded newlines. */
function toGrid(text: string): string[][] {
  const grid: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      grid.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    grid.push(row);
  }
  return grid;
}

/**
 * Parse CSV text into objects keyed by the header row. Values and header names are
 * trimmed; rows shorter than the header are padded with "". Blank lines are dropped.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const grid = toGrid(text).filter((r) => r.some((c) => c.trim() !== ""));
  if (grid.length === 0) return [];
  const header = grid[0].map((h) => h.trim());
  return grid.slice(1).map((cells) => {
    const obj: Record<string, string> = {};
    header.forEach((h, i) => {
      obj[h] = (cells[i] ?? "").trim();
    });
    return obj;
  });
}
