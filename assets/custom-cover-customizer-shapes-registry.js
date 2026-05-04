/**
 * Shape picker: local primitives + icons from the Iconify JSON API
 * (https://iconify.design). MDI (Pictogrammers, Apache 2.0).
 *
 * Outline/filled pairs: each row is one logical shape; null skips that variant.
 */

const ICONIFY_JSON_BASE = "https://api.iconify.design";

/** @typedef {{ id: string, label: string, kind: 'builtin', builtin: 'rectangle' | 'ellipse' | 'triangle', defaultW: number, defaultH: number }} BuiltinShapeDef */
/** @typedef {{ id: string, label: string, kind: 'path', viewBox: number, paths: string[], fillRule?: CanvasFillRule, defaultW: number, defaultH: number, iconify?: { collection: string, icon: string }, variant?: 'outline' | 'filled', shortLabel?: string }} PathShapeDef */
/** @typedef {BuiltinShapeDef | PathShapeDef} ResolvedShapeDef */

/** @type {BuiltinShapeDef[]} */
export const BUILTIN_SHAPES = [
  {
    id: "builtin-rectangle",
    label: "Rectangle",
    kind: "builtin",
    builtin: "rectangle",
    defaultW: 185,
    defaultH: 125,
  },
  {
    id: "builtin-ellipse",
    label: "Ellipse",
    kind: "builtin",
    builtin: "ellipse",
    defaultW: 185,
    defaultH: 125,
  },
  {
    id: "builtin-triangle",
    label: "Triangle",
    kind: "builtin",
    builtin: "triangle",
    defaultW: 200,
    defaultH: 140,
  },
];

/**
 * Logical shapes → MDI slug per variant (outline / filled). Null = skip that variant.
 * @type {{ label: string, outline: string | null, filled: string | null }[]}
 */
export const ICONIFY_SHAPE_PAIRS = [
  { label: "Square", outline: "square-rounded-outline", filled: "square-rounded" },
  { label: "Circle", outline: "circle-outline", filled: "circle" },
  { label: "Triangle", outline: "triangle-outline", filled: "triangle" },
  { label: "Hexagon", outline: "hexagon-outline", filled: "hexagon" },
  { label: "Octagon", outline: "octagon-outline", filled: "octagon" },
  { label: "Pentagon", outline: "pentagon-outline", filled: "pentagon" },
  { label: "Diamond", outline: "rhombus-outline", filled: "rhombus" },
  { label: "Star", outline: "star-four-points-outline", filled: "star-four-points" },
  { label: "Heart", outline: "heart-outline", filled: "heart" },
  { label: "Shield", outline: "shield-outline", filled: "shield" },
  { label: "Bookmark", outline: "bookmark-outline", filled: "bookmark" },
  { label: "Flag", outline: "flag-outline", filled: "flag" },
  { label: "Tag", outline: "tag-outline", filled: "tag" },
  { label: "Bolt", outline: "lightning-bolt-outline", filled: "lightning-bolt" },
  { label: "Cloud", outline: "cloud-outline", filled: "cloud" },
  { label: "Flower", outline: "flower-outline", filled: "flower" },
  { label: "Flame", outline: null, filled: "fire" },
  { label: "Drop", outline: "water-outline", filled: "water" },
  { label: "Arrow up", outline: "arrow-up-bold-outline", filled: "arrow-up-bold" },
  { label: "Plus", outline: "plus-outline", filled: "plus-thick" },
];

export const SHAPES_PAGE_SIZE = 10;

/**
 * @param {string} body Iconify `icons[name].body` (fragment with path/circle elements)
 * @returns {string[]}
 */
export function extractPathDsFromIconifyBody(body) {
  if (!body || typeof body !== "string") {
    return [];
  }
  const out = [];
  const reDouble = /\sd\s*=\s*"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = reDouble.exec(body))) {
    const g = m[1];
    if (g) {
      out.push(g.replace(/\\"/g, '"'));
    }
  }
  const reSingle = /\sd\s*=\s*'((?:[^'\\]|\\.)*)'/g;
  while ((m = reSingle.exec(body))) {
    const g2 = m[1];
    if (g2) {
      out.push(g2.replace(/\\'/g, "'"));
    }
  }
  return out;
}

/**
 * @returns {Promise<ResolvedShapeDef[]>}
 */
export async function resolveFullShapeLibrary() {
  const out = /** @type {ResolvedShapeDef[]} */ ([...BUILTIN_SHAPES]);

  /** @type {{ id: string, label: string, collection: string, icon: string, defaultW?: number, defaultH?: number, variant: 'outline' | 'filled', shortLabel: string }[]} */
  const fetchRefs = [];

  for (const pair of ICONIFY_SHAPE_PAIRS) {
    if (pair.outline) {
      fetchRefs.push({
        id: `if-mdi-o-${pair.outline.replace(/[^a-z0-9]+/gi, "-")}`,
        label: pair.label,
        shortLabel: pair.label,
        collection: "mdi",
        icon: pair.outline,
        variant: "outline",
      });
    }
    if (pair.filled) {
      fetchRefs.push({
        id: `if-mdi-f-${pair.filled.replace(/[^a-z0-9]+/gi, "-")}`,
        label: pair.label,
        shortLabel: pair.label,
        collection: "mdi",
        icon: pair.filled,
        variant: "filled",
      });
    }
  }

  /** @type {Map<string, typeof fetchRefs>} */
  const byCollection = new Map();
  for (const ref of fetchRefs) {
    let bucket = byCollection.get(ref.collection);
    if (!bucket) {
      bucket = [];
      byCollection.set(ref.collection, bucket);
    }
    bucket.push(ref);
  }

  for (const [collection, refs] of byCollection) {
    const uniqueNames = [...new Set(refs.map((r) => r.icon))];
    const qs = uniqueNames.map((n) => encodeURIComponent(n)).join(",");
    const url = `${ICONIFY_JSON_BASE}/${encodeURIComponent(collection)}.json?icons=${qs}`;
    const res = await fetch(url, { mode: "cors", credentials: "omit" });
    if (!res.ok) {
      throw new Error(`Iconify ${collection}: ${res.status}`);
    }
    /** @type {{ width?: number, height?: number, icons?: Record<string, { body?: string }> }} */
    const data = await res.json();
    const vb = Number(data.width || data.height || 24) || 24;

    for (const ref of refs) {
      const iconData = data.icons?.[ref.icon];
      if (!iconData?.body) {
        continue;
      }
      const paths = extractPathDsFromIconifyBody(iconData.body);
      if (!paths.length) {
        continue;
      }
      out.push({
        id: ref.id,
        label: ref.shortLabel,
        kind: "path",
        viewBox: vb,
        paths,
        fillRule: "nonzero",
        defaultW: ref.defaultW ?? 160,
        defaultH: ref.defaultH ?? 160,
        iconify: { collection, icon: ref.icon },
        variant: ref.variant,
        shortLabel: ref.shortLabel,
      });
    }
  }

  return out;
}
