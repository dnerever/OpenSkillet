import {
  buildShoppingList,
  convertFrontmatter,
  detectSystem,
  mergeShoppingItems,
  scaleFrontmatter,
  type MeasurementSystem,
  type ShoppingItem,
} from '@openskillet/core';
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import {
  groceryImports,
  groceryItems,
  groceryLists,
  type GroceryItem,
  type User,
} from '../db/schema.ts';
import { NotFoundError } from './authorization.ts';
import type { LoadedRecipe } from './recipes.ts';

export type GroceryItemInput = Omit<ShoppingItem, 'item' | 'unmeasuredNote'> & {
  item: string;
  unmeasuredNote?: string | null;
};

async function getOrCreateList(db: Db, ownerId: string) {
  await db.insert(groceryLists).values({ ownerId }).onConflictDoNothing();
  const [list] = await db
    .select()
    .from(groceryLists)
    .where(eq(groceryLists.ownerId, ownerId))
    .limit(1);
  if (!list) throw new Error('grocery list was not created');
  return list;
}

async function lockList(db: Db, ownerId: string) {
  const list = await getOrCreateList(db, ownerId);
  const [locked] = await db
    .select()
    .from(groceryLists)
    .where(eq(groceryLists.id, list.id))
    .for('update');
  if (!locked) throw new Error('grocery list disappeared while locking');
  return locked;
}

export async function readGroceryList(db: Db, actor: User) {
  const list = await getOrCreateList(db, actor.id);
  const items = await db
    .select()
    .from(groceryItems)
    .where(eq(groceryItems.listId, list.id))
    .orderBy(groceryItems.createdAt, groceryItems.id);
  return serializeGroceryList(list, items);
}

export async function addGroceryItem(db: Db, actor: User, input: GroceryItemInput) {
  return db.transaction(async (tx) => {
    const list = await lockList(tx as unknown as Db, actor.id);
    const [existing] = await tx
      .select()
      .from(groceryItems)
      .where(
        and(
          eq(groceryItems.listId, list.id),
          sql`lower(${groceryItems.item}) = lower(${input.item})`,
        ),
      )
      .limit(1);

    let saved: GroceryItem;
    if (existing) {
      const [merged] = mergeShoppingItems([toShoppingItem(existing), fromInput(input)]);
      if (!merged) throw new Error('grocery item merge returned nothing');
      const [updated] = await tx
        .update(groceryItems)
        .set({ ...fromShoppingItem(merged), updatedAt: new Date() })
        .where(eq(groceryItems.id, existing.id))
        .returning();
      if (!updated) throw new Error('grocery item update returned nothing');
      saved = updated;
    } else {
      const [inserted] = await tx
        .insert(groceryItems)
        .values({ listId: list.id, ...fromInput(input) })
        .returning();
      if (!inserted) throw new Error('grocery item insert returned nothing');
      saved = inserted;
    }

    await tx
      .update(groceryLists)
      .set({ updatedAt: new Date() })
      .where(eq(groceryLists.id, list.id));
    return serializeGroceryItem(saved);
  });
}

export async function updateGroceryItem(
  db: Db,
  actor: User,
  itemId: string,
  input: Partial<GroceryItemInput>,
) {
  const list = await getOrCreateList(db, actor.id);
  const patch: Partial<typeof groceryItems.$inferInsert> = { updatedAt: new Date() };
  if (input.amounts !== undefined) patch.amounts = input.amounts;
  if (input.unmeasured !== undefined) patch.unmeasured = input.unmeasured;
  if (input.unmeasuredNote !== undefined) patch.unmeasuredNote = input.unmeasuredNote || null;
  if (input.notes !== undefined) patch.notes = input.notes;

  const [updated] = await db
    .update(groceryItems)
    .set(patch)
    .where(and(eq(groceryItems.id, itemId), eq(groceryItems.listId, list.id)))
    .returning();
  if (!updated) throw new NotFoundError();

  await db.update(groceryLists).set({ updatedAt: new Date() }).where(eq(groceryLists.id, list.id));
  return serializeGroceryItem(updated);
}

