import { z } from 'zod';
import { Hono } from 'hono';
import { db } from '../db/index.ts';
import { currentUser, requireUser, type AppEnv } from '../middleware/session.ts';
import { loadRecipe } from '../services/recipes.ts';
import {
  addGroceryItem,
  addRecipeIngredients,
  readGroceryList,
  removeGroceryItem,
  updateGroceryItem,
} from '../services/grocery.ts';
import { readBody } from './validate.ts';

const Amount = z.object({
  qty: z.number().finite().min(0).max(1_000_000),
  unit: z.string().trim().max(32).optional(),
});

const ItemFields = {
  item: z.string().trim().min(1).max(120),
  amounts: z.array(Amount).max(8),
  unmeasured: z.boolean(),
  unmeasuredNote: z.string().trim().max(200).nullable().optional(),
  notes: z.array(z.string().trim().min(1).max(200)).max(20),
};

const CreateBody = z.object({
  ...ItemFields,
  amounts: ItemFields.amounts.default([]),
  unmeasured: ItemFields.unmeasured.default(false),
  notes: ItemFields.notes.default([]),
});

const UpdateBody = z
  .object({
    amounts: ItemFields.amounts.optional(),
    unmeasured: ItemFields.unmeasured.optional(),
    unmeasuredNote: ItemFields.unmeasuredNote,
    notes: ItemFields.notes.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to update.' });

const RecipeImportBody = z.object({
  scale: z.number().finite().min(0.05).max(100).default(1),
  units: z.enum(['metric', 'us']).optional(),
});

export const groceryRoutes = new Hono<AppEnv>()
  .get('/me/grocery-list', requireUser, async (c) =>
    c.json(await readGroceryList(db, currentUser(c))),
  )

  .post('/me/grocery-list/items', requireUser, async (c) => {
    const body = await readBody(c, CreateBody);
    return c.json(await addGroceryItem(db, currentUser(c), body), 201);
  })

  .patch('/me/grocery-list/items/:itemId', requireUser, async (c) => {
    const itemId = z.uuid().parse(c.req.param('itemId'));
    const body = await readBody(c, UpdateBody);
    return c.json(await updateGroceryItem(db, currentUser(c), itemId, body));
  })

  .delete('/me/grocery-list/items/:itemId', requireUser, async (c) => {
    const itemId = z.uuid().parse(c.req.param('itemId'));
    return c.json(await removeGroceryItem(db, currentUser(c), itemId));
  })

  .post('/me/grocery-list/recipes/:handle/:slug/ingredients', requireUser, async (c) => {
    const { handle, slug } = c.req.param();
    const options = await readBody(c, RecipeImportBody);
    const loaded = await loadRecipe(db, handle, slug, c.get('viewer'));
    return c.json(await addRecipeIngredients(db, currentUser(c), loaded, options));
  });
