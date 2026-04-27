import cyrillicMap from "./graphemes/cyrillic.json";
import latinMap from "./graphemes/latin.json";
import {
  anyOf,
  capturingGroup,
  CUSTOM_WORD_BOUNDARY,
  escape,
  NOTHING,
  oneOrMore,
  optional,
  sequence,
  zeroOrMore,
} from "./regex";

const unique = <T>(value: T, index: number, array: T[]) => array.indexOf(value) === index;

const GRAPHEMES_REGEX_PARTS: Record<string, string> = Object.fromEntries(
  [
    ...Object.entries(cyrillicMap.graphemes as Record<string, string[]>),
    ...Object.entries(latinMap.graphemes as Record<string, string[]>),
  ]
    .map(([grapheme, alternatives], _index, all) => {
      const additionalAlternatives: string[] = [];

      for (const [otherGrapheme, otherAlternatives] of all) {
        if (alternatives.includes(otherGrapheme)) additionalAlternatives.push(...otherAlternatives, otherGrapheme);
        if (otherAlternatives.includes(grapheme)) additionalAlternatives.push(...alternatives, otherGrapheme);
      }

      return [grapheme, [alternatives, additionalAlternatives].flat().filter(unique)] as const;
    })
    .map(([grapheme, alternatives]) => [grapheme, oneOrMore(anyOf(...alternatives.map(escape), grapheme))]),
);

export type WordMatcher = {
  word: string;
  regex: RegExp;
};

export function compileWordMatcher(word: string): WordMatcher {
  const input = word
    .split("")
    .map((char, index) =>
      oneOrMore(
        sequence(
          index === 0 ? NOTHING : zeroOrMore(CUSTOM_WORD_BOUNDARY),
          GRAPHEMES_REGEX_PARTS[char] ?? escape(char),
          index === 0
            ? optional(sequence(zeroOrMore(CUSTOM_WORD_BOUNDARY), GRAPHEMES_REGEX_PARTS[char] ?? escape(char)))
            : NOTHING,
        ),
      ),
    )
    .reduce((acc, cur) => sequence(acc, cur), "");

  return {
    word,
    regex: new RegExp(sequence(zeroOrMore(CUSTOM_WORD_BOUNDARY), capturingGroup(oneOrMore(input)), oneOrMore(CUSTOM_WORD_BOUNDARY)), "ig"),
  };
}

export function compileWordMatchers(words: string[]) {
  return words.map(compileWordMatcher);
}
