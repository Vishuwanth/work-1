/**
 * Mirror of scripts/generate_faq.py `slugify`:
 * NFKD normalize, drop non-ASCII, lowercase, non-alnum -> "-", collapse/trim "-".
 */
export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics
    .replace(/[^\x00-\x7f]/g, "") // drop remaining non-ASCII (ascii "ignore")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}
