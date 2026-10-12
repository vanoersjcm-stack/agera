import { useCallback, useState } from 'react';
import { keycloak } from './auth';
import type { Scope } from './context';

interface Tip {
  title: string;
  text: string;
  links?: { label: string; href: string }[];
}

interface AssistantState {
  enabled: boolean;
  dismissed: string[];
}

/**
 * Rule-based onboarding tips, chosen from the user's scope and the current view.
 * Everything runs in the browser; the preference is kept per user in localStorage.
 */
const TIPS: Record<Scope, Record<string, Tip>> = {
  internal: {
    '/dashboard': {
      title: 'Welcome to Agera Nexus',
      text: 'The tiles summarise client contracts, sales-room engagement and open anomalies for your tenant. Press ⌘K / Ctrl+K anywhere and type e.g. “variance”, “DSR” or “anomalies” to jump to a view.',
      links: [{ label: 'Check open anomalies', href: '#/anomalies' }],
    },
    '/financials': {
      title: 'Financial projections',
      text: 'Every approved model counts towards the P&L. Pick one model to see a single client contract, or filter on a period such as 2026, 2026-Q3 or 2026-09. Variance only appears once actuals are recorded.',
    },
    '/dsr': {
      title: 'DSR activity',
      text: 'Shows stakeholder interactions in your Digital Sales Rooms. Rooms that have no activity yet are listed under Sales rooms.',
      links: [{ label: 'Open sales rooms', href: '#/rooms' }],
    },
    '/rooms': {
      title: 'Sales rooms & agreements',
      text: 'All rooms and agreements of this tenant. An active room without “opened”, “zone viewed” or “briefing played” activity for more than 7 days is reported as an anomaly.',
    },
    '/anomalies': {
      title: 'Operational anomalies',
      text: 'Three checks: P&L lines more than 10% unfavourable, rooms inactive for more than 7 days, and stores whose latest visit report is not compliant. The list refreshes every minute.',
    },
  },
  external: {
    '/dashboard': {
      title: 'Welcome to your client portal',
      text: 'You only see the sales rooms and agreements Agera shares with your organisation. Nothing is sent to you automatically; open the portal whenever you want the latest state.',
      links: [{ label: 'View my sales rooms', href: '#/rooms' }],
    },
    '/rooms': {
      title: 'Your sales rooms',
      text: 'Active rooms and your agreements with their current status. Missing a room or document? Contact your Agera account manager.',
    },
  },
};

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
    /** Turning the assistant back on shows all tips again. */
    toggle: () => update(state.enabled ? { ...state, enabled: false } : { enabled: true, dismissed: [] }),
    dismiss: (id: string) => update({ ...state, dismissed: [...new Set([...state.dismissed, id])] }),
    disable: () => update({ ...state, enabled: false }),
  };
}

export function AssistantToggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button className="assistant-toggle" aria-pressed={enabled} onClick={onToggle} title="Show or hide onboarding tips">
      Assistant: {enabled ? 'on' : 'off'}
    </button>
  );
}

export function AssistantTip({
  scope,
  path,
  assistant,
}: {
  scope: Scope;
  path: string;
  assistant: ReturnType<typeof useAssistant>;
}) {
  const tip = TIPS[scope][path];
  const id = `${scope}:${path}`;
  if (!assistant.enabled || !tip || assistant.dismissed.includes(id)) return null;
  return (
    <aside className="assistant-tip" role="note" aria-label="Onboarding tip">
      <strong>{tip.title}</strong>
      <p>{tip.text}</p>
      <div className="assistant-actions">
        {tip.links?.map((l) => (
          <a key={l.href} href={l.href}>{l.label}</a>
        ))}
        <button onClick={() => assistant.dismiss(id)}>Got it</button>
        <button className="link-dark" onClick={assistant.disable}>Turn assistant off</button>
      </div>
    </aside>
  );
}
