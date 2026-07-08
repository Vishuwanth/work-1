#!/usr/bin/env python3
"""
Validate a subagent-produced FAQ section JSON and write the wrapper fixture file.

This is the deterministic tail of the no-API-key (subscription / subagent) workflow used
by the `cancerfax-faq` skill: a Claude Code subagent researches + writes the section JSON,
then this script validates it and writes output/faq/<slug>-faq-section.json with the
status-aware wrapper. It reuses the validator, page-type targets, and wrapper builder from
generate_faq.py, so it needs NO ANTHROPIC_API_KEY (only openpyxl, already installed).

Usage:
  python3 faq_write.py --section /path/to/section.json \
      --title "What is CAR-T?" --pillar "CAR-T Cell Therapy" \
      --status Pending --content-type Treatment
"""
import argparse
import html
import json
import sys
from pathlib import Path

import generate_faq as g  # reuses page_targets, validate, build_output, slugify, DEFAULT_OUT


def normalize_section(section):
    """Repair common subagent artifacts so the fixture matches the CKEditor5 raw-HTML shape.

    Subagents sometimes HTML-escape the answer paragraph tags (`&lt;p&gt;...&lt;/p&gt;`).
    The fixture format (and the BNCT sample) uses raw `<p>...</p>`, so unescape any answer
    that still carries escaped angle brackets, and trim surrounding whitespace.
    """
    for group in section.get("groups", []):
        for item in group.get("items", []):
            a = item.get("a")
            if isinstance(a, str):
                if "&lt;" in a or "&gt;" in a or "&amp;" in a:
                    a = html.unescape(a)
                item["a"] = a.strip()
            q = item.get("q")
            if isinstance(q, str):
                item["q"] = html.unescape(q).strip()
    return section


def main():
    ap = argparse.ArgumentParser(description="Validate + write a FAQ section fixture (no API key).")
    ap.add_argument("--section", required=True, help="Path to JSON file holding the section-faq object")
    ap.add_argument("--title", required=True, help="Support Page Title (drives slug + h2 topic)")
    ap.add_argument("--pillar", default="")
    ap.add_argument("--status", default="Pending", help="Done -> sectionToMerge; else -> section")
    ap.add_argument("--content-type", default="", help="Treatment/Guide/Insight/... ; blank -> pillar default")
    ap.add_argument("--out", default=str(g.DEFAULT_OUT))
    args = ap.parse_args()

    raw = Path(args.section).read_text()
    # Tolerate a subagent preamble / trailing prose by extracting the outermost JSON object.
    start, end = raw.find("{"), raw.rfind("}")
    if start != -1 and end != -1 and end > start:
        raw = raw[start:end + 1]
    try:
        section = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"VALIDATION FAILED: section is not valid JSON ({e})")
        return 2
    section = normalize_section(section)

    page = {
        "title": args.title,
        "pillar_name": args.pillar,
        "status": args.status,
        "content_type": args.content_type,
    }
    targets = g.page_targets(args.content_type)
    problems, warnings, count = g.validate(section, targets)
    if problems:
        print("VALIDATION FAILED: " + "; ".join(problems))
        return 2
    for w in warnings:
        print(f"warning: {w}")

    out = g.build_output(page, section)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{g.slugify(args.title)}-faq-section.json"
    path.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {path}  ({count} FAQs, {len(section['groups'])} groups, "
          f"key={'sectionToMerge' if args.status.lower() == 'done' else 'section'})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
