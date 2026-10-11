import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { DsrSummary, useDsrStatus } from './DsrView';
import { navigate } from './router';

const SUGGESTIONS = ['Show P&L variance', 'Open DSR pipeline', 'P&L for 2026-Q1'];

/** Global Cmd+K / Ctrl+K overlay. Commands go to the backend with the current route; DSR status is shown inline. */
export function CommandBar({ contextRoute }: { contextRoute: string }) {
  const [open, setOpen] = useState(false);
  const [command, setCommand] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setMessage(null);
      input.current?.focus();
    }
  }, [open]);

  const run = async (text: string) => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const result = await api.command(text.trim(), contextRoute);
      if (result.navigateTo) {
        navigate(result.navigateTo);
        setCommand('');
        setOpen(false);
      } else {
        setMessage('No matching view. Try “P&L”, “variance” or “DSR”.');
      }
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className="cmdk-trigger" onClick={() => setOpen(true)} aria-label="Open command bar">
        Search or command <kbd>⌘K</kbd>
      </button>
      {open && (
        <div className="cmdk-backdrop" onMouseDown={() => setOpen(false)}>
          <div className="cmdk" role="dialog" aria-label="Nexus command bar" onMouseDown={(e) => e.stopPropagation()}>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(command);
              }}
            >
              <input
                ref={input}
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="Type a command… (Enter to run, Esc to close)"
                disabled={busy}
              />
            </form>
            {message && <p className="cmdk-message">{message}</p>}
            <ul className="cmdk-suggestions">
              {SUGGESTIONS.map((s) => (
                <li key={s}>
                  <button onClick={() => void run(s)}>{s}</button>
                </li>
              ))}
            </ul>
            <DsrPanel />
            <footer className="cmdk-context">Context: {contextRoute}</footer>
          </div>
        </div>
      )}
    </>
  );
}

function DsrPanel() {
  const { status, error } = useDsrStatus();
  return (
    <div className="cmdk-dsr">
      <h3>DSR tracking</h3>
      {error && <p className="error">{error}</p>}
      {status && <DsrSummary status={status} />}
      {status?.dsrs.slice(0, 3).map((dsr) => (
        <button key={dsr.dsrId} className="cmdk-dsr-row" onClick={() => navigate(`/dsr?dsrId=${dsr.dsrId}`)}>
          DSR {dsr.dsrId.slice(0, 8)} · {dsr.stakeholderCount} stakeholders · last {new Date(dsr.lastActivityAt).toLocaleDateString()}
        </button>
      ))}
    </div>
  );
}
