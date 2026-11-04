import { useEffect, useState } from 'react';

export type Language = 'en' | 'nl';
const KEY = 'agera.language';
const EVENT = 'agera:language';

/** Dutch translations of the interface. Keys are the English text; anything missing stays English. */
const NL: Record<string, string> = {
  // Suites and navigation
  Overview: 'Overzicht', 'Account health': 'Accountgezondheid', 'Activity log': 'Activiteitenlog', Agreements: 'Overeenkomsten', Alerts: 'Meldingen',
  Approvals: 'Goedkeuringen', 'Audit rounds': 'Auditrondes', Automations: 'Automatiseringen', 'Client dossiers': 'Klantdossiers', 'Client rooms': 'Klantrooms',
  Clients: 'Klanten', 'Credit control': 'Kredietbeheer', 'Deal pipeline': 'Dealpijplijn', Deals: 'Deals', 'Document templates': 'Documentsjablonen',
  Exceptions: 'Uitzonderingen', 'Field calendar': 'Veldkalender', 'Field orders': 'Veldorders', 'Financial plans': 'Financiële plannen', Integrations: 'Integratiesleutels', 'External systems': 'Externe systemen',
  Invoices: 'Facturen', 'My agreements': 'Mijn overeenkomsten', 'My client rooms': 'Mijn klantrooms', Organisations: 'Organisaties', 'People & access': 'Mensen & toegang',
  Planograms: 'Planogrammen', 'Price lists': 'Prijslijsten', Products: 'Producten', 'Profit & loss': 'Winst & verlies', Prognosis: 'Prognose', Reports: 'Rapportages',
  'Store visits': 'Winkelbezoeken', Stores: 'Winkels', 'Work orders': 'Werkorders', 'Report builder': 'Rapportbouwer', 'Agera Platform': 'Agera Platform',
  // Shell
  'Search…': 'Zoeken…', '+ New': '+ Nieuw', 'Log out': 'Uitloggen', 'Show page tips': 'Paginatips tonen', 'Hide page tips': 'Paginatips verbergen',
  'Database connected': 'Database verbonden', 'All clients': 'Alle klanten', 'Show all clients': 'Alle klanten tonen', 'Lists show only': 'Lijsten tonen alleen',
  'Take the Golden Thread tour': 'Golden Thread-rondleiding starten', 'Language: English': 'Taal: Engels', 'Language: Nederlands': 'Taal: Nederlands',
  'Back to my organisation': 'Terug naar mijn organisatie', 'View as Vanguard': 'Bekijken als Vanguard', 'View as Enterprise (Symphony)': 'Bekijken als Enterprise (Symphony)',
  'Stop edition preview': 'Editievoorbeeld stoppen', Notifications: 'Meldingen', 'Mark all as read': 'Alles als gelezen markeren',
  // Common actions and states
  Cancel: 'Annuleren', 'Saving…': 'Opslaan…', Save: 'Opslaan', Edit: 'Bewerken', Delete: 'Verwijderen', Remove: 'Verwijderen', Back: 'Terug', 'Back to list': 'Terug naar lijst',
  Next: 'Volgende', Previous: 'Vorige', Close: 'Sluiten', Finish: 'Afronden', Active: 'Actief', Inactive: 'Inactief', Paused: 'Gepauzeerd', All: 'Alle', Open: 'Open',
  Draft: 'Concept', Submitted: 'Ingediend', Confirmed: 'Bevestigd', Delivered: 'Geleverd', Resolved: 'Opgelost', 'In progress': 'In behandeling', Planned: 'Gepland',
  Completed: 'Afgerond', Cancelled: 'Geannuleerd', Pending: 'In afwachting', Approved: 'Goedgekeurd', Rejected: 'Afgewezen', 'Loading…': 'Laden…',
  'Not connected': 'Niet gekoppeld', 'Enterprise tier required': 'Enterprise-editie vereist', 'Master data': 'Stamgegevens', 'Financials & run-rate': 'Financiën & run-rate',
  'Open linked client room': 'Gekoppelde klantroom openen', 'Run report': 'Rapport uitvoeren', 'CSV export': 'CSV-export', 'Open report builder': 'Rapportbouwer openen',
  '+ New automation': '+ Nieuwe automatisering', '+ New price list': '+ Nieuwe prijslijst', '+ New template': '+ Nieuw sjabloon', '+ Upload document': '+ Document uploaden',
  'Generate from template…': 'Genereren uit sjabloon…', Activate: 'Activeren', Deactivate: 'Deactiveren', Pause: 'Pauzeren', 'Recent runs': 'Recente uitvoeringen',
  Rule: 'Regel', Documents: 'Documenten', 'Action plan': 'Actieplan', 'No data yet.': 'Nog geen gegevens.',
};

export function getLanguage(): Language {
  return localStorage.getItem(KEY) === 'nl' ? 'nl' : 'en';
}

export function setLanguage(language: Language): void {
  localStorage.setItem(KEY, language);
  document.documentElement.lang = language;
  window.dispatchEvent(new Event(EVENT));
}

/** Translate a fixed interface text; unknown texts (and record names) are returned unchanged. */
export function t(text: string): string {
  return getLanguage() === 'nl' ? (NL[text] ?? text) : text;
}

/** Re-renders the caller when the language changes. */
export function useLanguage(): Language {
  const [language, set] = useState(getLanguage);
  useEffect(() => {
    const sync = () => set(getLanguage());
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  return language;
}

export const TRANSLATED_COUNT = Object.keys(NL).length;
