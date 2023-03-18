export const escape = (str: string) =>
  str.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')

export const oneOrMore = (str: string) => `(?:${str})+`

export const anyOf = (...strs: string[]) => `(?:${strs.join('|')})`

export const sequence = (...strs: string[]) => strs.join('')

export const toRegExp = (str: string, flags?: string) => new RegExp(str, flags)

export const MARKS = `[${escape('`~!@#$%^&*()_+-={}[]|\\:;"\'<>,.?/’‘')}]`

// because cyrillic letters are considered as word boundaries
export const CUSTOM_WORD_BOUNDARY = `(?:[\\s]+|${MARKS}+|^|$)`
