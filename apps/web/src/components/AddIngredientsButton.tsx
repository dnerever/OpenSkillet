import { useMutation, useQueryClient } from '@tanstack/react-query';
import { addRecipeIngredients } from '../lib/api.ts';
import { useCurrentUser } from '../lib/session.ts';
import { SignInLink } from './SignInLink.tsx';
import { useFeedback } from './Feedback.tsx';
import { useState } from 'react';

export function AddIngredientsButton({
  handle,
  slug,
  scale,
  units,
}: {
  handle: string;
  slug: string;
  scale: number;
  units: 'metric' | 'us';
}) {
  const { user, isPending } = useCurrentUser();
  const queryClient = useQueryClient();
  const { announce } = useFeedback();
  const [added, setAdded] = useState(false);
  const add = useMutation({
    mutationFn: () => addRecipeIngredients(handle, slug, { scale, units }),
    onSuccess: async (result) => {
      setAdded(true);
      await queryClient.invalidateQueries({ queryKey: ['grocery-list'] });
      announce(
        result.alreadyAdded
          ? 'Ingredients from this recipe version are already on your grocery list.'
          : 'Ingredients added to your grocery list.',
      );
    },
  });

  if (isPending) return null;
  if (!user) {
    return (
      <SignInLink className="button secondary" reason="grocery">
        Sign in to save ingredients
      </SignInLink>
    );
  }

  return (
    <>
      <button
        type="button"
        className="secondary"
        disabled={add.isPending || added}
        onClick={() => add.mutate()}
      >
        {add.isPending
          ? 'Adding ingredients…'
          : added
            ? 'Ingredients added'
            : 'Add ingredients to grocery list'}
      </button>
      {add.isError && (
        <p className="bad" role="alert">
          Could not add these ingredients.
        </p>
      )}
    </>
  );
}
