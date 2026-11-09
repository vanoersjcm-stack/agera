import { useCallback, useState } from 'react';
import { keycloak } from './auth';
import { t, live } from './i18n';

interface Tip {
  title: string;
  text: string;
}

interface AssistantState {
  enabled: boolean;
  dismissed: string[];
}

/** Rule-based onboarding tips per page; the preference is kept per user in localStorage. */
const TIPS: Record<string, Tip> = live(() => ({
  '/symphony': {
    title: t("Welcome to Agera"),
    text: t("Use the suite switcher at the top left to move between Symphony (HQ & governance), Nexus (commercial) and RetailPower (field work). “+ New” creates any record from every page, and the search box finds stores, work orders, agreements and client rooms."),
  },
  '/nexus': {
    title: t("Nexus overview"),
    text: t("Contract value from approved financial plans, active client rooms and open alerts. Click a tile to open the list behind it."),
  },
  '/nexus/financial-plans': {
    title: t("Financial plans"),
    text: t("A plan starts as a draft. Open it to add plan lines, then approve it: only approved plans count in Profit & loss and Alerts."),
  },
  '/nexus/client-rooms': {
    title: t("Client rooms"),
    text: t("One online room per client deal. Open a room to see per contact what they did. A room without client activity for 7 days raises an alert."),
  },
  '/nexus/alerts': {
    title: t("Alerts"),
    text: t("Three checks run continuously: plan lines more than 10% unfavourable, client rooms inactive for 7+ days, and stores whose latest visit report is not compliant. An alert disappears once its cause is fixed."),
  },
  '/retailpower': {
    title: t("RetailPower overview"),
    text: t("Plan store visits, follow up on work orders and see which stores need attention."),
  },
  '/retailpower/store-visits': {
    title: t("Store visits"),
    text: t("Open a visit to walk through it step by step: start the visit, write the report with a compliance result and photos, then complete it."),
  },
  '/portal': {
    title: t("Welcome to your client portal"),
    text: t("You see the client rooms and agreements Agera shares with your organisation. Missing something? Contact your Agera account manager."),
  },
}));

function storageKey(): string {
  return `agera.assistant.${keycloak.subject ?? 'anonymous'}`;
}

function read(): AssistantState {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey()) ?? '') as Partial<AssistantState>;
    return { enabled: parsed.enabled !== false, dismissed: Array.isArray(parsed.dismissed) ? parsed.dismissed : [] };
  } catch {
    return { enabled: true, dismissed: [] };
  }
}

export function useAssistant() {
  const [state, setState] = useState<AssistantState>(read);
  const update = useCallback((next: AssistantState) => {
    localStorage.setItem(storageKey(), JSON.stringify(next));
    setState(next);
  }, []);
  return {
    enabled: state.enabled,
    dismissed: state.dismissed,
    /** Turning tips back on shows all tips again. */
    toggle: () => update(state.enabled ? { ...state, enabled: false } : { enabled: true, dismissed: [] }),
    dismiss: (id: string) => update({ ...state, dismissed: [...new Set([...state.dismissed, id])] }),
    disable: () => update({ ...state, enabled: false }),
  };
}

export function AssistantTip({ path, assistant }: { path: string; assistant: ReturnType<typeof useAssistant> }) {
  const tip = TIPS[path];
  if (!assistant.enabled || !tip || assistant.dismissed.includes(path)) return null;
  return (
    <aside className="assistant-tip" role="note" aria-label={t("Tip")}>
      <strong>{tip.title}</strong>
      <p>{tip.text}</p>
      <div className="assistant-actions">
        <button onClick={() => assistant.dismiss(path)}>{t("Got it")}</button>
        <button className="link-dark" onClick={assistant.disable}>{t("Turn tips off")}</button>
      </div>
    </aside>
  );
}
