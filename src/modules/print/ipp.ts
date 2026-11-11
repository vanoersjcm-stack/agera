/** Minimal IPP/1.1 client (RFC 8010/8011) for Print-Job and Get-Printer-Attributes against CUPS; ipps:// is sent over HTTPS. */

const TAG = { operation: 0x01, job: 0x02, end: 0x03, integer: 0x21, keyword: 0x44, uri: 0x45, charset: 0x47, language: 0x48, name: 0x42, mime: 0x49 };

export interface IppResult {
  ok: boolean;
  statusCode: number;
}

/** http(s) URL used for transport and the ipp(s) URI the printer expects in printer-uri. */
export function ippEndpoints(url: string): { http: string; printerUri: string } {
  const u = new URL(url);
  const secure = u.protocol === 'ipps:' || u.protocol === 'https:';
  if (!['ipp:', 'ipps:', 'http:', 'https:'].includes(u.protocol)) throw new Error('CUPS_IPP_URL must start with ipp://, ipps://, http:// or https://');
  const port = u.port || '631';
  const rest = `${u.hostname}:${port}${u.pathname}`;
  return { http: `${secure ? 'https' : 'http'}://${rest}`, printerUri: `${secure ? 'ipps' : 'ipp'}://${rest}` };
}

function attr(tag: number, name: string, value: string | number): Buffer {
  const n = Buffer.from(name, 'utf8');
  const v = typeof value === 'number' ? Buffer.alloc(4) : Buffer.from(value, 'utf8');
  if (typeof value === 'number') v.writeInt32BE(value);
  const head = Buffer.alloc(3);
  head.writeUInt8(tag, 0);
  head.writeUInt16BE(n.length, 1);
  const len = Buffer.alloc(2);
  len.writeUInt16BE(v.length);
  return Buffer.concat([head, n, len, v]);
}

export function encodeRequest(operation: number, requestId: number, operationAttrs: Buffer[], jobAttrs: Buffer[] = []): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt8(1, 0);
  head.writeUInt8(1, 1);
  head.writeUInt16BE(operation, 2);
  head.writeInt32BE(requestId, 4);
  const parts = [head, Buffer.from([TAG.operation]), ...operationAttrs];
  if (jobAttrs.length) parts.push(Buffer.from([TAG.job]), ...jobAttrs);
  parts.push(Buffer.from([TAG.end]));
  return Buffer.concat(parts);
}

async function post(url: string, body: Buffer, timeoutMs: number): Promise<IppResult> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/ipp' }, body: new Uint8Array(body), signal: AbortSignal.timeout(timeoutMs) });
  const data = Buffer.from(await res.arrayBuffer());
  if (!res.ok || data.length < 8) return { ok: false, statusCode: res.status };
  const statusCode = data.readUInt16BE(2);
  return { ok: statusCode < 0x0100, statusCode };
}

const base = (printerUri: string, user: string) => [
  attr(TAG.charset, 'attributes-charset', 'utf-8'),
  attr(TAG.language, 'attributes-natural-language', 'en'),
  attr(TAG.uri, 'printer-uri', printerUri),
  attr(TAG.name, 'requesting-user-name', user.slice(0, 255)),
];

export function printJob(url: string, pdf: Buffer, opts: { user: string; jobName: string; copies: number }): Promise<IppResult> {
  const { http, printerUri } = ippEndpoints(url);
  const req = encodeRequest(0x0002, Math.floor(Math.random() * 2 ** 31), [...base(printerUri, opts.user), attr(TAG.name, 'job-name', opts.jobName.slice(0, 255)), attr(TAG.mime, 'document-format', 'application/pdf')], [attr(TAG.integer, 'copies', opts.copies)]);
  return post(http, Buffer.concat([req, pdf]), 60_000);
}

export function printerAttributes(url: string): Promise<IppResult> {
  const { http, printerUri } = ippEndpoints(url);
  return post(http, encodeRequest(0x000b, 1, [...base(printerUri, 'agera'), attr(TAG.keyword, 'requested-attributes', 'printer-state')]), 5_000);
}
