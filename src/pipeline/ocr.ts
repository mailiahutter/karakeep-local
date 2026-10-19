import { listAssets } from "../db/assets";
import { getOcrText, setOcrText } from "../db/ocr";
import { mergeOcr } from "../archive/ocrText";
import { hasMediaTools, recognizeText } from "../../modules/karakeep-worker/src";

/** Images lues par fiche : au-delà, le gain ne vaut plus le temps passé. */
const MAX_IMAGES = 8;

/**
 * Texte lu dans les images d'un favori, calculé une seule fois.
 *
 * Beaucoup de publications Instagram sont du texte posé sur une image — une
 * recette, une liste d'astuces, un itinéraire. La légende seule ne dit alors
 * presque rien, et le modèle rangeait à l'aveugle.
 *
 * Renvoie `null` quand la lecture est impossible (version sans module
 * natif) : la fiche sera relue plus tard, pas marquée « rien trouvé ».
 */
export async function ensureOcr(bookmarkId: string): Promise<string | null> {
  const known = await getOcrText(bookmarkId);
  if (known !== undefined) return known;
  if (!hasMediaTools()) return null;

  const images = (await listAssets(bookmarkId))
    .filter((a) => a.kind === "image")
    .slice(0, MAX_IMAGES);
  const texts: string[] = [];
  for (const image of images) {
    try {
      texts.push((await recognizeText(image.path)) ?? "");
    } catch {
      // Image illisible : on passe à la suivante.
    }
  }
  const merged = mergeOcr(texts);
  await setOcrText(bookmarkId, merged);
  return merged;
}
