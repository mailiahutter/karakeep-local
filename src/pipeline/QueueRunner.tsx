import { useEffect } from "react";
import { AppState } from "react-native";

import { scheduleDailyWork, scheduledWindow } from "../../modules/karakeep-worker/src";
import { registerAiBackgroundTask } from "./background";
import { parseWindow } from "./schedule";
import { processPending } from "./queue";
import { loadSettings } from "../db/settings";
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

    // L'alarme ne survit ni à une réinstallation ni à un effacement des
    // données ; le réglage, lui, part avec la sauvegarde. On réaligne les
    // deux au lancement plutôt que de laisser la séance disparaître en
    // silence.
    void (async () => {
      const { nightlyWork } = await loadSettings();
      const wanted = parseWindow(nightlyWork);
      if (wanted && !scheduledWindow()) {
        scheduleDailyWork(wanted.hour, wanted.minute);
      }
    })();

    // Le retour au premier plan est le moment où le travail suspendu par la
    // mise en veille doit repartir.
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") kick();
    });
    return () => sub.remove();
  }, []);

  return null;
}
