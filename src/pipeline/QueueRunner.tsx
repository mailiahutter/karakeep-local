import { useEffect } from "react";
import { AppState } from "react-native";

import { registerAiBackgroundTask } from "./background";
import { processPending } from "./queue";
import { notifyBookmarksChanged } from "../ui/events";

/**
 * Moteur de la file, monté une fois dans la mise en page racine.
 *
 * Auparavant le traitement n'était lancé que par la mise au point de l'onglet
 * d'accueil. Arriver directement sur une fiche, ou revenir dans l'application
 * sur un autre onglet, ne relançait donc rien : un lien pouvait rester en
 * attente indéfiniment alors même que l'application était ouverte devant
 * l'utilisateur.
 */
export function QueueRunner() {
  useEffect(() => {
    const kick = () => {
      void processPending().then(notifyBookmarksChanged);
    };

    kick();
    void registerAiBackgroundTask();

    // Le retour au premier plan est le moment où le travail suspendu par la
    // mise en veille doit repartir.
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") kick();
    });
    return () => sub.remove();
  }, []);

  return null;
}
