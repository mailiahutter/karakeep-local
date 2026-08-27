import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { captureRef } from "react-native-view-shot";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import { buildInjectedScript } from "./inject";
import {
  JOB_TIMEOUT_MS,
  setWorker,
  takeNext,
  type ArchiveJob,
} from "./queue";
import type { ArchiveResult, RenderedPage } from "./types";

/**
 * WebView hors écran qui rend les pages avant extraction.
 *
 * C'est le remplaçant du Chrome sans interface de Karakeep. Le moteur de rendu
 * d'Android exécute le JavaScript du site, puis un script injecté renvoie le
 * DOM rendu, une archive autonome, et de quoi capturer l'écran.
 *
 * Monté une seule fois dans la mise en page racine, il traite les demandes une
 * par une : deux rendus simultanés se disputeraient la mémoire.
 */

/** Laisser au JavaScript de la page le temps de peupler le DOM après `load`. */
const SETTLE_MS = 2500;

/** Hauteur de rendu : assez grande pour une capture de page longue. */
const VIEWPORT = { width: 1024, height: 3000 };

const MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";

interface Active {
  job: ArchiveJob;
  timer: ReturnType<typeof setTimeout>;
  settled: boolean;
}

export function WebArchiver() {
  const [current, setCurrent] = useState<ArchiveJob | null>(null);
  const active = useRef<Active | null>(null);
  const webviewRef = useRef<WebView>(null);
  const shotRef = useRef<View>(null);

  const finish = useCallback(
    (outcome: { result?: ArchiveResult; error?: Error }) => {
      const running = active.current;
      if (!running) return;
      clearTimeout(running.timer);
      active.current = null;

      if (outcome.error) running.job.reject(outcome.error);
      else if (outcome.result) running.job.resolve(outcome.result);

      // Libère la WebView avant la demande suivante : sans démontage, une page
      // lourde garde sa mémoire et la suivante peut échouer.
      setCurrent(null);
    },
    [],
  );

  const pump = useCallback(() => {
    if (active.current) return;
    const job = takeNext();
    if (!job) return;

    const timer = setTimeout(() => {
      finish({ error: new Error(`Rendu abandonné après ${JOB_TIMEOUT_MS / 1000} s`) });
    }, JOB_TIMEOUT_MS);

    active.current = { job, timer, settled: false };
    setCurrent(job);
  }, [finish]);

  useEffect(() => {
    setWorker(pump);
    pump();
    return () => setWorker(null);
  }, [pump]);

  // Une demande peut arriver pendant qu'une autre se termine.
  useEffect(() => {
    if (!current) pump();
  }, [current, pump]);

  const onMessage = useCallback(
    async (event: WebViewMessageEvent) => {
      const running = active.current;
      if (!running || running.settled) return;
      running.settled = true;

      let payload: {
        ok: boolean;
        error?: string;
        data?: RenderedPage;
        archive?: string | null;
        archiveError?: string;
      };
      try {
        payload = JSON.parse(event.nativeEvent.data);
      } catch {
        finish({ error: new Error("Réponse illisible de la page") });
        return;
      }

      if (!payload.ok || !payload.data) {
        finish({ error: new Error(payload.error ?? "Extraction impossible") });
        return;
      }

      const result: ArchiveResult = {
        page: payload.data,
        archiveHtml: payload.archive ?? null,
      };
      if (payload.archiveError) result.archiveError = payload.archiveError;

      // La capture doit être prise tant que la WebView affiche encore la page.
      if (running.job.wantScreenshot && shotRef.current) {
        try {
          result.screenshotUri = await captureRef(shotRef, {
            format: "jpg",
            quality: 0.8,
            result: "tmpfile",
          });
        } catch {
          // Une capture manquée ne justifie pas de perdre tout le reste.
        }
      }

      finish({ result });
    },
    [finish],
  );

  const onLoadEnd = useCallback(() => {
    const running = active.current;
    if (!running) return;
    // Le script s'exécute après un délai de stabilisation : `load` se déclenche
    // souvent avant que le JavaScript du site ait rempli la page.
    setTimeout(() => {
      if (!active.current || active.current.job.id !== running.job.id) return;
      webviewRef.current?.injectJavaScript(
        buildInjectedScript({
          maxResourceBytes: 3 * 1024 * 1024,
          maxTotalBytes: 12 * 1024 * 1024,
          wantArchive: running.job.wantArchive,
          sourceKind: running.job.sourceKind,
        }),
      );
    }, SETTLE_MS + running.job.extraSettleMs);
  }, []);

  if (!current) return null;

  return (
    <View style={styles.offscreen} pointerEvents="none" collapsable={false}>
      <View ref={shotRef} style={styles.canvas} collapsable={false}>
        <WebView
          ref={webviewRef}
          source={{ uri: current.url }}
          userAgent={MOBILE_UA}
          onLoadEnd={onLoadEnd}
          onMessage={onMessage}
          onError={() =>
            finish({ error: new Error("La page n'a pas pu être chargée") })
          }
          onHttpError={(e) =>
            finish({
              error: new Error(
                `Le serveur a répondu ${e.nativeEvent.statusCode}`,
              ),
            })
          }
          javaScriptEnabled
          domStorageEnabled
          // Sans ça, le script ne peut pas lire les feuilles de style servies
          // depuis un autre domaine, ce qui est le cas courant.
          originWhitelist={["*"]}
          mixedContentMode="always"
          cacheEnabled={false}
          thirdPartyCookiesEnabled={false}
          style={styles.canvas}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Hors du champ visible plutôt que `display: none` : une vue non rendue ne
  // peut être ni photographiée ni mise en page par le moteur.
  offscreen: {
    position: "absolute",
    left: -10000,
    top: 0,
    width: VIEWPORT.width,
    height: VIEWPORT.height,
    opacity: 0,
  },
  canvas: { width: VIEWPORT.width, height: VIEWPORT.height },
});
