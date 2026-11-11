import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { keycloak } from './auth';
import { availableLanguages, getLanguage, setLanguage, t, useLanguage } from './i18n';
import { Drawer, Field } from './ui';

/** Idle auto-lock: per user, in this browser. The PIN is stored only as a salted SHA-256 hash. */
interface LockSettings { minutes: number; salt: string; hash: string }

const LOCK_CHANGED = 'agera:lock-changed';
const LOCKED_FLAG = 'agera.locked';
const TIMEOUTS = [0, 5, 15, 30, 60];

function lockKey(): string {
  return `agera.lock.${(keycloak.tokenParsed?.sub as string | undefined) ?? 'anonymous'}`;
}

function readLock(): LockSettings | null {
  try {
    const s = JSON.parse(localStorage.getItem(lockKey()) ?? 'null') as LockSettings | null;
    return s && s.minutes > 0 && s.hash ? s : null;
  } catch {
    return null;
  }
}

async function hashPin(salt: string, pin: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${pin}`));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

const PIN = /^\d{4}$/;

/** Open/closed state of the Preferences drawer; survives the app remount that a language switch causes. */
const PREFS_OPEN = 'agera.preferencesOpen';
export function usePreferencesOpen(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => sessionStorage.getItem(PREFS_OPEN) === '1');
  const set = useCallback((value: boolean) => {
    if (value) sessionStorage.setItem(PREFS_OPEN, '1');
    else sessionStorage.removeItem(PREFS_OPEN);
    setOpen(value);
  }, []);
  return [open, set];
}

/** Logs out and returns to the Keycloak login screen. */
export function logout(): void {
  sessionStorage.removeItem(LOCKED_FLAG);
  sessionStorage.removeItem(PREFS_OPEN);
  void keycloak.logout({ redirectUri: `${window.location.origin}/` });
}

export function PreferencesDrawer({ onClose }: { onClose: () => void }) {
  useLanguage();
  const current = readLock();
  const [minutes, setMinutes] = useState(current?.minutes ?? 0);
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const secure = typeof crypto !== 'undefined' && !!crypto.subtle;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaved(false);
    if (minutes === 0) {
      localStorage.removeItem(lockKey());
    } else {
      if (!current || pin || confirm) {
        if (!PIN.test(pin)) return setError(t("The PIN must be exactly 4 digits."));
        if (pin !== confirm) return setError(t("The two PINs do not match."));
      }
      const salt = pin ? crypto.randomUUID() : current!.salt;
      const hash = pin ? await hashPin(salt, pin) : current!.hash;
      localStorage.setItem(lockKey(), JSON.stringify({ minutes, salt, hash } satisfies LockSettings));
    }
    setPin('');
    setConfirm('');
    setSaved(true);
    window.dispatchEvent(new Event(LOCK_CHANGED));
  };

  return (
    <Drawer title={t("Preferences")} onClose={onClose}>
      <h3>{t("Language")}</h3>
      <Field label={t("Interface language")} hint={t("Switches straight away, without reloading the page.")}>
        <select value={getLanguage()} onChange={(e) => setLanguage(e.target.value as ReturnType<typeof getLanguage>)}>
          {availableLanguages().map((l) => <option key={l.code} value={l.code} lang={l.code}>{l.name}</option>)}
        </select>
      </Field>
      <h3>{t("Auto-lock")}</h3>
      <form onSubmit={save}>
        <Field label={t("Lock the screen after inactivity")} hint={t("Applies to your login in this browser. Unlock with your 4-digit PIN.")}>
          <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} disabled={!secure}>
            {TIMEOUTS.map((m) => <option key={m} value={m}>{m === 0 ? t("Unlimited (off)") : `${m} ${t("minutes")}`}</option>)}
          </select>
        </Field>
        {!secure && <p className="muted">{t("Auto-lock needs a secure (HTTPS) connection.")}</p>}
        {minutes > 0 && (
          <>
            <Field label={current ? t("New 4-digit PIN (leave empty to keep the current one)") : t("4-digit PIN")}>
              <input type="password" inputMode="numeric" autoComplete="new-password" maxLength={4} pattern="\d{4}" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
            </Field>
            <Field label={t("Repeat PIN")}>
              <input type="password" inputMode="numeric" autoComplete="new-password" maxLength={4} pattern="\d{4}" value={confirm} onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ''))} />
            </Field>
          </>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        {saved && <p className="muted" role="status">{t("Preferences saved.")}</p>}
        <div className="form-actions">
          <button className="primary" disabled={!secure}>{t("Save")}</button>
        </div>
      </form>
    </Drawer>
  );
}

const ACTIVITY = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel', 'scroll'] as const;

/** Covers the screen after the configured idle time until the user enters their PIN. */
export function IdleLock() {
  useLanguage();
  const [settings, setSettings] = useState<LockSettings | null>(readLock);
  const [locked, setLocked] = useState(() => !!readLock() && sessionStorage.getItem(LOCKED_FLAG) === '1');
  const [pin, setPin] = useState('');
  const [wrong, setWrong] = useState(false);
  const last = useRef(Date.now());

  useEffect(() => {
    const reload = () => setSettings(readLock());
    window.addEventListener(LOCK_CHANGED, reload);
    return () => window.removeEventListener(LOCK_CHANGED, reload);
  }, []);

  const lock = useCallback(() => {
    sessionStorage.setItem(LOCKED_FLAG, '1');
    setLocked(true);
  }, []);

  useEffect(() => {
    if (!settings) return;
    const touch = () => { last.current = Date.now(); };
    ACTIVITY.forEach((e) => window.addEventListener(e, touch, { passive: true, capture: true }));
    const timer = window.setInterval(() => {
      if (Date.now() - last.current >= settings.minutes * 60_000) lock();
    }, 5_000);
    return () => {
      ACTIVITY.forEach((e) => window.removeEventListener(e, touch, { capture: true }));
      window.clearInterval(timer);
    };
  }, [settings, lock]);

  if (!settings || !locked) return null;

  const unlock = async (e: FormEvent) => {
    e.preventDefault();
    if ((await hashPin(settings.salt, pin)) === settings.hash) {
      sessionStorage.removeItem(LOCKED_FLAG);
      last.current = Date.now();
      setPin('');
      setWrong(false);
      setLocked(false);
    } else {
      setPin('');
      setWrong(true);
    }
  };

  return (
    <div className="lock-screen" role="dialog" aria-modal="true" aria-label={t("Screen locked")}>
      <form className="lock-card" onSubmit={unlock}>
        <h2>{t("Screen locked")}</h2>
        <p className="muted">{t("Enter your 4-digit PIN to continue.")}</p>
        <input autoFocus type="password" inputMode="numeric" autoComplete="off" maxLength={4} aria-label={t("PIN")} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
        {wrong && <p className="error" role="alert">{t("Wrong PIN. Try again.")}</p>}
        <button className="primary" disabled={pin.length !== 4}>{t("Unlock")}</button>
        <button type="button" className="link-button" onClick={logout}>{t("Forgot your PIN? Log out")}</button>
      </form>
    </div>
  );
}
