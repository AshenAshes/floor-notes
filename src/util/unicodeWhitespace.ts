// Unicode 15.1 White_Space Characters
const WHITESPACE_CODE_POINTS = new Set([
  0x0009, // CHARACTER TABULATION
  0x000A, // LINE FEED
  0x000B, // LINE TABULATION
  0x000C, // FORM FEED
  0x000D, // CARRIAGE RETURN
  0x0020, // SPACE
  0x0085, // NEXT LINE
  0x00A0, // NO-BREAK SPACE
  0x1680, // OGHAM SPACE MARK
  0x2000, // EN QUAD
  0x2001, // EM QUAD
  0x2002, // EN SPACE
  0x2003, // EM SPACE
  0x2004, // THREE-PER-EM SPACE
  0x2005, // FOUR-PER-EM SPACE
  0x2006, // SIX-PER-EM SPACE
  0x2007, // FIGURE SPACE
  0x2008, // PUNCTUATION SPACE
  0x2009, // THIN SPACE
  0x200A, // HAIR SPACE
  0x2028, // LINE SEPARATOR
  0x2029, // PARAGRAPH SEPARATOR
  0x202F, // NARROW NO-BREAK SPACE
  0x205F, // MEDIUM MATHEMATICAL SPACE
  0x3000  // IDEOGRAPHIC SPACE
]);

export function isUnicodeWhitespace(char: string): boolean {
  if (char.length === 0) return false;
  const code = char.codePointAt(0);
  if (code === undefined) return false;
  return WHITESPACE_CODE_POINTS.has(code);
}

export function trimUnicodeWhitespace(str: string): string {
  let start = 0;
  while (start < str.length) {
    const char = str[start]!;
    if (isUnicodeWhitespace(char)) {
      start++;
    } else {
      break;
    }
  }

  let end = str.length;
  while (end > start) {
    const char = str[end - 1]!;
    if (isUnicodeWhitespace(char)) {
      end--;
    } else {
      break;
    }
  }

  return str.substring(start, end);
}
