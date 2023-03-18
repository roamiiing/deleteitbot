import {
  anyOf,
  CUSTOM_WORD_BOUNDARY,
  escape,
  oneOrMore,
  toRegExp,
} from './regex.ts'
import cyrillicMap from './graphemes/cyrillic.json' assert { type: 'json' }
import latinMap from './graphemes/latin.json' assert { type: 'json' }

const unique = <T>(value: T, index: number, array: T[]) =>
  array.indexOf(value) === index

const GRAPHEMES_REGEX_PARTS = Object.fromEntries(
  [
    ...Object.entries(cyrillicMap.graphemes),
    ...Object.entries(latinMap.graphemes),
  ]
    .map(([grapheme, alternatives], __, all) => {
      const additionalAlternatives: string[] = []

      for (const [otherGrapheme, otherAlternatives] of all) {
        if (alternatives.includes(otherGrapheme)) {
          additionalAlternatives.push(...otherAlternatives, otherGrapheme)
        }

        if (otherAlternatives.includes(grapheme)) {
          additionalAlternatives.push(...alternatives, otherGrapheme)
        }
      }

      return [
        grapheme,
        [alternatives, additionalAlternatives].flat().filter(unique),
      ] as const
    })
    .map(([grapheme, alternatives]) => [
      grapheme,
      oneOrMore(
        anyOf(
          ...alternatives.map(escape),
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
        .map((char) => GRAPHEMES_REGEX_PARTS[char] ?? escape(char))
        .reduce((acc, cur) => acc + cur)
    )
    .map((parts) =>
      CUSTOM_WORD_BOUNDARY + oneOrMore(parts) + CUSTOM_WORD_BOUNDARY
    )

  const regex = toRegExp(anyOf(...inputs), 'i')

  return regex
}
