import { useEffect, useState } from 'react';

/** Chrome/Edge event that lets the app offer its own "Install Agera" button. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** Registers the service worker (HTTPS only) and remembers the browser's install prompt. */
export function initInstallableApp(): void {
  if (import.meta.env.PROD && window.isSecureContext && 'serviceWorker' in navigator) {
    void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
}

/** True while the browser allows installing Agera and it is not already running as an installed app. */
export function useCanInstall(): boolean {
  const [can, setCan] = useState(deferred !== null);
  useEffect(() => {
    const update = () => setCan(deferred !== null);
    listeners.add(update);
    return () => void listeners.delete(update);
  }, []);
  return can;
}

export async function installApp(): Promise<void> {
  if (!deferred) return;
  await deferred.prompt();
  await deferred.userChoice;
  deferred = null;
  notify();
}
