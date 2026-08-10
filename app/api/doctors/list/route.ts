import fs from "node:fs";
import path from "node:path";

// Reads fixtures off disk — must run on Node, never the Edge runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAPPING_PATH = path.resolve(process.cwd(), "data/doctor-photos.json");
const DOCTORS_DIR = path.resolve(process.cwd(), "sun yat sen doctors/extracted");

interface PhotoEntry {
  name: string;
  siteName: string;
  department: string;
  file: string;
  bytes: number;
  width: number;
  height: number;
  /** Which site the winning file came from — "english" or "chinese". */
  origin: string;
  source: string;
  profile: string;
}

export interface DoctorCard {
  slug: string;
  name: string;
  /** The name as SYSUCC writes it — kept so a wrong join is visible, not silent. */
  siteName: string;
  department: string;
  qualification: string;
  designation: string;
  chips: string[];
  /** Served from public/, so this is already a usable URL. */
  photo: string;
  bytes: number;
  width: number;
  height: number;
  origin: string;
  profile: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/**
 * The card fields for one fixture. Everything shown comes from the fixture; the
 * only thing taken from the hospital is the portrait itself.
 */
function readFixture(slug: string): Pick<DoctorCard, "qualification" | "designation" | "chips"> {
  try {
    const raw = fs.readFileSync(path.join(DOCTORS_DIR, `${slug}.json`), "utf8");
    const d = JSON.parse(raw) as {
      qualification?: string;
      hero?: { designation?: string; chips?: { label?: string }[] };
    };
    return {
      qualification: d.qualification ?? "",
      designation: d.hero?.designation ?? "",
      chips: (d.hero?.chips ?? []).map((c) => c.label ?? "").filter(Boolean),
    };
  } catch {
    // A photo without its fixture still has a name and a portrait worth showing.
    return { qualification: "", designation: "", chips: [] };
  }
}

export async function GET(): Promise<Response> {
  let mapping: Record<string, PhotoEntry>;
  try {
    mapping = JSON.parse(fs.readFileSync(MAPPING_PATH, "utf8")) as Record<string, PhotoEntry>;
  } catch (e) {
    return json(
      {
        error: `No portrait mapping at data/doctor-photos.json — run \`node scripts/fetch-doctor-photos.js\` first. (${(e as Error).message})`,
      },
      404,
    );
  }

  const doctors: DoctorCard[] = Object.entries(mapping)
    .map(([slug, m]) => ({
      slug,
      name: m.name,
      siteName: m.siteName,
      department: m.department,
      photo: `/doctors/${m.file}`,
      bytes: m.bytes,
      width: m.width ?? 0,
      height: m.height ?? 0,
      origin: m.origin ?? "english",
      profile: m.profile,
      ...readFixture(slug),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return json({ doctors });
}
