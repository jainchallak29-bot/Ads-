// Project join codes: 8 characters from an alphabet without look-alikes (no I, O, 0, 1).
// 32^8 ≈ 1.1 trillion combinations.

export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 8;

export function generateCode(randomBytes: (n: number) => Uint8Array): string {
  const bytes = randomBytes(CODE_LENGTH);
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return s;
}

/** "abcd-2345 " → "ABCD2345" */
export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function formatCode(code: string): string {
  const c = normalizeCode(code);
  return c.length === 8 ? c.slice(0, 4) + '-' + c.slice(4) : c;
}

export function isValidCode(input: string): boolean {
  const c = normalizeCode(input);
  return c.length === CODE_LENGTH && [...c].every((ch) => CODE_ALPHABET.includes(ch));
}
