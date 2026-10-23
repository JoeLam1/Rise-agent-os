import { describe, expect, it } from "vitest";
import { CONTEXT_WORDS, compareTexts, editScript, tokenize, wordKey } from "./diff";

function lcsLength(a: string[], b: string[]): number {
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i += 1)
    for (let j = 1; j <= b.length; j += 1)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  return dp[a.length][b.length];
}

describe("edit script", () => {
  it("rebuilds both sides and is minimal, on random inputs", () => {
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let round = 0; round < 300; round += 1) {
      const pick = () => Array.from({ length: Math.floor(rand() * 12) }, () => "abcd"[Math.floor(rand() * 4)]);
      const a = pick();
      const b = pick();
      const edits = editScript(a, b)!;
      const rebuiltA = edits.filter((e) => e.type !== "insert").map((e) => a[e.a]);
      const rebuiltB = edits.filter((e) => e.type !== "delete").map((e) => (e.type === "insert" ? b[e.b] : a[e.a]));
      expect(rebuiltA).toEqual(a);
      expect(rebuiltB).toEqual(b);
      expect(edits.filter((e) => e.type === "equal").length).toBe(lcsLength(a, b));
    }
  });

  it("gives up past the edit limit", () => {
    expect(editScript(["a", "b", "c"], ["x", "y", "z"], 4)).toBeNull();
  });
});

describe("comparing two documents", () => {
  it("ignores reflowed lines, page breaks and typographic quotes", () => {
    expect(compareTexts(["The Buyer’s deposit is $10,000."], ["The Buyer's deposit", "is $10,000."])).toEqual({
      status: "identical",
    });
    expect(wordKey("“done” —")).toBe('"done" -');
  });

  it("shows a changed figure with surrounding words and page numbers", () => {
    const filler = Array.from({ length: 30 }, (_, i) => `w${i}`).join(" ");
    const before = [filler, `${filler} The purchase price is $450,000 payable at closing. ${filler}`];
    const after = [filler, `${filler} The purchase price is $475,000 payable at closing. ${filler}`];
    const c = compareTexts(before, after);
    expect(c.status).toBe("changed");
    if (c.status !== "changed") return;
    expect(c.wordsRemoved).toBe(1);
    expect(c.wordsAdded).toBe(1);
    expect(c.hunks).toHaveLength(1);
    const h = c.hunks[0];
    expect(h.pageBefore).toBe(2);
    expect(h.pageAfter).toBe(2);
    expect(h.segments).toEqual([
      { type: "equal", text: "w26 w27 w28 w29 The purchase price is" },
      { type: "delete", text: "$450,000" },
      { type: "insert", text: "$475,000" },
      { type: "equal", text: "payable at closing. w0 w1 w2 w3 w4" },
    ]);
    expect(h.segments[0].text.split(" ")).toHaveLength(CONTEXT_WORDS);
  });

  it("reports added and removed clauses as separate changes when far apart", () => {
    const words = Array.from({ length: 100 }, (_, i) => `w${i}`);
    const after = [...words.slice(0, 10), "NEW", "CLAUSE", ...words.slice(10, 80), ...words.slice(85)];
    const c = compareTexts([words.join(" ")], [after.join(" ")]);
    if (c.status !== "changed") throw new Error(c.status);
    expect(c.hunks).toHaveLength(2);
    expect(c.wordsAdded).toBe(2);
    expect(c.wordsRemoved).toBe(5);
    expect(c.hunks[1].segments.find((s) => s.type === "delete")?.text).toBe("w80 w81 w82 w83 w84");
  });

  it("handles a document that grew from nothing and one that is entirely different", () => {
    const grew = compareTexts([""], ["Now there is text."]);
    expect(grew.status === "changed" && grew.wordsAdded).toBe(4);
    const a = Array.from({ length: 1000 }, (_, i) => `a${i}`).join(" ");
    const b = Array.from({ length: 1000 }, (_, i) => `b${i}`).join(" ");
    expect(compareTexts([a], [b]).status).toBe("too_different");
  });

  it("tokenizes words with the page they're on", () => {
    expect(tokenize(["one two", "", "three"])).toEqual([
      { text: "one", page: 1 },
      { text: "two", page: 1 },
      { text: "three", page: 3 },
    ]);
  });
});
