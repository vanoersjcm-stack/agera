/** Wave 4 (audit G22/G15): client price lists with quantity tiers, and document templates rendered into client rooms. */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { api, getToken } from './helpers.ts';

let alice: string;
let carol: string;
let clientId: string;
let storeId: string;
let productId: string;
let roomId: string;
const stamp = Date.now();

before(async () => {
  [alice, carol] = await Promise.all([getToken('alice', 'alice'), getToken('carol', 'carol')]);
  const client = await api<{ id: string }>(alice, 'POST', '/v1/clients', { name: `Pricing ${stamp}` });
  assert.equal(client.status, 201, JSON.stringify(client.body));
  clientId = client.body.id;
  storeId = (await api<{ id: string }>(alice, 'POST', '/stores', { storeCode: `PL${stamp}`.slice(0, 20), name: `Price store ${stamp}`, clientId })).body.id;
  productId = (await api<{ id: string }>(alice, 'POST', '/v1/field/products', { sku: `PL-${stamp}`, name: 'Water 1L', unitPrice: 1 })).body.id;
  const room = await api<{ id: string }>(alice, 'POST', '/v1/dsrs', { clientId, roomName: `Templates ${stamp}` });
  assert.equal(room.status, 201, JSON.stringify(room.body));
  roomId = room.body.id;
});

describe('/v1/price-lists', () => {
  it('applies the client price list with quantity tiers to field orders', async () => {
    const list = await api<{ id: string; itemCount: number; items: unknown[] }>(alice, 'POST', '/v1/price-lists', {
      name: `Contract ${stamp}`,
      clientId,
      items: [{ productId, unitPrice: 0.95 }, { productId, unitPrice: 0.8, minQuantity: 10 }],
    });
    assert.equal(list.status, 201, JSON.stringify(list.body));
    assert.equal(list.body.items.length, 2);
    const order = async (quantity: number) =>
      (await api<{ lines: { unitPrice: string }[] }>(alice, 'POST', '/v1/field/orders', { storeId, lines: [{ productId, quantity }] })).body.lines[0].unitPrice;
    assert.equal(await order(2), '0.95');
    assert.equal(await order(12), '0.80');
    await api(alice, 'PATCH', `/v1/price-lists/${list.body.id}`, { active: false });
    assert.equal(await order(12), '1.00');
    assert.equal((await api(alice, 'POST', '/v1/price-lists', { name: 'Dup', items: [{ productId, unitPrice: 1 }, { productId, unitPrice: 2 }] })).status, 400);
    assert.equal((await api(alice, 'POST', '/v1/price-lists', { name: 'Bad dates', validFrom: '2026-02-01', validTo: '2026-01-01' })).status, 400);
    assert.ok((await api<{ id: string }[]>(alice, 'GET', `/v1/price-lists?clientId=${clientId}`)).body.some((l) => l.id === list.body.id));
    assert.equal((await api(carol, 'GET', '/v1/price-lists')).status, 403);
  });
});

describe('/v1/document-templates', () => {
  it('renders placeholders and stores the result as a room document', async () => {
    const tpl = await api<{ id: string }>(alice, 'POST', '/v1/document-templates', { name: `Proposal ${stamp}`, kind: 'proposal', body: 'Dear {{client.name}},\nRoom: {{room.name}}\nVAT: {{client.vat}}' });
    assert.equal(tpl.status, 201, JSON.stringify(tpl.body));
    const listed = await api<{ placeholders: string[]; items: { id: string }[] }>(alice, 'GET', '/v1/document-templates');
    assert.ok(listed.body.placeholders.includes('client.name'));
    assert.ok(listed.body.items.some((t) => t.id === tpl.body.id));
    const preview = await api<{ text: string; missing: string[] }>(alice, 'POST', `/v1/document-templates/${tpl.body.id}/render`, { roomId });
    assert.equal(preview.status, 201, JSON.stringify(preview.body));
    assert.match(preview.body.text, new RegExp(`Dear Pricing ${stamp},`));
    assert.match(preview.body.text, new RegExp(`Room: Templates ${stamp}`));
    assert.deepEqual(preview.body.missing, ['client.vat']);
    const byClient = await api<{ text: string; missing: string[] }>(alice, 'POST', `/v1/document-templates/${tpl.body.id}/render`, { clientId });
    assert.equal(byClient.status, 201, JSON.stringify(byClient.body));
    assert.match(byClient.body.text, new RegExp(`Dear Pricing ${stamp},`));
    assert.deepEqual(byClient.body.missing.sort(), ['client.vat', 'room.name']);
    const blank = await api<{ text: string }>(alice, 'POST', `/v1/document-templates/${tpl.body.id}/render`, {});
    assert.match(blank.body.text, /Dear \[client\.name\],/);
    assert.equal((await api(alice, 'POST', `/v1/document-templates/${tpl.body.id}/render`, { clientId: '00000000-0000-4000-8000-000000000000' })).status, 404);
    const doc = await api<{ id: string; title: string; currentVersion: number }>(alice, 'POST', `/v1/nexus/client-rooms/${roomId}/documents/from-template`, { templateId: tpl.body.id });
    assert.equal(doc.status, 201, JSON.stringify(doc.body));
    assert.equal(doc.body.title, `Proposal ${stamp}`);
    assert.equal((await api(alice, 'POST', '/v1/document-templates', { name: 'x', kind: 'poem', body: 'y' })).status, 400);
    assert.equal((await api(carol, 'GET', '/v1/document-templates')).status, 403);
  });
});
