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
    Function("start") {
      WorkerService.start(context)
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
    AsyncFunction("ytdlpDownload") { url: String, dir: String, promise: Promise ->
      val ctx = context
      MediaTools.background({ MediaTools.download(ctx, url, dir) }) { r ->
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

    /** Fenêtre programmée, ou `null` s'il n'y en a pas. */
    Function("scheduledWindow") {
      Preferences.readWindow(context)
        ?.let { mapOf("hour" to it.first, "minute" to it.second) }
    }
  }
}
