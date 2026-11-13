import { type CSSProperties, type KeyboardEvent, type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { t, useLanguage } from './i18n';
import type { NavItem, NavTopic as Topic } from './suites';

const OPEN_DELAY = 120;
const CLOSE_DELAY = 250;
const FOCUSABLE = 'a[href], button:not([disabled]), input, summary';
let closeOpenTopic: (() => void) | null = null;

/** A suite home (e.g. /symphony) only matches itself, otherwise every screen without its own menu item lights up Overview. */
function isSuiteHome(path: string): boolean {
  return path.split('/').filter(Boolean).length === 1;
}

function activeItem(items: NavItem[], path: string): NavItem | undefined {
  return items.filter((i) => path === i.path || (!isSuiteHome(i.path) && path.startsWith(`${i.path}/`))).sort((a, b) => b.path.length - a.path.length)[0];
}

/** Flyouts start below the sticky top bars, so their title is never hidden behind them. */
const barsBottom = () => Math.max(8, ...Array.from(document.querySelectorAll('.topbar, .actionbar')).map((el) => el.getBoundingClientRect().bottom + 6));

const hoverCapable = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;

/** One menu topic: hover (mouse) or tap/click (touch) opens a single flyout panel beside the menu. */
export function NavTopic({ label, active = false, className, children }: { label: string; active?: boolean; className?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<CSSProperties>({});
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const panelId = useId();

  const hide = () => {
    window.clearTimeout(timer.current);
    setOpen(false);
  };
  const show = (focusFirst = false) => {
    window.clearTimeout(timer.current);
    if (closeOpenTopic && closeOpenTopic !== hide) closeOpenTopic();
    closeOpenTopic = hide;
    const r = trigger.current?.getBoundingClientRect();
    if (r) {
      const rtl = document.documentElement.dir === 'rtl';
      if (window.innerWidth <= 900) setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - 308)) });
      else setPos({ top: Math.max(barsBottom(), r.top - 6), ...(rtl ? { right: window.innerWidth - r.left + 6 } : { left: r.right + 6 }) });
    }
    setOpen(true);
    if (focusFirst) window.setTimeout(() => panel.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus(), 0);
  };

  useLayoutEffect(() => {
    const el = panel.current;
    if (!open || !el) return undefined;
    const minTop = window.innerWidth <= 900 ? 8 : barsBottom();
    el.style.maxHeight = `${window.innerHeight - minTop - 8}px`;
    const overflow = el.getBoundingClientRect().bottom - (window.innerHeight - 8);
    if (overflow > 0) el.style.top = `${Math.max(minTop, el.getBoundingClientRect().top - overflow)}px`;
    return undefined;
  }, [open, pos]);

  useEffect(() => {
    if (!open) return undefined;
    const outside = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) hide();
    };
    const away = () => hide();
    document.addEventListener('pointerdown', outside);
    window.addEventListener('hashchange', away);
    window.addEventListener('resize', away);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('hashchange', away);
      window.removeEventListener('resize', away);
    };
  }, [open]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const onTriggerKey = (e: KeyboardEvent) => {
    const forward = document.documentElement.dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
    if (e.key === forward || e.key === 'ArrowDown') {
      e.preventDefault();
      show(true);
    } else if (e.key === 'Escape') hide();
  };
  const onPanelKey = (e: KeyboardEvent) => {
    const back = document.documentElement.dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
    if (e.key === 'Escape' || (e.key === back && (e.target as HTMLElement).tagName !== 'INPUT')) {
      e.preventDefault();
      hide();
      trigger.current?.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const all = Array.from(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter((el) => el.offsetParent !== null);
      const i = all.indexOf(document.activeElement as HTMLElement);
      const next = all[(i + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length];
      if (next) {
        e.preventDefault();
        next.focus();
      }
    }
  };

  return (
    <div
      ref={wrap}
      className={['nav-topic', active && 'active', open && 'open', className].filter(Boolean).join(' ')}
      onMouseEnter={() => {
        if (!hoverCapable()) return;
        window.clearTimeout(timer.current);
        if (!open) timer.current = window.setTimeout(() => show(), OPEN_DELAY);
      }}
      onMouseLeave={() => {
        if (!hoverCapable()) return;
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => {
          const focused = document.activeElement;
          if (focused instanceof HTMLInputElement && wrap.current?.contains(focused)) return;
          hide();
        }, CLOSE_DELAY);
      }}
      onBlur={(e) => {
        if (open && e.relatedTarget && !wrap.current?.contains(e.relatedTarget as Node)) hide();
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="nav-topic-trigger"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => (open && !hoverCapable() ? hide() : show())}
        onKeyDown={onTriggerKey}
      >
        <span>{label}</span>
        <span className="nav-topic-caret" aria-hidden>›</span>
      </button>
      {open && (
        <div id={panelId} ref={panel} className="nav-flyout" role="group" aria-label={label} style={pos} onKeyDown={onPanelKey}>
          <div className="nav-flyout-title">{label}</div>
          {children}
        </div>
      )}
    </div>
  );
}

function FlyoutLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <a href={`#${item.path}`} className={active ? 'flyout-link active' : 'flyout-link'} aria-current={active ? 'page' : undefined}>
      <strong>{t(item.label)}</strong>
      <span>{t(item.description)}</span>
    </a>
  );
}

/** Suite menu: a short list of topics (or plain links for small menus such as the client portal). */
export function SideNav({ items, topics, path, heading, children }: { items?: NavItem[]; topics?: Topic[]; path: string; heading: string; children?: ReactNode }) {
  useLanguage();
  const active = activeItem(topics ? topics.flatMap((tp) => tp.items) : items ?? [], path);
  const link = (i: NavItem, label = t(i.label)) => (
    <a key={i.path} href={`#${i.path}`} className={i === active ? 'active' : undefined} title={i.description} aria-current={i === active ? 'page' : undefined}>
      {label}
    </a>
  );
  return (
    <nav className="sidenav" aria-label={`${heading} navigation`}>
      <span className="sidenav-heading">{heading}</span>
      {topics
        ? topics.map((tp) =>
            tp.items.length === 1 && (tp.id === 'overview' || tp.id === 'thirdparties' || tp.id === 'rackjobbing') ? (
              link(tp.items[0], tp.label)
            ) : (
              <NavTopic key={tp.id} label={tp.label} active={!!active && tp.items.includes(active)}>
                {tp.items.map((i) => <FlyoutLink key={i.path} item={i} active={i === active} />)}
              </NavTopic>
            ),
          )
        : (items ?? []).map((i) => link(i))}
      {children}
    </nav>
  );
}

/** Every topic with its screens, so nothing in the flyout menu has to be guessed. */
export function SuiteMap({ topics }: { topics: Topic[] }) {
  useLanguage();
  return (
    <section className="card suite-map" aria-label={t("All topics")}>
      <h2>{t("All topics")}</h2>
      <div className="suite-map-grid">
        {topics.map((tp) => (
          <div key={tp.id}>
            <h3>{tp.label}</h3>
            <ul>
              {tp.items.map((i) => (
                <li key={i.path}>
                  <a href={`#${i.path}`}>{t(i.label)}</a>
                  <span>{t(i.description)}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
