-- Agera Suite - V41: structured contact names for formal letters (title, initials, tussenvoegsel, suffix), gender for
-- "de heer / mevrouw", formal (default) or informal salutation, and the language letters to this contact are written in.

BEGIN;

ALTER TABLE contacts
  ADD COLUMN academic_title_prefix VARCHAR(40),
  ADD COLUMN initials              VARCHAR(20),
  ADD COLUMN surname_prefix        VARCHAR(30),
  ADD COLUMN academic_title_suffix VARCHAR(40),
  ADD COLUMN gender                VARCHAR(10) NOT NULL DEFAULT 'unknown',
  ADD COLUMN salutation_mode       VARCHAR(10) NOT NULL DEFAULT 'formal',
  ADD COLUMN letter_language       VARCHAR(2)  NOT NULL DEFAULT 'nl',
  ADD CONSTRAINT chk_contacts_gender CHECK (gender IN ('male', 'female', 'unknown')),
  ADD CONSTRAINT chk_contacts_salutation_mode CHECK (salutation_mode IN ('formal', 'informal')),
  ADD CONSTRAINT chk_contacts_letter_language CHECK (letter_language IN ('nl', 'en', 'de', 'fr'));

COMMIT;
