import { describe, expect, test } from "bun:test";
import { createFilter, parseWordsText } from "../src/filter";
import suite from "./filter-suite.json";

describe("filter", () => {
  const filter = createFilter(suite.bannedWords);

  test("parses startup words from plain text lines", () => {
    expect(parseWordsText("\n word \n\nsecond\n\tthird\t\n")).toEqual(["word", "second", "third"]);
  });

  test("compiles one matcher per word", () => {
    expect(filter.matchers).toHaveLength(suite.bannedWords.length);
  });

  for (const [text, replaced] of Object.entries(suite.testMessages.shouldBeBanned)) {
    test(`bans: ${text}`, () => {
      expect(filter.match(text)?.matchedEntry).toBeTruthy();
      expect(filter.redact(text)).toEqual({ isBanned: true, replaced });
    });
  }

  for (const text of suite.testMessages.shouldNotBeBanned) {
    test(`does not ban: ${text}`, () => {
      expect(filter.match(text)).toBeUndefined();
      expect(filter.redact(text)).toEqual({ isBanned: false });
    });
  }
});
