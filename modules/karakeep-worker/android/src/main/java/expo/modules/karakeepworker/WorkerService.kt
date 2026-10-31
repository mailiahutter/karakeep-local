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

  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig {
    val kind = intent?.getStringExtra(EXTRA_KIND) ?: KIND_NIGHT
    val data = Arguments.createMap().apply {
      putString("kind", kind)
      putBoolean("charging", isCharging())
    }
    return HeadlessJsTaskConfig(
      TASK_NAME,
      data,
      if (kind == KIND_NIGHT) NIGHT_TIMEOUT_MS else DAY_TIMEOUT_MS,
      // Autorisé en premier plan : c'est précisément le but.
      true,
    )
  }

  private fun isCharging(): Boolean = Power.isCharging(this)

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
     * Android 15 limite un service `dataSync` à six heures par jour. La
     * séance de nuit en prend au plus cinq — elle s'arrête d'elle-même dès
     * que la file est vide —, les passages de jour vingt minutes chacun.
     * L'ancienne borne de 55 minutes ne laissait passer qu'une douzaine de
     * liens par nuit avec un modèle de 4 milliards de paramètres.
     */
    const val NIGHT_TIMEOUT_MS = 5L * 60L * 60L * 1000L
    const val DAY_TIMEOUT_MS = 20L * 60L * 1000L
    const val WAKE_LOCK_TIMEOUT_MS = NIGHT_TIMEOUT_MS + 10L * 60L * 1000L

    const val EXTRA_KIND = "kind"
    /** Séance de nuit : jusqu'à ce que tout soit traité, cinq heures au plus. */
    const val KIND_NIGHT = "night"
    /** Passage de jour : court, surtout pour lire les pages pendant qu'il y a du réseau. */
    const val KIND_DAY = "day"
    /** Juste après un partage : finir la capture même si l'on revient à Instagram. */
    const val KIND_SHARE = "share"
    /** Le matin : couper le mode Karakeep automatique. Ne démarre aucune séance. */
    const val KIND_MORNING = "morning"

    fun start(context: Context, kind: String = KIND_NIGHT) {
      val intent = Intent(context, WorkerService::class.java).putExtra(EXTRA_KIND, kind)
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

/** État de l'alimentation. */
object Power {
  /**
   * Branché sur secteur (ou chargeur USB, ou sans fil). On lit l'état
   * collant de la batterie plutôt que `BatteryManager.isCharging`, qui
   * répond faux quand la batterie est pleine alors que le téléphone est
   * bien branché — précisément le cas en fin de nuit.
   */
  fun isCharging(context: Context): Boolean {
    val status = context.registerReceiver(
      null,
      android.content.IntentFilter(Intent.ACTION_BATTERY_CHANGED),
    ) ?: return false
    return status.getIntExtra(android.os.BatteryManager.EXTRA_PLUGGED, 0) != 0
  }
}
