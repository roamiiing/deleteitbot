import { anyOf, createRegExp, exactly, oneOrMore } from 'regexp'

import cyrillicMap from './graphemes/cyrillic.json' assert { type: 'json' }
import latinMap from './graphemes/latin.json' assert { type: 'json' }

const unique = <T>(value: T, index: number, array: T[]) =>
  array.indexOf(value) === index

// because cyrillic letters are considered as word boundaries
const CUSTOM_WORD_BOUNDARY = oneOrMore(anyOf(' ', '\t', '\r', '\n')).or(
  anyOf().at.lineStart(),
).or(
  anyOf().at.lineEnd(),
)

const GRAPHEMES_REGEX_PARTS = Object.fromEntries(
  [
    ...Object.entries(cyrillicMap.graphemes),
    ...Object.entries(latinMap.graphemes),
  ]
    .map(([grapheme, alternatives], __, all) => {
      const additionalAlternatives: string[] = []

      for (const [otherGrapheme, otherAlternatives] of all) {
        if (alternatives.includes(otherGrapheme)) {
          additionalAlternatives.push(...otherAlternatives)
        }

        if (otherAlternatives.includes(grapheme)) {
          additionalAlternatives.push(...alternatives)
        }
      }

      return [
        grapheme,
        [...alternatives, ...additionalAlternatives].filter(unique),
      ] as const
    })
    .map(([grapheme, alternatives]) => [
      grapheme,
      oneOrMore(
        anyOf(
          ...alternatives.map(exactly),
          grapheme,
        ),
      ),
    ]),
)

export const getGraphemedRegex = (wordsList: string[]): RegExp => {
  const inputs = wordsList
    .map((bannedWord) =>
      bannedWord
        .split('')
        .map((char) => GRAPHEMES_REGEX_PARTS[char] ?? exactly(char))
        // @ts-ignore because of the reduce type
        .reduce((acc, cur) => acc.and(cur))
    )
    .map((parts) =>
      CUSTOM_WORD_BOUNDARY.and(oneOrMore(parts)).and(CUSTOM_WORD_BOUNDARY)
    )

  return createRegExp(anyOf(...inputs), 'i')
}
