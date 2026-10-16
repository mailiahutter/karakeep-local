/**
 * Distinction entre « le réseau est tombé » et « cette page est morte ».
 *
 * Module pur : testable hors appareil.
 */

/**
 * Marques d'un échec réseau, par opposition à une page qui répond mal.
 *
 * La nuance décide du sort du lien : une coupure doit le laisser en attente,
 * une page introuvable doit le classer en erreur. Les confondre, c'est perdre
 * toute une file pour une nuit passée en mode avion.
 */
const NETWORK_MARKERS = [
  "network request failed",
  "unable to resolve host",
  "failed to connect",
  "connection abort",
  "connection reset",
  "connection refused",
  "timeout",
  "timed out",
  "aborted",
  "econnreset",
  "enotfound",
  "etimedout",
  "no address associated",
  "software caused",
  "aucune connexion",
];

export function isNetworkFailure(message: string): boolean {
  const text = message.toLowerCase();
  return NETWORK_MARKERS.some((marker) => text.includes(marker));
}
