package expo.modules.karakeepworker

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import android.os.PowerManager
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Pont entre l'application et le service de travail.
 *
 * Volontairement minimal : démarrer, arrêter, programmer une séance. Toute la
 * logique de traitement reste en JavaScript, partagée avec l'interface —
 * dupliquer le pipeline en Kotlin aurait garanti deux comportements
 * divergents.
 */
class KarakeepWorkerModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "Contexte React indisponible" }

  override fun definition() = ModuleDefinition {
    Name("KarakeepWorker")

    /** Démarre une séance tout de suite. */
    Function("start") { kind: String? ->
      WorkerService.start(context, kind ?: WorkerService.KIND_NIGHT)
    }

    // --- Mode Karakeep ------------------------------------------------------

    /** État du mode : autorisé, actif, automatique la nuit. */
    Function("modeStatus") {
      mapOf(
        "permitted" to KarakeepModeService.isPermitted(context),
        "active" to Preferences.isModeActive(context),
        "auto" to Preferences.isModeAuto(context),
      )
    }

    /**
     * Demande l'autorisation d'être le VPN du téléphone : une seule fois,
     * par une fenêtre d'Android. Renvoie faux si elle est déjà accordée.
     */
    Function("requestModePermission") {
      val intent = android.net.VpnService.prepare(context) ?: return@Function false
      val activity = appContext.currentActivity ?: return@Function false
      activity.startActivityForResult(intent, 0x4b4b)
      true
    }

    Function("setModeActive") { active: Boolean ->
      if (active) {
        val started = KarakeepModeService.start(context)
        if (started) Preferences.saveModeActive(context, true)
        started
      } else {
        KarakeepModeService.stop(context)
        Preferences.saveModeActive(context, false)
        true
      }
    }

    Function("setModeAuto") { auto: Boolean ->
      Preferences.saveModeAuto(context, auto)
    }

    /** Propose d'ajouter le bouton aux réglages rapides (Android 13 et +). */
    Function("requestAddTile") {
      if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.TIRAMISU) return@Function false
      val manager = context.getSystemService(android.app.StatusBarManager::class.java) ?: return@Function false
      manager.requestAddTileService(
        android.content.ComponentName(context, KarakeepModeTile::class.java),
        "Mode Karakeep",
        android.graphics.drawable.Icon.createWithResource(context, R.drawable.ic_karakeep_mode),
        java.util.concurrent.Executors.newSingleThreadExecutor(),
      ) { _ -> }
      true
    }

    /** Sur secteur ? L'analyse par le modèle n'a lieu qu'à cette condition. */
    Function("isCharging") {
      Power.isCharging(context)
    }

    /** Passages de jour : programmés ou annulés, prochain créneau renvoyé. */
    Function("scheduleDayPasses") { enabled: Boolean ->
      if (enabled) AlarmScheduler.scheduleDay(context).toDouble() else {
        AlarmScheduler.cancelDay(context)
        0.0
      }
    }

    Function("stop") {
      WorkerService.stop(context)
    }

    Function("isRunning") {
      @Suppress("DEPRECATION")
      val services = (context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager)
        .getRunningServices(Int.MAX_VALUE)
      services.any { it.service.className == WorkerService::class.java.name }
    }

    /** Programme une séance quotidienne. Renvoie l'instant du prochain départ. */
    Function("scheduleDaily") { hour: Int, minute: Int ->
      require(hour in 0..23 && minute in 0..59) { "Heure invalide" }
      AlarmScheduler.schedule(context, hour, minute).toDouble()
    }

    Function("cancelDaily") {
      AlarmScheduler.cancel(context)
    }

    /**
     * Ce qui peut empêcher la séance de nuit de démarrer.
     *
     * Deux refus possibles, invisibles sans cela : les alarmes exactes
     * interdites, ou l'application soumise à l'optimisation de batterie. L'un
     * ou l'autre suffit à ce que rien ne se passe à l'heure dite.
     */
    Function("diagnostics") {
      val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      val exempt = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        power.isIgnoringBatteryOptimizations(context.packageName)
      } else {
        true
      }
      val last = Preferences.readLastAlarm(context)
      mapOf(
        "canScheduleExact" to AlarmScheduler.canScheduleExact(context),
        "ignoringBatteryOptimizations" to exempt,
        "lastAlarmResult" to last?.first,
        "lastAlarmAt" to (last?.second?.toDouble() ?: 0.0),
      )
    }

    /** Texte lu dans une image (ML Kit, hors ligne). */
    AsyncFunction("recognizeText") { path: String, promise: Promise ->
      val ctx = context
      MediaTools.background({ MediaTools.recognizeText(ctx, path) }) { r ->
        r.fold({ promise.resolve(it) }, { promise.reject("ERR_OCR", it.message ?: "Lecture impossible", it) })
      }
    }

    /** Téléchargement par yt-dlp. */
    AsyncFunction("ytdlpDownload") { url: String, dir: String, cookie: String?, promise: Promise ->
      val ctx = context
      MediaTools.background({ MediaTools.download(ctx, url, dir, cookie) }) { r ->
        r.fold({ promise.resolve(it) }, { promise.reject("ERR_YTDLP", it.message ?: "yt-dlp a échoué", it) })
      }
    }

    AsyncFunction("ytdlpUpdate") { promise: Promise ->
      val ctx = context
      MediaTools.background({ MediaTools.update(ctx) }) { r ->
        r.fold({ promise.resolve(it) }, { promise.reject("ERR_YTDLP", it.message ?: "Mise à jour impossible", it) })
      }
    }

    AsyncFunction("ytdlpVersion") { promise: Promise ->
      val ctx = context
      MediaTools.background({ MediaTools.version(ctx) }) { r ->
        r.fold({ promise.resolve(it) }, { promise.reject("ERR_YTDLP", it.message ?: "yt-dlp indisponible", it) })
      }
    }

    /**
     * Cookies que la WebView de l'application détient pour une adresse —
     * en pratique, la session Instagram ouverte dans Réglages. Rien n'est
     * envoyé ailleurs qu'au site lui-même.
     */
    Function("cookieFor") { url: String ->
      android.webkit.CookieManager.getInstance().getCookie(url)
    }

    /** Images-clés d'une vidéo, pour que le modèle la « regarde ». */
    AsyncFunction("extractFrames") { videoPath: String, count: Int, outDir: String, promise: Promise ->
      MediaTools.background({ MediaTools.extractFrames(videoPath, count, outDir) }) { r ->
        r.fold({ promise.resolve(it) }, { promise.reject("ERR_FRAMES", it.message ?: "Images impossibles", it) })
      }
    }

    /** Son d'une vidéo en WAV 16 kHz mono, pour que le modèle l'« écoute ». */
    AsyncFunction("extractAudio") { videoPath: String, outPath: String, maxSeconds: Int, promise: Promise ->
      MediaTools.background({ MediaTools.extractAudio(videoPath, outPath, maxSeconds) }) { r ->
        r.fold({ promise.resolve(it) }, { promise.reject("ERR_AUDIO", it.message ?: "Son impossible", it) })
      }
    }

    /** Archive ZIP pour la sauvegarde. */
    AsyncFunction("zip") { sources: List<String>, dest: String, promise: Promise ->
      MediaTools.background({ MediaTools.zip(sources, dest) }) { r ->
        r.fold({ promise.resolve(it) }, { promise.reject("ERR_ZIP", it.message ?: "Archive impossible", it) })
      }
    }

    /** Fenêtre programmée, ou `null` s'il n'y en a pas. */
    Function("scheduledWindow") {
      Preferences.readWindow(context)
        ?.let { mapOf("hour" to it.first, "minute" to it.second) }
    }
  }
}
