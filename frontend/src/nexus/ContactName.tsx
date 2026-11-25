import type { Contact } from '../api';
import { t as tr } from '../i18n';
import { Field } from '../ui';

export type Gender = 'male' | 'female' | 'unknown';
export type SalutationMode = 'formal' | 'informal';
export type LetterLanguage = 'nl' | 'en' | 'de' | 'fr';

export interface ContactNameForm {
  academicTitlePrefix: string;
  initials: string;
  surnamePrefix: string;
  academicTitleSuffix: string;
  gender: Gender;
  salutationMode: SalutationMode;
  letterLanguage: LetterLanguage;
}

export function contactNameForm(c?: Contact): ContactNameForm {
  return {
    academicTitlePrefix: c?.academicTitlePrefix ?? '',
    initials: c?.initials ?? '',
    surnamePrefix: c?.surnamePrefix ?? '',
    academicTitleSuffix: c?.academicTitleSuffix ?? '',
    gender: c?.gender ?? 'unknown',
    salutationMode: c?.salutationMode ?? 'formal',
    letterLanguage: c?.letterLanguage ?? 'nl',
  };
}

export function contactNameBody(f: ContactNameForm) {
  const opt = (v: string) => v.trim() || null;
  return {
    academicTitlePrefix: opt(f.academicTitlePrefix), initials: opt(f.initials), surnamePrefix: opt(f.surnamePrefix),
    academicTitleSuffix: opt(f.academicTitleSuffix), gender: f.gender, salutationMode: f.salutationMode, letterLanguage: f.letterLanguage,
  };
}

/** Structured name parts used in letter address blocks and the formal salutation. */
export function ContactNameFields({ value, onChange }: { value: ContactNameForm; onChange: (v: ContactNameForm) => void }) {
  const set = <K extends keyof ContactNameForm>(k: K) => (e: { target: { value: string } }) => onChange({ ...value, [k]: e.target.value as ContactNameForm[K] });
  return (
    <fieldset className="contact-name">
      <legend>{tr("Name in letters")}</legend>
      <div className="form-row">
        <Field label={tr("Title before the name")} hint={tr("e.g. Dr., Ir., Drs., Herr Dr.")}><input maxLength={40} value={value.academicTitlePrefix} onChange={set('academicTitlePrefix')} /></Field>
        <Field label={tr("Initials")} hint={tr("e.g. P.")}><input maxLength={20} value={value.initials} onChange={set('initials')} /></Field>
      </div>
      <div className="form-row">
        <Field label={tr("Surname prefix")} hint={tr("e.g. van, van der, de")}><input maxLength={30} value={value.surnamePrefix} onChange={set('surnamePrefix')} /></Field>
        <Field label={tr("Title after the name")} hint={tr("e.g. PhD, MSc")}><input maxLength={40} value={value.academicTitleSuffix} onChange={set('academicTitleSuffix')} /></Field>
      </div>
      <div className="form-row">
        <Field label={tr("Form of address")}>
          <select value={value.gender} onChange={set('gender')}>
            <option value="male">{tr("Mr. (de heer)")}</option>
            <option value="female">{tr("Ms. (mevrouw)")}</option>
            <option value="unknown">{tr("Not specified (Dear Sir or Madam)")}</option>
          </select>
        </Field>
        <Field label={tr("Salutation")}>
          <select value={value.salutationMode} onChange={set('salutationMode')}>
            <option value="formal">{tr("Formal (Geachte heer Van Adrichem)")}</option>
            <option value="informal">{tr("Informal (Beste Peter)")}</option>
          </select>
        </Field>
        <Field label={tr("Letter language")}>
          <select value={value.letterLanguage} onChange={set('letterLanguage')}>
            <option value="nl">Nederlands</option>
            <option value="en">English</option>
            <option value="de">Deutsch</option>
            <option value="fr">Français</option>
          </select>
        </Field>
      </div>
    </fieldset>
  );
}
