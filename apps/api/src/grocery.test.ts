import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createApp } from './app.ts';
import { cleanupRun } from './test-support.ts';

const app = createApp();
const run = Math.random().toString(36).slice(2, 8);
const PASSWORD = 'correct-horse-battery-staple';

const RECIPE = `---
schema: 1
title: Grocery Test Recipe
ingredients:
  - { qty: 100, unit: g, item: bread flour, group: Dough }
  - { qty: 50, unit: g, item: bread flour, group: Levain }
  - { qty: null, item: rosemary, note: for garnish }
---

Cook.
`;

type Session = { cookie: string; handle: string };

async function newUser(name: string): Promise<Session> {
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `grocery-${run}-${name}@example.test`,
      password: PASSWORD,
      name,
    }),
  });
  assert.equal(res.status, 200, await res.clone().text());
  const cookie = res.headers.get('set-cookie') ?? '';
  const me = (await (await app.request('/api/me', { headers: { Cookie: cookie } })).json()) as {
    user: { handle: string };
  };
  return { cookie, handle: me.user.handle };
}

const auth = (session: Session | null) => (session ? { Cookie: session.cookie } : {});
const json = (session: Session | null) => ({
  'Content-Type': 'application/json',
  ...auth(session),
});

async function createRecipe(session: Session, slug: string, visibility: 'public' | 'private') {
  const res = await app.request('/api/recipes', {
    method: 'POST',
    headers: json(session),
    body: JSON.stringify({ content: RECIPE, slug, visibility }),
  });
  assert.equal(res.status, 201, await res.clone().text());
}

let owner: Session;
let stranger: Session;

describe('grocery list', () => {
  before(async () => {
    owner = await newUser('owner');
    stranger = await newUser('stranger');
  });

  after(() => cleanupRun(`grocery-${run}-`));

  it('requires authentication and lazily creates a private list', async () => {
    assert.equal((await app.request('/api/me/grocery-list')).status, 401);

    const res = await app.request('/api/me/grocery-list', { headers: auth(owner) });
    assert.equal(res.status, 200);
    assert.deepEqual(((await res.json()) as { items: unknown[] }).items, []);
  });

  it('adds matching manual ingredients together, then edits and removes them', async () => {
    const first = await app.request('/api/me/grocery-list/items', {
      method: 'POST',
      headers: json(owner),
      body: JSON.stringify({
        item: 'garlic',
        amounts: [{ qty: 2, unit: 'cloves' }],
        unmeasured: false,
        notes: [],
      }),
    });
    assert.equal(first.status, 201, await first.clone().text());

    const second = await app.request('/api/me/grocery-list/items', {
      method: 'POST',
      headers: json(owner),
      body: JSON.stringify({
        item: 'Garlic',
        amounts: [{ qty: 1, unit: 'clove' }],
        unmeasured: false,
        notes: [],
      }),
    });
    assert.equal(second.status, 201);

    const list = (await (
      await app.request('/api/me/grocery-list', { headers: auth(owner) })
    ).json()) as {
      items: { id: string; amounts: { qty: number; unit?: string }[] }[];
    };
    assert.equal(list.items.length, 1);
    assert.deepEqual(list.items[0]?.amounts, [{ qty: 3, unit: 'clove' }]);

    const itemId = list.items[0]?.id;
    assert.ok(itemId);
    const privateEdit = await app.request(`/api/me/grocery-list/items/${itemId}`, {
      method: 'PATCH',
      headers: json(stranger),
      body: JSON.stringify({ amounts: [{ qty: 99, unit: 'clove' }] }),
    });
    assert.equal(privateEdit.status, 404);

    const updated = await app.request(`/api/me/grocery-list/items/${itemId}`, {
      method: 'PATCH',
      headers: json(owner),
      body: JSON.stringify({ amounts: [{ qty: 4, unit: 'clove' }] }),
    });
    assert.equal(updated.status, 200);
    assert.deepEqual(((await updated.json()) as { amounts: unknown }).amounts, [
      { qty: 4, unit: 'clove' },
    ]);

    assert.equal(
      (
        await app.request(`/api/me/grocery-list/items/${itemId}`, {
          method: 'DELETE',
          headers: auth(owner),
        })
      ).status,
      200,
    );
    assert.deepEqual(
      (
        (await (await app.request('/api/me/grocery-list', { headers: auth(owner) })).json()) as {
          items: unknown[];
        }
      ).items,
      [],
    );
  });

  it('imports authorized recipe ingredients once per version and retains merged amounts and notes', async () => {
    const slug = `transfer-${run}`;
    await createRecipe(owner, slug, 'public');

    const path = `/api/me/grocery-list/recipes/${owner.handle}/${slug}/ingredients`;
    const first = await app.request(path, {
      method: 'POST',
      headers: json(owner),
      body: JSON.stringify({ scale: 2, units: 'metric' }),
    });
    assert.equal(first.status, 200, await first.clone().text());
    const result = (await first.json()) as {
      added: boolean;
      items: { item: string; amounts: { qty: number; unit?: string }[]; unmeasuredNote?: string }[];
    };
    assert.equal(result.added, true);
    assert.deepEqual(result.items.find((item) => item.item === 'bread flour')?.amounts, [
      { qty: 300, unit: 'g' },
    ]);
    assert.equal(
      result.items.find((item) => item.item === 'rosemary')?.unmeasuredNote,
      'for garnish',
    );

    const duplicate = await app.request(path, {
      method: 'POST',
      headers: json(owner),
      body: JSON.stringify({ scale: 2, units: 'metric' }),
    });
    assert.equal(duplicate.status, 200);
    assert.equal(((await duplicate.json()) as { alreadyAdded: boolean }).alreadyAdded, true);

    const anotherScale = await app.request(path, {
      method: 'POST',
      headers: json(owner),
      body: JSON.stringify({ scale: 1, units: 'metric' }),
    });
    assert.equal(anotherScale.status, 200);
    const anotherResult = (await anotherScale.json()) as {
      added: boolean;
      items: { item: string; amounts: { qty: number; unit?: string }[] }[];
    };
    assert.equal(anotherResult.added, true);
    assert.deepEqual(anotherResult.items.find((item) => item.item === 'bread flour')?.amounts, [
      { qty: 450, unit: 'g' },
    ]);

    const privateSlug = `hidden-${run}`;
    await createRecipe(owner, privateSlug, 'private');
    const refused = await app.request(
      `/api/me/grocery-list/recipes/${owner.handle}/${privateSlug}/ingredients`,
      {
        method: 'POST',
        headers: json(stranger),
        body: JSON.stringify({ scale: 1, units: 'metric' }),
      },
    );
    assert.equal(refused.status, 404);
  });
});
