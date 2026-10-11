/** Views of the Nexus shell a command can navigate to. */
export const NEXUS_INTENTS = ['open_financials', 'open_dsr', 'open_anomalies', 'unknown'] as const;
export type NexusIntent = (typeof NEXUS_INTENTS)[number];

export interface ParsedCommand {
  intent: NexusIntent;
  navigateTo: string | null;
  parameters: Record<string, string>;
}

const INTENT_KEYWORDS: { intent: Exclude<NexusIntent, 'unknown'>; route: string; keywords: RegExp }[] = [
  { intent: 'open_anomalies', route: '/anomalies', keywords: /\b(anomal\w*|alerts?|stagna\w*|exceptions?)\b/i },
  { intent: 'open_dsr', route: '/dsr', keywords: /\b(dsr|sales room|stakeholders?|engagement|deal room)\b/i },
  {
    intent: 'open_financials',
    route: '/financials',
    keywords: /(\bp&l\b|\bpnl\b|\bfinanc\w*|\bvariance\b|\bprojection\w*|\brevenue\b|\bbudget\w*|\blicen[cs]\w*)/i,
  },
];

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const PERIOD = /\b(\d{4}-(?:Q[1-4]|0[1-9]|1[0-2]))\b/i;

/** Deterministic keyword routing; no external language model is involved. */
export function parseCommand(command: string): ParsedCommand {
  const match = INTENT_KEYWORDS.find(({ keywords }) => keywords.test(command));
  if (!match) {
    return { intent: 'unknown', navigateTo: null, parameters: {} };
  }
  const parameters: Record<string, string> = {};
  const query = new URLSearchParams();
  if (match.intent === 'open_dsr') {
    const dsrId = UUID.exec(command)?.[0].toLowerCase();
    if (dsrId) {
      parameters.dsrId = dsrId;
      query.set('dsrId', dsrId);
    }
  } else if (match.intent === 'open_financials') {
    const period = PERIOD.exec(command)?.[1].toUpperCase();
    if (period) {
      parameters.period = period;
      query.set('period', period);
    }
  }
  const search = query.toString();
  return { intent: match.intent, navigateTo: search ? `${match.route}?${search}` : match.route, parameters };
}
