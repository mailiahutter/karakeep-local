package expo.modules.karakeepworker

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.PowerManager
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * Service au premier plan qui fait tourner la file de traitement sans
 * interface.
 *
 * Les tentatives précédentes passaient par WorkManager. Sur Android 8 et au
 * delà, `expo-background-task` y enchaîne des tâches uniques dont chacune doit
 * réarmer la suivante : un maillon manqué — application gelée par le
 * gestionnaire de batterie, exécution avortée, absence de réseau, car la
 * contrainte `NetworkType.CONNECTED` y est imposée — et la chaîne s'arrête
 * pour de bon. C'est ce qui se passait : le travail n'avançait jamais sans
 * ouvrir l'application.
 *
 * Un service au premier plan est le mécanisme prévu par Android pour un
 * travail long que l'utilisateur a demandé. Il affiche une notification
 * permanente — c'est la contrepartie, et elle est honnête : le téléphone
 * travaille, il faut que ça se voie — tient un verrou processeur pour survivre
 * à l'extinction de l'écran, et ne dépend d'aucun réseau.
 */
class WorkerService : HeadlessJsTaskService() {

  private var wakeLock: PowerManager.WakeLock? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // `startForeground` doit être appelé dans les toutes premières secondes,
    // avant tout démarrage de JavaScript, sous peine d'ANR.
    startInForeground(NOTIFICATION_ID, buildNotification())
    acquireWakeLock()
    return try {
      super.onStartCommand(intent, flags, startId)
    } catch (e: Exception) {
      // Le moteur JavaScript n'a pas pu démarrer : inutile de laisser une
      // notification permanente sur un service qui ne fera rien.
      stopSelf()
      START_NOT_STICKY
    }
  }

  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig =
    HeadlessJsTaskConfig(
      TASK_NAME,
      Arguments.createMap(),
      TASK_TIMEOUT_MS,
      // Autorisé en premier plan : c'est précisément le but.
      true,
    )

  override fun onDestroy() {
    releaseWakeLock()
    super.onDestroy()
  }

  private fun acquireWakeLock() {
    if (wakeLock != null) return
    val power = getSystemService(Context.POWER_SERVICE) as PowerManager
    wakeLock = power
      .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "KarakeepLocal::worker")
      .apply {
        setReferenceCounted(false)
        // Borne de sécurité : un verrou oublié viderait la batterie. Le
        // service se termine normalement bien avant.
        acquire(WAKE_LOCK_TIMEOUT_MS)
      }
  }

  private fun releaseWakeLock() {
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
  }

  /**
   * Le nom diffère volontairement de `startForeground` : la méthode du même
   * nom existe dans `Service`, et une version privée serait refusée comme une
   * redéfinition affaiblissant la visibilité.
   */
  private fun startInForeground(id: Int, notification: Notification) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(id, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else {
      startForeground(id, notification)
    }
  }

  private fun buildNotification(): Notification {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        CHANNEL_ID,
        "Traitement des liens",
        // Discret : la notification informe, elle ne réclame pas d'attention.
        NotificationManager.IMPORTANCE_LOW,
      ).apply {
        description = "Analyse et rangement des liens enregistrés."
        setShowBadge(false)
      }
      manager.createNotificationChannel(channel)
    }

    val open = packageManager.getLaunchIntentForPackage(packageName)?.let {
      PendingIntent.getActivity(
        this,
        0,
        it,
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
      )
    }

    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }

    return builder
      .setContentTitle("Karakeep Local travaille")
      .setContentText("Analyse et rangement des liens en attente.")
      .setSmallIcon(android.R.drawable.stat_notify_sync)
      .setOngoing(true)
      .apply { open?.let { setContentIntent(it) } }
      .build()
  }

  companion object {
    /** Nom de la tâche enregistrée côté JavaScript. */
    const val TASK_NAME = "KarakeepWork"
    const val CHANNEL_ID = "karakeep-worker"
    const val NOTIFICATION_ID = 4711

    /**
     * Android 15 limite un service `dataSync` à six heures par jour. On
     * s'arrête bien avant : une seule séance n'a aucune raison de durer
     * autant, et dépasser ferait tuer le service par le système.
     */
    const val TASK_TIMEOUT_MS = 55L * 60L * 1000L
    const val WAKE_LOCK_TIMEOUT_MS = 60L * 60L * 1000L

    fun start(context: Context) {
      val intent = Intent(context, WorkerService::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, WorkerService::class.java))
    }
  }
}
