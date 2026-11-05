import { useShareIntentContext } from "expo-share-intent";
import { useEffect, useRef } from "react";
import { ToastAndroid } from "react-native";

import { createBookmark } from "../db/bookmarks";
import { extractUrl } from "../db/urls";
import { processPending } from "../pipeline/queue";
import { returnToPreviousApp, startWorker } from "../../modules/karakeep-worker/src";
import { notifyBookmarksChanged } from "./events";

/**
 * Reçoit les liens partagés depuis les autres applications.
 *
 * C'est le chemin d'entrée principal : depuis le navigateur, un lecteur RSS ou
 * un client mail, « Partager → Karakeep Local » enregistre la page. L'écriture
 * en base est immédiate ; l'extraction et le tagging suivent en arrière-plan
 * pour que la feuille de partage se referme sans attente.
 */
export function ShareIntentHandler() {
  const { hasShareIntent, shareIntent, resetShareIntent } =
    useShareIntentContext();
  // Le contexte peut redéclencher le rendu avec le même partage : sans garde,
  // un lien serait traité plusieurs fois.
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!hasShareIntent) return;

    const raw = shareIntent.webUrl ?? shareIntent.text ?? "";
    if (!raw) {
      resetShareIntent();
      return;
    }
    if (handled.current === raw) return;
    handled.current = raw;

    const url = extractUrl(raw);
    if (!url) {
      ToastAndroid.show("Aucun lien trouvé dans le partage", ToastAndroid.SHORT);
      resetShareIntent();
      return;
    }

    void (async () => {
      try {
        const { created } = await createBookmark(url);
        ToastAndroid.show(
          created ? "Lien enregistré" : "Lien déjà enregistré",
          ToastAndroid.SHORT,
        );
        notifyBookmarksChanged();
        // Le service au premier plan finit la lecture de la page même si
        // l'on revient aussitôt à Instagram — ce qui est le cas presque à
        // chaque fois. Sans lui, Android tuait l'application en pleine
        // capture et le lien restait « en attente ».
        if (startWorker("share")) {
          // Retour à Instagram aussitôt le lien enregistré : le service
          // finit la lecture de la page sans nous. Un court délai laisse le
          // message « Lien enregistré » s'afficher.
          setTimeout(() => returnToPreviousApp(), 700);
        } else {
          await processPending();
          notifyBookmarksChanged();
        }
      } catch (err) {
        ToastAndroid.show(
          `Échec de l'enregistrement : ${(err as Error).message}`,
          ToastAndroid.LONG,
        );
      } finally {
        resetShareIntent();
        handled.current = null;
      }
    })();
  }, [hasShareIntent, shareIntent, resetShareIntent]);

  return null;
}
