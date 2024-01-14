import {
  anyOf,
  capturingGroup,
  CUSTOM_WORD_BOUNDARY,
  escape,
  NOTHING,
  oneOrMore,
  optional,
  sequence,
  toRegExp,
  zeroOrMore,
} from './regex.ts'
import cyrillicMap from './graphemes/cyrillic.json' with { type: 'json' }
import latinMap from './graphemes/latin.json' with { type: 'json' }

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
          oneOrMore(
            sequence(
              index === 0 ? NOTHING : zeroOrMore(CUSTOM_WORD_BOUNDARY),
              GRAPHEMES_REGEX_PARTS[char] ?? escape(char),
              index === 0
                ? optional(
                  sequence(
                    zeroOrMore(CUSTOM_WORD_BOUNDARY),
                    GRAPHEMES_REGEX_PARTS[char] ?? escape(char),
                  ),
                )
                : NOTHING,
            ),
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
