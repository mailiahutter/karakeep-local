/**
 * Classement d'un favori dans l'arborescence de thèmes.
 *
 * Demander à un modèle 3B d'inventer des tags donne des résultats inégaux ;
 * lui demander de choisir un numéro dans une liste fermée est une tâche d'un
 * tout autre ordre de difficulté. C'est aussi ce que l'utilisateur attend
 * réellement : retrouver « une idée d'aménagement de van », pas « un tag ».
 *
 * Module pur : testable hors appareil.
 */

export interface ClassifyOption {
  /** Numéro présenté au modèle, à partir de 1. */
  index: number;
  themeId: string;
  themeName: string;
  subthemeId: string | null;
  subthemeName: string | null;
  /**
   * Consigne de rangement, écrite par l'utilisateur. C'est elle qui lève
   * l'ambiguïté d'un intitulé : « Moto › Ma sélection » ne dit pas si l'on
   * range des motos à acheter ou des itinéraires.
   */
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

/**
 * Aplatit l'arborescence en choix numérotés.
 *
 * Un thème sans sous-thème reste choisissable ; un thème qui en a n'est
 * proposé que par ses sous-thèmes, pour éviter que le modèle range tout à la
 * racine par facilité.
 */
export function buildOptions(themes: ThemeTree[]): ClassifyOption[] {
  const options: ClassifyOption[] = [];
  let index = 1;
  for (const theme of themes) {
    if (theme.subthemes.length === 0) {
      options.push({
        index: index++,
        themeId: theme.id,
        themeName: theme.name,
        subthemeId: null,
        subthemeName: null,
        description: trimDescription(theme.description),
      });
      continue;
    }
    for (const sub of theme.subthemes) {
      options.push({
        index: index++,
        themeId: theme.id,
        themeName: theme.name,
        subthemeId: sub.id,
        subthemeName: sub.name,
        // La consigne du sous-thème l'emporte : c'est la plus précise. Celle
        // du thème sert de repli pour ses sous-thèmes non décrits.
        description:
          trimDescription(sub.description) ?? trimDescription(theme.description),
      });
    }
  }
  return options;
}

export const CLASSIFY_SYSTEM_PROMPT =
  "Tu es un assistant de classement. Tu réponds uniquement par un numéro, sans phrase, sans explication.";

export function buildClassifyPrompt(
  options: ClassifyOption[],
  title: string | null,
  content: string,
  maxContentChars = 3000,
): string {
  const list = options
    .map((o) => {
      const label = `${o.index}. ${o.themeName}${o.subthemeName ? ` › ${o.subthemeName}` : ""}`;
      return o.description ? `${label} — ${o.description}` : label;
    })
    .join("\n");

  const doc = [title ? `Titre : ${title}` : "", content.slice(0, maxContentChars)]
    .filter(Boolean)
    .join("\n");

  return `Range le DOCUMENT dans une seule de ces catégories.

${list}
0. Aucune de ces catégories

<DOCUMENT>
${doc}
</DOCUMENT>

Réponds par le seul numéro de la catégorie qui convient le mieux. Si aucune ne
correspond vraiment, réponds 0. N'écris rien d'autre que le numéro.`;
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

/** Traduit le numéro renvoyé en affectation, ou en absence d'affectation. */
export function resolveChoice(
  options: ClassifyOption[],
  choice: number | null,
): { themeId: string; subthemeId: string | null } | null {
  if (choice === null || choice === 0) return null;
  const option = options.find((o) => o.index === choice);
  if (!option) return null;
  return { themeId: option.themeId, subthemeId: option.subthemeId };
}
