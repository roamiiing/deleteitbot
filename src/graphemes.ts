import {
  anyOf,
  CUSTOM_WORD_BOUNDARY,
  escape,
  oneOrMore,
  sequence,
  toRegExp,
  zeroOrMore,
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
    .map((word) =>
      word
        .split('')
        .map((char) =>
          sequence(
            zeroOrMore(CUSTOM_WORD_BOUNDARY),
            GRAPHEMES_REGEX_PARTS[char] ?? escape(char),
            zeroOrMore(CUSTOM_WORD_BOUNDARY),
          )
        )
        .reduce((acc, cur) => sequence(acc, cur))
    )
    .map((parts) =>
      sequence(
        oneOrMore(CUSTOM_WORD_BOUNDARY),
        oneOrMore(parts),
        oneOrMore(CUSTOM_WORD_BOUNDARY),
      )
    )

  const regex = toRegExp(anyOf(...inputs), 'i')

  return regex
}
