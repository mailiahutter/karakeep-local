/**
 * Comparaison de versions selon les règles semver utiles ici.
 *
 * Module pur : testable hors appareil. Une erreur de comparaison ferait soit
 * manquer une mise à jour, soit proposer en boucle une version déjà installée.
 */

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  /** Identifiants de pré-version, vide pour une version stable. */
  prerelease: string[];
}

export function parseVersion(raw: string): ParsedVersion | null {
  const cleaned = raw.trim().replace(/^v/i, "");
  const match = cleaned.match(
    /^(\d+)\.(\d+)(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/,
  );
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: match[3] ? Number(match[3]) : 0,
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

function comparePrerelease(a: string[], b: string[]): number {
  // Une version stable l'emporte sur une pré-version du même numéro.
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;

  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;

    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) {
      const diff = Number(x) - Number(y);
      if (diff !== 0) return diff < 0 ? -1 : 1;
    } else if (xNum !== yNum) {
      // Un identifiant numérique est toujours inférieur à un alphanumérique.
      return xNum ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/** -1 si a < b, 0 si égales, 1 si a > b. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  // Une version illisible est traitée comme la plus ancienne, pour ne jamais
  // bloquer une mise à jour à cause d'un tag mal formé.
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;

  for (const key of ["major", "minor", "patch"] as const) {
    if (pa[key] !== pb[key]) return pa[key] < pb[key] ? -1 : 1;
  }
  return comparePrerelease(pa.prerelease, pb.prerelease);
}

export function isNewer(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}
