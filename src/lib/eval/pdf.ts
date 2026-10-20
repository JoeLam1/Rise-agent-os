/**
 * Builds a plain text PDF (Helvetica, US Letter) from paragraphs. Used only to
 * make the fictional evaluation contracts; real documents come from agents.
 * Text must be ASCII so the PDF text layer matches the source exactly.
 */
const LINES_PER_PAGE = 46;
const FONT_SIZE = 11;
// Usable width in points (612 wide, 60 pt margins), in ems of the font.
const LINE_EMS = 490 / FONT_SIZE;

/** Rough Helvetica advance widths in ems, rounded up so lines never run off the page. */
function ems(text: string): number {
  let w = 0;
  for (const c of text) w += /[A-Z]/.test(c) ? 0.73 : /[a-z0-9]/.test(c) ? 0.56 : c === " " ? 0.28 : 0.6;
  return w;
}

export function wrap(paragraph: string, width = LINE_EMS): string[] {
  if (paragraph === "") return [""];
  const lines: string[] = [];
  let line = "";
  for (const word of paragraph.split(/\s+/)) {
    if (line && ems(`${line} ${word}`) > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

const escape = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);

/** `"\f"` as a paragraph forces a page break. */
export function textPdf(paragraphs: string[]): Uint8Array {
  for (const p of paragraphs) {
    if (/[^\x20-\x7e\f]/.test(p)) throw new Error(`Non-ASCII text in PDF source: ${JSON.stringify(p.slice(0, 40))}`);
  }
  const pages: string[][] = [[]];
  for (const p of paragraphs) {
    if (p === "\f") {
      pages.push([]);
      continue;
    }
    for (const l of [...wrap(p), ""]) {
      if (pages.at(-1)!.length >= LINES_PER_PAGE) pages.push([]);
      pages.at(-1)!.push(l);
    }
  }

  const objs: string[] = ["<< /Type /Catalog /Pages 2 0 R >>", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  const kids: number[] = [];
  for (const lines of pages) {
    const stream = `BT /F1 ${FONT_SIZE} Tf 14 TL 60 740 Td ${lines.map((l) => `(${escape(l)}) Tj T*`).join(" ")} ET`;
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const contents = objs.length;
    objs.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contents} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`,
    );
    kids.push(objs.length);
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;

  let out = "%PDF-1.4\n";
  const offsets = objs.map((o, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}
