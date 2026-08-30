/**
 * Classement d'un favori dans l'arborescence de thèmes.
 *
 * Le premier essai aplatissait toute l'arborescence en une liste unique — vingt
 * et une entrées avec leurs descriptions — et demandait un numéro. Deux
 * difficultés se cumulaient : tenir vingt et une définitions à la fois, et
 * décider. Un modèle de trois milliards de paramètres n'y arrive pas de façon
 * fiable, et c'est précisément le point qui compte le plus pour l'usage.
 *
 * On descend l'arbre à la place. D'abord le thème parmi six, puis le
 * sous-thème parmi trois ou quatre. Deux questions faciles valent mieux
 * qu'une question difficile, et le prompt de chacune tient en quelques lignes.
 *
 * Module pur : testable hors appareil.
 */

export interface ClassifyOption {
  /** Numéro présenté au modèle, à partir de 1. */
  index: number;
  id: string;
  name: string;
  description: string | null;
}

export interface ThemeTree {
  id: string;
  name: string;
  description?: string | null;
  subthemes: { id: string; name: string; description?: string | null }[];
}

/**
 * Une description trop longue noie la liste et éloigne le document de la
 * consigne finale. On garde une phrase.
 */
export const MAX_DESCRIPTION_CHARS = 140;

function trimDescription(raw: string | null | undefined): string | null {
  const text = (raw ?? "").replace(/\s+/g, " ").trim();
  if (text.length === 0) return null;
  return text.length <= MAX_DESCRIPTION_CHARS
    ? text
    : `${text.slice(0, MAX_DESCRIPTION_CHARS - 1).trimEnd()}…`;
}

/** Premier niveau : les grands thèmes. */
export function buildThemeOptions(themes: ThemeTree[]): ClassifyOption[] {
  return themes.map((theme, i) => ({
    index: i + 1,
    id: theme.id,
    name: theme.name,
    description: trimDescription(theme.description),
  }));
}

/**
 * Second niveau : les sous-thèmes du thème retenu.
 *
 * Le thème hérite sa description aux sous-thèmes qui n'en ont pas : sans
 * consigne, un intitulé comme « Ma sélection » ne dit rien.
 */
export function buildSubthemeOptions(theme: ThemeTree): ClassifyOption[] {
  return theme.subthemes.map((sub, i) => ({
    index: i + 1,
    id: sub.id,
    name: sub.name,
    description:
      trimDescription(sub.description) ?? trimDescription(theme.description),
  }));
}

export const CLASSIFY_SYSTEM_PROMPT =
  "Tu es un assistant de classement. Tu réponds uniquement par un numéro, " +
  "sans phrase, sans explication.";

/**
 * Construit la question posée au modèle.
 *
 * `noneLabel` change de sens d'un niveau à l'autre : au premier, zéro veut
 * dire « aucun thème ne convient » ; au second, « le thème est bon mais aucun
 * sous-thème ne va ». C'est une issue nécessaire : forcer un choix produit un
 * rangement faux, plus coûteux qu'une absence de rangement.
 */
export function buildChoicePrompt(
  options: ClassifyOption[],
  document: string,
  noneLabel: string,
): string {
  const list = options
    .map((o) => (o.description ? `${o.index}. ${o.name} — ${o.description}` : `${o.index}. ${o.name}`))
    .join("\n");

  return `Voici la description d'un lien mis de côté.

<LIEN>
${document}
</LIEN>

Dans laquelle de ces catégories le ranger ?

${list}
0. ${noneLabel}

Réponds par le seul numéro. N'écris rien d'autre.`;
}

/**
 * Lit le numéro choisi dans une réponse potentiellement bavarde.
 *
 * Un petit modèle préfixe volontiers sa réponse (« La catégorie est : 4 ») ou
 * la justifie. On prend le premier entier plausible.
 */
export function parseChoice(raw: string, maxIndex: number): number | null {
  const cleaned = raw.trim().replace(/```[a-z]*|```/gi, "");
  const match = cleaned.match(/-?\d+/);
  if (!match) return null;
  const n = Number(match[0]);
  if (!Number.isInteger(n) || n < 0 || n > maxIndex) return null;
  return n;
}

/** Traduit le numéro renvoyé en identifiant, ou en absence de choix. */
export function resolveChoice(
  options: ClassifyOption[],
  choice: number | null,
): string | null {
  if (choice === null || choice === 0) return null;
  return options.find((o) => o.index === choice)?.id ?? null;
}
