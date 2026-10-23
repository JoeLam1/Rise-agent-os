/**
 * Word-level comparison of two documents' text layers, for showing a broker
 * what changed between two versions (for example the draft approved before
 * signing and the executed copy). Deterministic: no AI, nothing inferred.
 * It sees only extracted text, so changes in images, handwriting or
 * signatures are invisible to it, and the page says so.
 */

export type Token = { text: string; page: number };
export type Segment = { type: "equal" | "delete" | "insert"; text: string };
export type Hunk = { pageBefore: number; pageAfter: number; segments: Segment[] };
export type Comparison =
  | { status: "identical" }
  | { status: "too_different"; editsOver: number }
  | { status: "changed"; hunks: Hunk[]; wordsRemoved: number; wordsAdded: number };

/** Words kept on each side of a change, so the broker can find it in the document. */
export const CONTEXT_WORDS = 8;
/** Beyond this many word edits the documents are treated as different documents. */
export const MAX_EDITS = 1500;

export function tokenize(pages: string[]): Token[] {
  const tokens: Token[] = [];
  pages.forEach((text, i) => {
    for (const w of text.split(/\s+/)) if (w) tokens.push({ text: w, page: i + 1 });
  });
  return tokens;
}

/** Typographic variants that PDF tools produce for the same keystrokes compare equal. */
export function wordKey(w: string): string {
  return w
    .normalize("NFKC")
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, "-");
}

type Edit = { type: Segment["type"]; a: number; b: number };

/**
 * Myers' O(ND) shortest edit script over word keys. Returns null when more
 * than `maxEdits` insertions plus deletions would be needed.
 */
export function editScript(a: string[], b: string[], maxEdits = MAX_EDITS): Edit[] | null {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, maxEdits);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= max; d += 1) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(trace, offset, n, m);
    }
  }
  return null;
}

function backtrack(trace: Int32Array[], offset: number, n: number, m: number): Edit[] {
  const edits: Edit[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d -= 1) {
    const v = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? k + 1 : k - 1;
    const prevX = v[offset + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x -= 1;
      y -= 1;
      edits.push({ type: "equal", a: x, b: y });
    }
    if (d > 0) {
      if (x === prevX) {
        y -= 1;
        edits.push({ type: "insert", a: x, b: y });
      } else {
        x -= 1;
        edits.push({ type: "delete", a: x, b: y });
      }
    }
  }
  return edits.reverse();
}

export function compareTexts(before: string[], after: string[]): Comparison {
  const a = tokenize(before);
  const b = tokenize(after);
  const ak = a.map((t) => wordKey(t.text));
  const bk = b.map((t) => wordKey(t.text));
  if (ak.length === bk.length && ak.every((w, i) => w === bk[i])) return { status: "identical" };

  // Trim the shared start and end first; most edits are small and local.
  let start = 0;
  while (start < ak.length && start < bk.length && ak[start] === bk[start]) start += 1;
  let endA = ak.length;
  let endB = bk.length;
  while (endA > start && endB > start && ak[endA - 1] === bk[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const middle = editScript(ak.slice(start, endA), bk.slice(start, endB));
  if (!middle) return { status: "too_different", editsOver: MAX_EDITS };

  const edits: Edit[] = [];
  for (let i = 0; i < start; i += 1) edits.push({ type: "equal", a: i, b: i });
  for (const e of middle) edits.push({ type: e.type, a: e.a + start, b: e.b + start });
  for (let i = 0; i < ak.length - endA; i += 1) edits.push({ type: "equal", a: endA + i, b: endB + i });

  return { status: "changed", ...toHunks(edits, a, b) };
}

function toHunks(edits: Edit[], a: Token[], b: Token[]) {
  const changed = edits.map((e, i) => (e.type === "equal" ? -1 : i)).filter((i) => i >= 0);
  // Group changes whose gap of unchanged words is small enough to share context.
  const groups: [number, number][] = [];
  for (const i of changed) {
    const last = groups.at(-1);
    if (last && i - last[1] <= 2 * CONTEXT_WORDS + 1) last[1] = i;
    else groups.push([i, i]);
  }

  let wordsRemoved = 0;
  let wordsAdded = 0;
  const hunks: Hunk[] = groups.map(([first, last]) => {
    const from = Math.max(0, first - CONTEXT_WORDS);
    const to = Math.min(edits.length - 1, last + CONTEXT_WORDS);
    const segments: Segment[] = [];
    for (let i = from; i <= to; i += 1) {
      const e = edits[i];
      const text = e.type === "insert" ? b[e.b].text : a[e.a].text;
      if (e.type === "delete") wordsRemoved += 1;
      if (e.type === "insert") wordsAdded += 1;
      const prev = segments.at(-1);
      if (prev && prev.type === e.type) prev.text += ` ${text}`;
      else segments.push({ type: e.type, text });
    }
    const firstEdit = edits[first];
    return {
      pageBefore: a[Math.min(firstEdit.a, a.length - 1)]?.page ?? 1,
      pageAfter: b[Math.min(firstEdit.b, b.length - 1)]?.page ?? 1,
      segments,
    };
  });
  return { hunks, wordsRemoved, wordsAdded };
}
