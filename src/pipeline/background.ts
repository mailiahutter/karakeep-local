import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import { AppState } from "react-native";

import { recordBackgroundRun } from "./heartbeat";
import { isQueueLockHeld } from "./lock";
import { countPendingWork } from "../db/bookmarks";
import { processPending } from "./queue";

/**
 * Reprise du traitement application fermée.
 *
 * Android confie ce réveil à WorkManager : le système choisit le moment, à
 * partir d'un intervalle minimal, et accorde au travail une fenêtre de
 * quelques minutes. Ce n'est pas un service permanent — il n'y a pas de
 * garantie à la minute près — mais c'est ce qui évite qu'un lien partagé
 * depuis Instagram, l'application aussitôt refermée, reste en attente jusqu'au
 * prochain lancement.
 *
 * Les deux étapes tournent ici. L'extraction se fait sans moteur de rendu —
 * la WebView n'existe que dans un arbre React monté — donc sans capture
 * d'écran ni archive autonome, mais avec le titre, le texte et les médias.
 * C'est ce qu'il faut au modèle pour ranger, et c'est ce qui manquait : tant
 * que l'extraction restait en attente, l'étape IA refusait de travailler et
 * un lien jamais rouvert ne pouvait pas avancer d'un pouce.
 */

export const AI_QUEUE_TASK = "karakeep-local.ai-queue";

/** Intervalle minimal accepté par WorkManager. */
const MINIMUM_INTERVAL_MINUTES = 15;

/**
 * WorkManager tue le travailleur au-delà d'une dizaine de minutes. On s'arrête
 * avant de nous-mêmes : une inférence coupée en plein vol laisserait une ligne
 * `running` orpheline — exactement le défaut que la reprise au démarrage a dû
 * réparer.
 */
const BUDGET_MS = 7 * 60_000;

TaskManager.defineTask(AI_QUEUE_TASK, async () => {
  try {
    // L'interface est prioritaire : elle traite déjà la file, et un second
    // contexte llama.cpp chargé en parallèle demanderait deux fois plusieurs
    // gigaoctets — le système en tuerait un.
    if (AppState.currentState === "active") {
      await recordBackgroundRun("Ignoré : l'application était ouverte.");
      return BackgroundTask.BackgroundTaskResult.Success;
    }
    if (await isQueueLockHeld()) {
      await recordBackgroundRun("Ignoré : un traitement était déjà en cours.");
      return BackgroundTask.BackgroundTaskResult.Success;
    }

    const before = await countPendingWork();
    if (before === 0) {
      await recordBackgroundRun("Rien à traiter.");
      return BackgroundTask.BackgroundTaskResult.Success;
    }

    await processPending({ headless: true, budgetMs: BUDGET_MS });

    const after = await countPendingWork();
    await recordBackgroundRun(
      before === after
        ? `${before} en attente, aucun n'a pu être traité.`
        : `${before - after} lien${before - after > 1 ? "s traités" : " traité"}, ${after} restant${after > 1 ? "s" : ""}.`,
    );
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (err) {
    await recordBackgroundRun(`Échec : ${(err as Error).message}`);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/**
 * Déclare la tâche auprès du système. Idempotent : l'enregistrement survit aux
 * redémarrages, le réappeler à chaque lancement ne crée pas de doublon.
 */
export async function registerAiBackgroundTask(): Promise<boolean> {
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status !== BackgroundTask.BackgroundTaskStatus.Available) return false;
    await BackgroundTask.registerTaskAsync(AI_QUEUE_TASK, {
      minimumInterval: MINIMUM_INTERVAL_MINUTES,
    });
    return true;
  } catch {
    // Un appareil qui refuse le travail d'arrière-plan ne doit pas empêcher
    // l'application de démarrer : la file tournera au premier plan.
    return false;
  }
}
