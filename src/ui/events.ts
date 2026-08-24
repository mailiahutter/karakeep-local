import { useEffect, useState } from "react";

/**
 * Signal minimal de rafraîchissement.
 *
 * Les écritures viennent de plusieurs endroits (partage, file d'arrière-plan,
 * actions de l'écran de détail) et les listes doivent se remettre à jour sans
 * qu'on ait à câbler un état global complet.
 */
const listeners = new Set<() => void>();

export function notifyBookmarksChanged(): void {
  for (const l of listeners) l();
}

/** Renvoie un compteur qui change à chaque modification des favoris. */
export function useBookmarksRevision(): number {
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const listener = () => setRevision((r) => r + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return revision;
}
