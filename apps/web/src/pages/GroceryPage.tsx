import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { useFeedback } from '../components/Feedback.tsx';
import { LoadFailure, Loading } from '../components/LoadState.tsx';
import { SignInLink } from '../components/SignInLink.tsx';
import {
  addGroceryItem,
  fetchGroceryList,
  removeGroceryItem,
  updateGroceryItem,
  type GroceryItem,
} from '../lib/api.ts';
import { useCurrentUser } from '../lib/session.ts';
import { useTitle } from '../lib/use-title.ts';

export function GroceryPage() {
  const { user, isPending: userPending } = useCurrentUser();
  const queryClient = useQueryClient();
  const { announce } = useFeedback();
  const [itemName, setItemName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('');
  const [note, setNote] = useState('');

  const list = useQuery({
    queryKey: ['grocery-list'],
    queryFn: fetchGroceryList,
    enabled: user !== null,
    retry: false,
  });
  useTitle('Grocery list');

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['grocery-list'] });
  const add = useMutation({
    mutationFn: addGroceryItem,
    onSuccess: async () => {
      await refresh();
      setItemName('');
      setQuantity('');
      setUnit('');
      setNote('');
      announce('Added to your grocery list.');
    },
  });
  const update = useMutation({
    mutationFn: ({ id, amounts }: { id: string; amounts: GroceryItem['amounts'] }) =>
      updateGroceryItem(id, { amounts }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: removeGroceryItem,
    onSuccess: async () => {
      await refresh();
      announce('Removed from your grocery list.');
    },
  });

  if (userPending) return <Loading shape="text" />;
  if (!user) {
    return (
      <section className="grocery-page">
        <h1>Grocery list</h1>
        <p className="muted">Sign in to keep a private grocery list synced to your account.</p>
        <SignInLink className="button" reason="grocery">
          Sign in to view your list
        </SignInLink>
      </section>
    );
  }

  if (list.isPending) return <Loading />;
  if (list.error) {
    return (
      <LoadFailure
        error={list.error}
        missing="Your grocery list could not be loaded."
        missingTitle="Grocery list unavailable"
      />
    );
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = itemName.trim();
    if (!name) return;
    const hasQuantity = quantity.trim() !== '';
    const parsedQuantity = hasQuantity ? Number(quantity) : null;
    if (parsedQuantity !== null && (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0))
      return;
    const noteText = note.trim();

    add.mutate({
      item: name,
      amounts:
        parsedQuantity === null
          ? []
          : [{ qty: parsedQuantity, ...(unit.trim() ? { unit: unit.trim() } : {}) }],
      unmeasured: parsedQuantity === null,
      ...(parsedQuantity === null && noteText ? { unmeasuredNote: noteText } : {}),
      notes: noteText ? [noteText] : [],
    });
  }

  return (
    <section className="grocery-page">
      <header className="grocery-heading">
        <div>
          <p className="eyebrow">Just for you</p>
          <h1>Grocery list</h1>
        </div>
        <span className="badge">Private</span>
      </header>
      <p className="muted">
        Add items here or bring in every ingredient from a recipe. Matching ingredients and
        compatible quantities are combined.
      </p>

      <form className="grocery-add-form" onSubmit={submit}>
        <label>
          Item
          <input
            value={itemName}
            onChange={(event) => setItemName(event.target.value)}
            maxLength={120}
            placeholder="e.g. apples"
            autoComplete="off"
            required
          />
        </label>
        <div className="grocery-measure-fields">
          <label>
            Quantity
            <input
              type="number"
              inputMode="decimal"
              min="0.01"
              step="any"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              placeholder="Optional"
            />
          </label>
          <label>
            Unit
            <input
              value={unit}
              onChange={(event) => setUnit(event.target.value)}
              maxLength={32}
              placeholder="e.g. kg"
            />
          </label>
        </div>
        <label>
          Note <span className="hint">Optional</span>
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={200}
            placeholder="e.g. ripe, if available"
          />
        </label>
        <button type="submit" disabled={!itemName.trim() || add.isPending}>
          {add.isPending ? 'Adding…' : 'Add item'}
        </button>
      </form>

      {add.isError && (
        <p className="bad" role="alert">
          Could not add that item.
        </p>
      )}
      {update.isError && (
        <p className="bad" role="alert">
          Could not save that quantity.
        </p>
      )}
      {remove.isError && (
        <p className="bad" role="alert">
          Could not remove that item.
        </p>
      )}

      {list.data.items.length === 0 ? (
        <div className="grocery-empty">
          <h2>Your list is empty</h2>
          <p className="muted">Add an item above, or use “Add ingredients” on any recipe.</p>
        </div>
      ) : (
        <ul className="grocery-items">
          {list.data.items.map((item) => (
            <GroceryItemRow
              key={item.id}
              item={item}
              onSave={(amounts) => update.mutate({ id: item.id, amounts })}
              onRemove={() => remove.mutate(item.id)}
              saving={update.isPending || remove.isPending}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function GroceryItemRow({
  item,
  onSave,
  onRemove,
  saving,
}: {
  item: GroceryItem;
  onSave: (amounts: GroceryItem['amounts']) => void;
  onRemove: () => void;
  saving: boolean;
}) {
  const [amounts, setAmounts] = useState(item.amounts);
  useEffect(() => setAmounts(item.amounts), [item.amounts]);
  const notes = item.notes.filter((note) => note !== item.unmeasuredNote);
  const annotations = [
    ...notes,
    ...(item.unmeasured && item.amounts.length > 0 ? [item.unmeasuredNote ?? 'Unmeasured'] : []),
  ];

  return (
    <li className="grocery-item">
      <div className="grocery-item-main">
        <strong>{item.item}</strong>
        {annotations.length > 0 && <span className="grocery-note">{annotations.join(' · ')}</span>}
        {item.amounts.length === 0 && (
          <span className="grocery-note">
            {item.unmeasuredNote ?? (item.unmeasured ? 'Unmeasured' : 'No quantity')}
          </span>
        )}
      </div>
      <div className="grocery-item-controls">
        {amounts.length > 0 ? (
          amounts.map((amount, index) => (
            <div className="grocery-amount" key={`${amount.unit ?? 'each'}-${index}`}>
              <label>
                <span className="sr">Quantity for {item.item}</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={amount.qty}
                  onChange={(event) =>
                    setAmounts((current) =>
                      current.map((entry, i) =>
                        i === index ? { ...entry, qty: Number(event.target.value) } : entry,
                      ),
                    )
                  }
                />
              </label>
              <label>
                <span className="sr">Unit for {item.item}</span>
                <input
                  value={amount.unit ?? ''}
                  onChange={(event) =>
                    setAmounts((current) =>
                      current.map((entry, i) =>
                        i === index
                          ? {
                              qty: entry.qty,
                              ...(event.target.value.trim() ? { unit: event.target.value } : {}),
                            }
                          : entry,
                      ),
                    )
                  }
                  placeholder="unit"
                  maxLength={32}
                />
              </label>
            </div>
          ))
        ) : (
          <button type="button" className="linkish" onClick={() => setAmounts([{ qty: 1 }])}>
            Add quantity
          </button>
        )}
        {amounts.length > 0 && (
          <button
            type="button"
            className="secondary"
            disabled={saving}
            onClick={() => onSave(amounts)}
          >
            Save
          </button>
        )}
        <button
          type="button"
          className="linkish grocery-remove"
          disabled={saving}
          aria-label={`Remove ${item.item}`}
          onClick={onRemove}
        >
          Remove
        </button>
      </div>
    </li>
  );
}
