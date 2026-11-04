import { AppRegistry } from "react-native";

import { countPendingWork, pendingSnapshot, retryFailedAnalyses } from "../db/bookmarks";
import { recordBackgroundRun } from "./heartbeat";
import { isQueueLockHeld } from "./lock";
import { isProcessing, processPending } from "./queue";
import { exitReasonLabel, exitReasons, isCharging } from "../../modules/karakeep-worker/src";
import { getDb } from "../db/client";
import { notifyIfUpdateAvailable } from "../update/notify";

/**
 * Travail exécuté par le service au premier plan, sans interface.
 *
 * Android démarre ici le moteur JavaScript dans un processus qui n'affiche
 * rien. C'est le même pipeline que celui de l'interface — extraction sans
 * moteur de rendu, puis analyse par le modèle — et c'est volontaire :
 * dupliquer la logique aurait garanti deux comportements divergents.
 *
 * La séance s'arrête d'elle-même quand il n'y a plus rien à faire. Le service
 * natif impose par ailleurs sa propre borne, Android limitant un service
 * `dataSync` à six heures par jour.
 */

export const HEADLESS_TASK = "KarakeepWork";

/** Marges sous les bornes du service natif (5 h la nuit, 20 min le jour). */
const NIGHT_BUDGET_MS = 4 * 60 * 60_000 + 50 * 60_000;
const DAY_BUDGET_MS = 18 * 60_000;

interface SessionData {
  /** `night` : séance programmée ; `day` : passage de jour ; `share` : après un partage. */
  kind?: "night" | "day" | "share";
  charging?: boolean;
}

export async function runHeadlessSession(data: SessionData = {}): Promise<void> {
  const kind = data.kind ?? "night";
  // Une correction publiée ne sert à rien tant qu'elle n'est pas installée.
  const announced = await notifyIfUpdateAvailable().catch(() => null);
  if (announced) await recordBackgroundRun(`Nouvelle version ${announced} disponible : notification envoyée.`);
  // Deux contextes llama.cpp chargés en même temps, ce sont dix gigaoctets
  // demandés d'un coup : le système en tuerait un. L'interface est
  // prioritaire, elle traite déjà la file.
  //
  // Plutôt que d'abandonner, on attend que l'autre cycle ait fini : le
  // service au premier plan garde le processus en vie pendant ce temps.
  // Abandonner, c'était laisser Android tuer l'application dès que
  // l'utilisateur revenait à Instagram, au milieu de la lecture de la page.
  const waitUntil = Date.now() + (kind === "night" ? 30 : 15) * 60_000;
  while (isProcessing() || (await isQueueLockHeld())) {
    if (Date.now() > waitUntil) {
      await recordBackgroundRun("Séance ignorée : un autre traitement ne se termine pas.");
      return;
    }
    await new Promise((r) => setTimeout(r, 5_000));
  }

  // La nuit, sur secteur, les analyses en échec retentent leur chance : une
  // panne d'un soir ne doit pas condamner un lien pour toujours.
  if (kind === "night" && isCharging()) {
    const retried = await retryFailedAnalyses().catch(() => 0);
    if (retried > 0) await recordBackgroundRun(`${retried} analyse(s) en échec remise(s) en file pour cette nuit.`);
  }

  const before = await countPendingWork();
  if (before === 0) {
    await recordBackgroundRun(`Séance (${kind}) : rien à traiter — ${await pendingSnapshot()}.`);
    return;
  }

  await noteInterruptedSession();
  await markSession({ kind, at: Date.now() });

  const label = kind === "night" ? "Séance de nuit" : kind === "day" ? "Passage de jour" : "Après partage";
  // L'analyse ne tourne que la nuit, sur secteur ; le reste du temps, on lit
  // seulement les pages. Débrancher en pleine nuit l'arrête aussitôt.
  const analyse = kind === "night" && isCharging();
  await recordBackgroundRun(
    `${label} démarré(e) — ${await pendingSnapshot()}${
      analyse ? "" : kind === "night" ? " — téléphone sur batterie : lecture des pages seulement, analyse reportée" : " — lecture des pages seulement"
    }.`,
  );
  try {
    await processPending({
      headless: true,
      budgetMs: kind === "night" ? NIGHT_BUDGET_MS : DAY_BUDGET_MS,
      analyse,
      stopAnalysis: () => !isCharging(),
    });
    const after = await countPendingWork();
    await recordBackgroundRun(
      before === after
        ? `${label} terminé(e) sans progrès, ${after} toujours en attente.`
        : `${label} : ${before - after} traité(s), ${after} restant(s).`,
    );
  } catch (err) {
    await recordBackgroundRun(`Séance interrompue : ${(err as Error).message}`);
    throw err;
  } finally {
    await markSession(null);
  }
}

/**
 * Séance ouverte et jamais refermée : le processus a été tué en route.
 *
 * Le 4 novembre, la séance de nuit s'est arrêtée vers 4 h 30 sans un mot
 * dans le journal. La séance suivante le constate et dit pourquoi, quand
 * Android le sait (manque de mémoire le plus souvent).
 */
const SESSION_KEY = "session.open";

async function markSession(value: { kind: string; at: number } | null): Promise<void> {
  try {
    const db = await getDb();
    if (value === null) await db.runAsync("DELETE FROM settings WHERE key = ?", [SESSION_KEY]);
    else
      await db.runAsync(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [SESSION_KEY, JSON.stringify(value)],
      );
  } catch {
    // Diagnostic seulement.
  }
}

async function noteInterruptedSession(): Promise<void> {
  try {
    const db = await getDb();
    const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = ?", [SESSION_KEY]);
    if (!row) return;
    const open = JSON.parse(row.value) as { kind: string; at: number };
    const exit = exitReasons().find((e) => e.at >= open.at);
    const at = (ts: number) =>
      new Date(ts).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    await recordBackgroundRun(
      `La séance (${open.kind}) de ${at(open.at)} s'est arrêtée sans finir${
        exit ? ` — Android, à ${at(exit.at)} : ${exitReasonLabel(exit.reason)}` : ""
      }. Elle reprend.`,
    );
  } catch {
    // Diagnostic seulement.
  }
}

/**
 * Déclaration à l'évaluation du module, et non dans une fonction appelée
 * ensuite : les imports étant hissés, un appel écrit après eux s'exécuterait
 * après l'enregistrement du composant racine. Quand le service démarre le
 * moteur sans interface, aucun écran n'est monté — une tâche déclarée depuis
 * un composant n'existerait tout simplement pas.
 */
AppRegistry.registerHeadlessTask(HEADLESS_TASK, () => (data: SessionData) => runHeadlessSession(data ?? {}));
