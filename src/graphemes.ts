import {
  anyOf,
  capturingGroup,
  CUSTOM_WORD_BOUNDARY,
  escape,
  NOTHING,
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
        .map((char, index) =>
          sequence(
            index > 0 ? zeroOrMore(CUSTOM_WORD_BOUNDARY) : NOTHING,
            GRAPHEMES_REGEX_PARTS[char] ?? escape(char),
          )
        )
        .reduce((acc, cur) => sequence(acc, cur))
    )

  const regex = toRegExp(
    sequence(
      zeroOrMore(CUSTOM_WORD_BOUNDARY),
      capturingGroup(
        oneOrMore(anyOf(...inputs)),
      ),
      oneOrMore(CUSTOM_WORD_BOUNDARY),
    ),
    'ig',
  )

  return regex
}
