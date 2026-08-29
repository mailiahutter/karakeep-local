import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import { AppState } from "react-native";

import { isQueueLockHeld } from "./lock";
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
 * Seule l'étape IA tourne ici : l'extraction a besoin de la WebView de
 * `WebArchiver`, qui n'existe que dans un arbre React monté. Sans interface,
 * la file d'archivage n'aurait aucun consommateur et les demandes resteraient
 * en suspens jusqu'à expiration.
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
      return BackgroundTask.BackgroundTaskResult.Success;
    }
    if (await isQueueLockHeld()) {
      return BackgroundTask.BackgroundTaskResult.Success;
    }
    await processPending({ aiOnly: true, budgetMs: BUDGET_MS });
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
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
