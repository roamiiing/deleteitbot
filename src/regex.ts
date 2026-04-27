export const escape = (str: string) => str.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");

export const oneOrMore = (str: string) => `(?:${str})+`;
export const zeroOrMore = (str: string) => `(?:${str})*`;
export const anyOf = (...strs: string[]) => `(?:${strs.join("|")})`;
export const sequence = (...strs: string[]) => strs.join("");
export const optional = (str: string) => `(?:${str})?`;
export const capturingGroup = (str: string) => `(${str})`;

export const NOTHING = "";
export const MARKS = `[${escape("`~!@#$%^&*()_+-={}[]|\\:;\"'<>,.?/'`’‘")}]`;

// Cyrillic letters are not handled consistently by \b in JS regexes.
export const CUSTOM_WORD_BOUNDARY = `(?:[\\s]+|${oneOrMore(MARKS)}|\\b|^|$)`;
