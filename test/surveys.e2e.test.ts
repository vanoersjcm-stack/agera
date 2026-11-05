/**
 * Survey & feedback engine: design, Vanguard limits (402), dispatch, portal responses and analytics.
 * dave is an External_Client of client C2 in Acme Test (alice's organisation).
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { ACME_TEST, api, getToken, tierLock } from './helpers.ts';

interface Survey { id: string; status: string; responseCount: number; nps: number | null }
interface Analytics {
  totalResponses: number; targetedClients: number; respondedClients: number; responseRate: number | null;
  nps: { score: number | null; promoters: number; passives: number; detractors: number; count: number };
  questions: { id: string; distribution?: Record<string, number>; texts?: string[]; average?: number | null }[];
  respondents: { clientId: string; npsScore: number | null }[];
}

let alice: string;
let dave: string;
let devAdmin: string;
let c2: string;
const created: string[] = [];

const QUESTIONS = [
  { id: 'nps', type: 'nps', label: 'How likely are you to recommend us?', required: true },
  { id: 'csat', type: 'csat', label: 'How satisfied are you?', required: false },
  { id: 'why', type: 'text', label: 'Why?', required: false },
];

before(async () => {
  [alice, dave, devAdmin] = await Promise.all([getToken('alice', 'alice'), getToken('dave', 'dave'), getToken('dev.admin', 'devadmin')]);
  const payload = JSON.parse(Buffer.from(dave.split('.')[1], 'base64url').toString()) as { client_id: string };
  c2 = payload.client_id;
});

after(async () => {
  for (const id of created) await api(alice, 'PATCH', `/v1/surveys/${id}/status`, { status: 'closed' });
});

async function newSurvey(title: string, questions: unknown[] = QUESTIONS): Promise<string> {
  const r = await api<Survey>(alice, 'POST', '/v1/surveys', { title, questions });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  created.push(r.body.id);
  return r.body.id;
}

describe('surveys', () => {
  it('validates questions and only edits questions of drafts', async () => {
    assert.equal((await api(alice, 'POST', '/v1/surveys', { title: 'x', questions: [{ id: 'a', type: 'single_choice', label: 'Pick', options: ['only'] }] })).status, 400);
    assert.equal((await api(alice, 'POST', '/v1/surveys', { title: 'x', questions: [{ id: 'a', type: 'text', label: 'A', showIf: { questionId: 'b', equals: 'x' } }] })).status, 400);
    const id = await newSurvey(`Draft ${Date.now()}`);
    assert.equal((await api(alice, 'PATCH', `/v1/surveys/${id}`, { questions: [...QUESTIONS, { id: 'more', type: 'text', label: 'More' }] })).status, 200);
    assert.equal((await api(alice, 'PATCH', `/v1/surveys/${id}/status`, { status: 'active' })).status, 200);
    assert.equal((await api(alice, 'PATCH', `/v1/surveys/${id}`, { questions: QUESTIONS })).status, 409);
    assert.equal((await api(alice, 'PATCH', `/v1/surveys/${id}/status`, { status: 'draft' })).status, 409);
    assert.equal((await api(devAdmin, 'GET', `/v1/surveys/${id}`)).status, 404);
    assert.equal((await api(dave, 'GET', '/v1/surveys')).status, 403);
  });

  it('dispatches to a client, takes portal responses once and computes NPS', async () => {
    const id = await newSurvey(`Feedback ${Date.now()}`);
    assert.equal((await api(alice, 'POST', `/v1/surveys/${id}/dispatch`, { targetType: 'single_client', clientId: c2 })).status, 409);
    await api(alice, 'PATCH', `/v1/surveys/${id}/status`, { status: 'active' });
    assert.ok(!(await api<{ id: string }[]>(dave, 'GET', '/v1/portal/surveys')).body.some((s) => s.id === id));

    const preview = await api<{ clients: number; contacts: number }>(alice, 'POST', '/v1/surveys/audience', { targetType: 'single_client', clientId: c2 });
    assert.equal(preview.status, 200);
    assert.equal(preview.body.clients, 1);
    const sent = await api<{ totalTargeted: number }>(alice, 'POST', `/v1/surveys/${id}/dispatch`, { targetType: 'single_client', clientId: c2 });
    assert.equal(sent.status, 201);
    assert.equal(sent.body.totalTargeted, 1);

    const pending = await api<{ id: string; answered: boolean }[]>(dave, 'GET', '/v1/portal/surveys');
    assert.equal(pending.body.find((s) => s.id === id)?.answered, false);
    assert.equal((await api(dave, 'POST', `/v1/portal/surveys/${id}/respond`, { answers: { csat: 4 } })).status, 400);
    assert.equal((await api(dave, 'POST', `/v1/portal/surveys/${id}/respond`, { answers: { nps: 11 } })).status, 400);
    const r = await api<{ npsScore: number }>(dave, 'POST', `/v1/portal/surveys/${id}/respond`, { answers: { nps: 10, csat: 4, why: 'Fast field team' } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.npsScore, 10);
    assert.equal((await api(dave, 'POST', `/v1/portal/surveys/${id}/respond`, { answers: { nps: 3 } })).status, 409);
    assert.equal((await api<{ id: string; answered: boolean }[]>(dave, 'GET', '/v1/portal/surveys')).body.find((s) => s.id === id)?.answered, true);

    const a = await api<Analytics>(alice, 'GET', `/v1/surveys/${id}/analytics`);
    assert.equal(a.status, 200);
    assert.equal(a.body.totalResponses, 1);
    assert.equal(a.body.targetedClients, 1);
    assert.equal(a.body.responseRate, 100);
    assert.deepEqual(a.body.nps, { score: 100, promoters: 1, passives: 0, detractors: 0, count: 1 });
    assert.equal(a.body.questions.find((q) => q.id === 'csat')?.distribution?.['4'], 1);
    assert.deepEqual(a.body.questions.find((q) => q.id === 'why')?.texts, ['Fast field team']);
    assert.equal(a.body.respondents[0].clientId, c2);

    const csv = await fetch(`${process.env.API_URL ?? 'http://localhost:3000'}/v1/surveys/${id}/export`, { headers: { Authorization: `Bearer ${alice}` } });
    assert.equal(csv.status, 200);
    assert.match(await csv.text(), /Fast field team/);

    const health = await api<{ clientId: string; surveyNps: number | null }[]>(alice, 'GET', '/v1/clients-health');
    assert.notEqual(health.body.find((h) => h.clientId === c2)?.surveyNps, null);

    await api(alice, 'PATCH', `/v1/surveys/${id}/status`, { status: 'closed' });
    assert.equal((await api(dave, 'POST', `/v1/portal/surveys/${id}/respond`, { answers: { nps: 5 } })).status, 404);
  });

  it('skips hidden branch questions and dispatches to a cohort (Enterprise)', async () => {
    const id = await newSurvey(`Branching ${Date.now()}`, [
      { id: 'happy', type: 'single_choice', label: 'Happy?', required: true, options: ['Yes', 'No'] },
      { id: 'fix', type: 'text', label: 'What should we fix?', required: true, showIf: { questionId: 'happy', equals: 'No' } },
    ]);
    await api(alice, 'PATCH', `/v1/surveys/${id}/status`, { status: 'active' });
    const all = await api<{ totalTargeted: number }>(alice, 'POST', `/v1/surveys/${id}/dispatch`, { targetType: 'client_cohort', all: true });
    assert.equal(all.status, 201);
    assert.ok(all.body.totalTargeted >= 1);
    assert.equal((await api(dave, 'POST', `/v1/portal/surveys/${id}/respond`, { answers: { happy: 'No' } })).status, 400);
    assert.equal((await api(dave, 'POST', `/v1/portal/surveys/${id}/respond`, { answers: { happy: 'Yes', fix: 'ignored' } })).status, 201);
    const a = await api<Analytics>(alice, 'GET', `/v1/surveys/${id}/analytics`);
    assert.equal(a.body.questions.find((q) => q.id === 'fix')?.texts?.length, 0);
    assert.equal((await api(alice, 'POST', '/v1/surveys/audience', { targetType: 'client_cohort', minArr: 999999999 })).status, 200);
  });

  it('limits Vanguard to 3 active surveys, basic question types and no cohort filters', async () => {
    const admin = await getToken('dev.admin', 'devadmin');
    const release = await tierLock(ACME_TEST);
    try {
      const ids = await Promise.all([1, 2, 3, 4].map((n) => newSurvey(`Vanguard ${n} ${Date.now()}`)));
      const before = (await api<Survey[]>(alice, 'GET', '/v1/surveys')).body as unknown as { items: Survey[] };
      for (const s of before.items.filter((x) => x.status === 'active')) await api(alice, 'PATCH', `/v1/surveys/${s.id}/status`, { status: 'closed' });
      assert.equal((await api(admin, 'PATCH', `/tenants/${ACME_TEST}/license`, { licenseTier: 'vanguard' })).status, 200);
      try {
        for (const id of ids.slice(0, 3)) assert.equal((await api(alice, 'PATCH', `/v1/surveys/${id}/status`, { status: 'active' })).status, 200);
        const fourth = await api<{ message: string }>(alice, 'PATCH', `/v1/surveys/${ids[3]}/status`, { status: 'active' });
        assert.equal(fourth.status, 402);
        assert.match(fourth.body.message, /Enterprise tier required/);
        assert.equal((await api(alice, 'POST', '/v1/surveys', { title: 'Choice', questions: [{ id: 'a', type: 'single_choice', label: 'A', options: ['x', 'y'] }] })).status, 402);
        assert.equal((await api(alice, 'POST', '/v1/surveys', { title: 'Branch', questions: [{ id: 'a', type: 'nps', label: 'A' }, { id: 'b', type: 'text', label: 'B', showIf: { questionId: 'a', equals: '3' } }] })).status, 402);
        assert.equal((await api(alice, 'POST', '/v1/surveys/audience', { targetType: 'client_cohort', sector: 'Retail' })).status, 402);
        assert.equal((await api(alice, 'POST', '/v1/surveys/audience', { targetType: 'client_cohort', all: true })).status, 200);
        assert.equal((await api(alice, 'GET', `/v1/surveys/${ids[0]}/analytics?sector=Retail`)).status, 402);
      } finally {
        await api(admin, 'PATCH', `/tenants/${ACME_TEST}/license`, { licenseTier: 'symphony' });
      }
    } finally {
      release();
    }
  });
});
