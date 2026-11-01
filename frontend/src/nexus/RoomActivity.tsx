import { type FormEvent, useEffect, useState } from 'react';
import { api, type RoomActivity } from '../api';
import { keycloak } from '../auth';
import { ACTIVITY_TYPE, formatDateTime } from '../labels';
import { useShell } from '../shell';
import { ErrorText, Loading, useAction, useLoad } from '../ui';

export function myEmail(): string {
  return ((keycloak.tokenParsed?.email as string | undefined) ?? '').toLowerCase();
}

const opened = new Set<string>();

/** Records that a client contact opened the room, once per room per browser session. */
export function useRecordOpened(roomId: string, enabled: boolean): void {
  useEffect(() => {
    const key = `agera.opened.${roomId}`;
    if (!enabled || opened.has(roomId) || sessionStorage.getItem(key)) return;
    opened.add(roomId);
    sessionStorage.setItem(key, '1');
    api.recordActivity({ dsrId: roomId, stakeholderEmail: myEmail(), activityType: 'opened' }).catch(() => undefined);
  }, [roomId, enabled]);
}

function describe(a: RoomActivity): string {
  const label = ACTIVITY_TYPE[a.activityType] ?? a.activityType;
  const title = typeof a.details.agreementTitle === 'string' ? ` “${a.details.agreementTitle}”` : '';
  return `${label}${title}`;
}

/** Activity stream with comment box (§8.8 timeline / §8.9 client portal). */
export function RoomActivityPanel({ roomId, canComment }: { roomId: string; canComment: boolean }) {
  const { notify } = useShell();
  const { data, error, reload } = useLoad(() => api.activities(roomId), [roomId]);
  const [text, setText] = useState('');
  const { busy, error: sendError, run } = useAction();
  useEffect(() => {
    const timer = window.setInterval(reload, 30_000);
    return () => window.clearInterval(timer);
  }, [reload]);
  const send = (e: FormEvent) => {
    e.preventDefault();
    const message = text.trim();
    if (!message) return;
    void run(() => api.recordActivity({ dsrId: roomId, stakeholderEmail: myEmail(), activityType: 'comment', details: { text: message } })).then(
      (r) => r && (setText(''), notify('Comment posted'), reload()),
    );
  };
  return (
    <div className="card-panel">
      <h2>Comments and activity</h2>
      {canComment && (
        <form onSubmit={send} className="comment-form">
          <label className="field-label" htmlFor={`comment-${roomId}`}>Add a comment</label>
          <textarea id={`comment-${roomId}`} rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask a question or share feedback…" />
          <div className="form-actions start">
            <button type="submit" className="primary" disabled={busy || !text.trim()}>{busy ? 'Posting…' : 'Post comment'}</button>
          </div>
          <ErrorText error={sendError} />
        </form>
      )}
      {!data && <Loading error={error} />}
      {data?.length === 0 && <p className="muted">No activity yet.</p>}
      {data && data.length > 0 && (
        <ol className="timeline">
          {data.map((a) => (
            <li key={a.id}>
              <time>{formatDateTime(a.createdAt)}</time>
              <span>
                {describe(a)}
                {typeof a.details.text === 'string' && <span className="comment-text">{a.details.text}</span>}
                {typeof a.details.reason === 'string' && a.details.reason && <span className="comment-text">{a.details.reason}</span>}
              </span>
              <span className="muted">{a.stakeholderEmail}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