export async function removeGroceryItem(db: Db, actor: User, itemId: string) {
  const list = await getOrCreateList(db, actor.id);
  const [removed] = await db
    .delete(groceryItems)
    .where(and(eq(groceryItems.id, itemId), eq(groceryItems.listId, list.id)))
    .returning({ id: groceryItems.id });
  if (!removed) throw new NotFoundError();

  await db.update(groceryLists).set({ updatedAt: new Date() }).where(eq(groceryLists.id, list.id));
  return { removed: true as const, id: removed.id };
}

export async function addRecipeIngredients(
  db: Db,
  actor: User,
  loaded: LoadedRecipe,
  options: { scale?: number; units?: MeasurementSystem } = {},
) {
  const scale = options.scale ?? 1;
  const scaled = scaleFrontmatter(loaded.doc.frontmatter, scale);
  const units = options.units ?? detectSystem(loaded.doc.frontmatter);
  const visible =
    units === detectSystem(loaded.doc.frontmatter) ? scaled : convertFrontmatter(scaled, units);
  const ingredients = buildShoppingList(visible);
  const scaleKey = scale.toFixed(4);

  return db.transaction(async (tx) => {
    const list = await lockList(tx as unknown as Db, actor.id);
    const [claimed] = await tx
      .insert(groceryImports)
      .values({
        listId: list.id,
        recipeId: loaded.recipe.id,
        versionId: loaded.version.id,
        scaleKey,
      })
      .onConflictDoNothing()
      .returning({ versionId: groceryImports.versionId });

    if (!claimed) {
      const items = await tx.select().from(groceryItems).where(eq(groceryItems.listId, list.id));
      return {
        added: false as const,
        alreadyAdded: true as const,
        items: items.map(serializeGroceryItem),
      };
    }

    for (const ingredient of ingredients) {
      const [existing] = await tx
        .select()
        .from(groceryItems)
        .where(
          and(
            eq(groceryItems.listId, list.id),
            sql`lower(${groceryItems.item}) = lower(${ingredient.item})`,
          ),
        )
        .limit(1);

      if (existing) {
        const [merged] = mergeShoppingItems([toShoppingItem(existing), ingredient]);
        if (!merged) throw new Error('grocery item merge returned nothing');
        await tx
          .update(groceryItems)
          .set({ ...fromShoppingItem(merged), updatedAt: new Date() })
          .where(eq(groceryItems.id, existing.id));
      } else {
        await tx.insert(groceryItems).values({ listId: list.id, ...fromShoppingItem(ingredient) });
      }
    }

    await tx
      .update(groceryLists)
      .set({ updatedAt: new Date() })
      .where(eq(groceryLists.id, list.id));
    const items = await tx.select().from(groceryItems).where(eq(groceryItems.listId, list.id));
    return {
      added: true as const,
      alreadyAdded: false as const,
      items: items.map(serializeGroceryItem),
    };
  });
}

function toShoppingItem(item: GroceryItem): ShoppingItem {
  return {
    item: item.item,
    amounts: item.amounts,
    unmeasured: item.unmeasured,
    ...(item.unmeasuredNote === null ? {} : { unmeasuredNote: item.unmeasuredNote }),
    notes: item.notes,
  };
}

function fromShoppingItem(item: ShoppingItem) {
  return {
    item: item.item,
    amounts: item.amounts,
    unmeasured: item.unmeasured,
    unmeasuredNote: item.unmeasuredNote ?? null,
    notes: item.notes,
  };
}

function fromInput(item: GroceryItemInput): ShoppingItem {
  return {
    item: item.item,
    amounts: item.amounts,
    unmeasured: item.unmeasured,
    ...(item.unmeasuredNote ? { unmeasuredNote: item.unmeasuredNote } : {}),
    notes: item.notes,
  };
}

function serializeGroceryItem(item: GroceryItem) {
  return {
    id: item.id,
    ...toShoppingItem(item),
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

function serializeGroceryList(
  list: Awaited<ReturnType<typeof getOrCreateList>>,
  items: GroceryItem[],
) {
  return {
    id: list.id,
    updatedAt: list.updatedAt.toISOString(),
    items: items.map(serializeGroceryItem),
  };
}
