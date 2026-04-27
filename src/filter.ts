import { compileWordMatchers, type WordMatcher } from "./graphemes";

export type MatchResult = {
  matchedEntry: string;
  matchedText: string;
};

export function parseWordsText(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function fetchWords(url: string, fetchFn: typeof fetch = fetch) {
  const response = await fetchFn(url);
  if (!response.ok) throw new Error(`Failed to fetch WORDS_URL: ${response.status} ${response.statusText}`);
  const words = parseWordsText(await response.text());
  if (words.length === 0) throw new Error("WORDS_URL returned an empty banned words list");
  return words;
}

export function createFilter(words: string[]) {
  if (words.length === 0) throw new Error("Cannot create filter from an empty banned words list");
  const matchers = compileWordMatchers(words);
  return {
    matchers,
    match: (text: string) => matchText(text, matchers),
    redact: (text: string) => redactText(text, matchers),
  };
}

export function matchText(text: string, matchers: WordMatcher[]): MatchResult | undefined {
  for (const matcher of matchers) {
    matcher.regex.lastIndex = 0;
    const match = matcher.regex.exec(text);
    if (match?.[1]) return { matchedEntry: matcher.word, matchedText: match[1] };
  }
  return undefined;
}

export function redactText(text: string, matchers: WordMatcher[]) {
  const ranges: Array<{ start: number; end: number }> = [];

  for (const matcher of matchers) {
    matcher.regex.lastIndex = 0;
    for (const match of text.matchAll(matcher.regex)) {
      const fullMatch = match[0];
      const word = match[1];
      if (!word || match.index === undefined) continue;
      const offset = fullMatch.indexOf(word);
      if (offset < 0) continue;
      ranges.push({ start: match.index + offset, end: match.index + offset + word.length });
    }
  }

  if (ranges.length === 0) return { isBanned: false as const };

  const chars = [...text];
  for (const range of mergeRanges(ranges)) {
    for (let index = range.start; index < range.end; index += 1) chars[index] = "*";
  }

  return { isBanned: true as const, replaced: chars.join("").replace(/\s+/g, " ") };
}

function mergeRanges(ranges: Array<{ start: number; end: number }>) {
  return [...ranges]
    .sort((left, right) => left.start - right.start || left.end - right.end)
    .reduce<Array<{ start: number; end: number }>>((merged, range) => {
      const previous = merged.at(-1);
      if (!previous || range.start > previous.end) {
        merged.push({ ...range });
      } else {
        previous.end = Math.max(previous.end, range.end);
      }
      return merged;
    }, []);
}
