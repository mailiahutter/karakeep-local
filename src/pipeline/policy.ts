import type { AiStatus, FetchStatus } from "../db/types";

/**
 * Règles d'ordonnancement de la file, isolées du reste pour être vérifiables
 * sans appareil ni base de données.
 */

/**
 * Le tagging ne peut travailler que sur un contenu déjà extrait. Tant que
 * l'extraction n'a pas rendu son verdict, il n'y a rien à donner au modèle.
 *
 * Une extraction en erreur n'est pas bloquante : il reste au moins l'URL et le
 * titre, de quoi ranger le lien dans un thème.
 */
export function isReadyForAi(fetchStatus: FetchStatus): boolean {
  return fetchStatus !== "pending" && fetchStatus !== "running";
}

/**
 * Un travail d'arrière-plan reçoit du système une enveloppe de temps limitée.
 * Dépassée, le processus est tué net — au milieu d'une inférence, donc en
 * laissant une ligne `running` orpheline. On s'arrête avant, de nous-mêmes.
 */
export function budgetExhausted(
  startedAt: number,
  now: number,
  budgetMs: number,
): boolean {
  return now - startedAt >= budgetMs;
}

export type WorkPhase = "idle" | "fetching" | "tagging";

/**
 * Ce que l'utilisateur doit lire sur une fiche dont l'IA n'a pas encore parlé.
 *
 * Distinguer « en attente » de « en cours » n'est pas cosmétique : un favori
 * resté des heures en attente signale que la file ne tourne pas, et appelle
 * une relance manuelle. Les confondre a laissé un lien afficher « en cours de
 * génération » pendant une journée entière.
 */
export function aiWaitLabel(
  status: AiStatus,
  phase: WorkPhase,
  isCurrent: boolean,
): string | null {
  if (status === "running" || (status === "pending" && isCurrent)) {
    return "Analyse par le modèle en cours…";
  }
  if (status === "pending") {
    return phase === "idle"
      ? "En attente d'analyse. Touche « Relancer » pour la lancer maintenant."
      : "En file d'attente derrière les liens précédents.";
  }
  return null;
}

/**
 * Un cycle est-il déjà en cours ailleurs ?
 *
 * Le drapeau en mémoire ne protège que le contexte JavaScript qui le porte.
 * Or le réveil système peut démarrer son propre contexte pendant que
 * l'application tourne : deux cycles chargeraient alors deux contextes
 * llama.cpp de plusieurs gigaoctets à la fois, et l'un des deux se ferait tuer
 * par le système. Un battement horodaté en base, lisible des deux côtés,
 * tranche.
 *
 * Le seuil est large parce qu'une inférence peut légitimement durer : un
 * battement plus vieux que cela vient d'un processus mort, pas d'un processus
 * lent.
 */
export const HEARTBEAT_STALE_MS = 10 * 60_000;

export function lockIsHeld(
  heartbeat: number | null,
  now: number,
  staleMs: number = HEARTBEAT_STALE_MS,
): boolean {
  if (heartbeat === null) return false;
  // Une horloge revenue en arrière (fuseau, réglage manuel) ne doit pas
  // bloquer la file pour toujours.
  if (heartbeat > now) return false;
  return now - heartbeat < staleMs;
}

/**
 * Temps accordé à chaque inférence.
 *
 * Comprendre le sujet demande de lire la page ; choisir une catégorie ne
 * demande que de lire une phrase. Les deux n'ont pas à recevoir le même
 * budget. Le résumé, le plus coûteux, passe en dernier — s'il doit être
 * sacrifié, autant que ce soit lui.
 */
export const AI_TIMEOUTS = {
  /** « De quoi ça parle » : une phrase et des mots-clés à produire. */
  //
  // Le 4 novembre, 18 liens sont tombés en erreur sur « rien produit en
  // 60 s » avec Gemma 4 E4B : la réponse est courte, mais le modèle doit
  // d'abord lire toute la consigne — tiroirs, critères appris, exemples —
  // sur le processeur. La nuit, le temps ne manque pas ; un lien en erreur,
  // si.
  digest: 240_000,
  /** Un numéro dans une liste de six, mais une longue consigne à lire avant. */
  choice: 180_000,
  summary: 300_000,
  /**
   * Regarder les photos et écouter le son : le plus long, car chaque image
   * est lue sur le processeur avant même que le modèle commence à écrire.
   */
  perception: 480_000,
} as const;

/**
 * Au-delà de ce temps passé sur le classement et les tags, le résumé est
 * sauté. L'analyse ne tourne plus que la nuit : avec Gemma 4 E4B, le seuil
 * de 100 s faisait sauter presque tous les résumés, et la fiche gardait une
 * seule phrase — retour du 5 novembre, « il manque une description
 * précise ».
 */
export const SUMMARY_BUDGET_MS = 12 * 60_000;

export function shouldSkipSummary(
  elapsedMs: number,
  budgetMs: number = SUMMARY_BUDGET_MS,
): boolean {
  return elapsedMs >= budgetMs;
}
