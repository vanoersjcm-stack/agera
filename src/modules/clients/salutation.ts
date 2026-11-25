/** Formal address lines and salutations for letters (NL, EN, DE, FR). Informal ("Beste Peter,") only when the contact asks for it. */
export const LETTER_LANGUAGES = ['nl', 'en', 'de', 'fr'] as const;
export type LetterLanguage = (typeof LETTER_LANGUAGES)[number];
export const GENDERS = ['male', 'female', 'unknown'] as const;
export type Gender = (typeof GENDERS)[number];
export const SALUTATION_MODES = ['formal', 'informal'] as const;
export type SalutationMode = (typeof SALUTATION_MODES)[number];

export interface NameParts {
  firstName: string | null;
  lastName: string | null;
  academicTitlePrefix?: string | null;
  initials?: string | null;
  surnamePrefix?: string | null;
  academicTitleSuffix?: string | null;
  gender?: Gender | null;
  salutationMode?: SalutationMode | null;
}

const join = (...parts: (string | null | undefined)[]) => parts.map((p) => p?.trim()).filter(Boolean).join(' ');

/** Dutch rule: a tussenvoegsel starts with a capital when no first name or initial precedes it ("heer Van Adrichem"). */
export function capitalisePrefix(prefix: string | null | undefined): string {
  const p = prefix?.trim() ?? '';
  return p ? p.charAt(0).toUpperCase() + p.slice(1) : '';
}

/** Academic titles only (Dr., Prof., Ir.); "Herr" / "Frau" in the prefix are part of the German form of address. */
function academicTitle(c: NameParts): string {
  return (c.academicTitlePrefix ?? '').replace(/\b(Herr|Herrn|Frau|Mr\.?|Mrs\.?|Ms\.?)\s*/gi, '').trim();
}

export function attentionLine(c: NameParts, lang: LetterLanguage): string {
  const given = c.initials?.trim() || c.firstName?.trim() || null;
  const name = join(c.academicTitlePrefix, given, c.surnamePrefix, c.lastName, c.academicTitleSuffix);
  const male = c.gender === 'male';
  const female = c.gender === 'female';
  switch (lang) {
    case 'nl': return join('t.a.v.', male ? 'de heer' : female ? 'mevrouw' : null, name);
    case 'en': return join('For the attention of', male ? 'Mr.' : female ? 'Ms.' : null, name);
    case 'de': return join('z. Hd.', male ? 'Herrn' : female ? 'Frau' : null, join(academicTitle(c), given, c.surnamePrefix, c.lastName, c.academicTitleSuffix));
    case 'fr': return join("À l'attention de", male ? 'Monsieur' : female ? 'Madame' : null, name);
  }
}

export function salutation(c: NameParts, lang: LetterLanguage): string {
  if (c.salutationMode === 'informal' && c.firstName?.trim()) {
    const first = c.firstName.trim();
    return { nl: `Beste ${first},`, en: `Dear ${first},`, de: `Hallo ${first},`, fr: `Bonjour ${first},` }[lang];
  }
  const male = c.gender === 'male';
  const female = c.gender === 'female';
  if (!c.lastName?.trim() || !(male || female)) {
    return { nl: 'Geachte heer/mevrouw,', en: 'Dear Sir or Madam,', de: 'Sehr geehrte Damen und Herren,', fr: 'Madame, Monsieur,' }[lang];
  }
  const surname = join(capitalisePrefix(c.surnamePrefix), c.lastName);
  switch (lang) {
    case 'nl': return `Geachte ${male ? 'heer' : 'mevrouw'} ${surname},`;
    case 'en': return `Dear ${male ? 'Mr.' : 'Ms.'} ${surname},`;
    case 'de': return `${male ? 'Sehr geehrter Herr' : 'Sehr geehrte Frau'} ${join(academicTitle(c), c.surnamePrefix, c.lastName)},`;
    case 'fr': return `${male ? 'Cher Monsieur' : 'Chère Madame'} ${surname},`;
  }
}

/** Full formal name without gender words, e.g. "Dr. P. van Adrichem MSc". */
export function formalName(c: NameParts): string {
  return join(c.academicTitlePrefix, c.initials?.trim() || c.firstName, c.surnamePrefix, c.lastName, c.academicTitleSuffix);
}
