package expo.modules.karakeepworker

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import java.util.Calendar

/**
 * Programmation de la séance de travail.
 *
 * L'alarme doit être EXACTE, et ce n'est pas une question de précision.
 * Depuis Android 12, démarrer un service au premier plan depuis
 * l'arrière-plan est interdit sauf exemption, et le déclenchement d'une
 * alarme exacte en est une. Avec une alarme inexacte, le réveil aurait bien
 * lieu et le démarrage du service serait refusé : la séance de nuit
 * échouerait en silence, ce qui est le pire des cas.
 *
 * Si le système refuse les alarmes exactes, on pose quand même l'alarme
 * inexacte : elle fonctionne dès lors que l'application est exemptée
 * d'optimisation de batterie — l'autre exemption, celle que l'écran de
 * réglages fait demander.
 */
object AlarmScheduler {

  private const val REQUEST_CODE = 4712

  private fun pendingIntent(context: Context): PendingIntent =
    PendingIntent.getBroadcast(
      context,
      REQUEST_CODE,
      Intent(context, AlarmReceiver::class.java),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

  /** Prochaine occurrence de cette heure, aujourd'hui ou demain. */
  fun nextOccurrence(hour: Int, minute: Int, now: Long = System.currentTimeMillis()): Long {
    val calendar = Calendar.getInstance().apply {
      timeInMillis = now
      set(Calendar.HOUR_OF_DAY, hour)
      set(Calendar.MINUTE, minute)
      set(Calendar.SECOND, 0)
      set(Calendar.MILLISECOND, 0)
    }
    if (calendar.timeInMillis <= now) calendar.add(Calendar.DAY_OF_YEAR, 1)
    return calendar.timeInMillis
  }

  /** Le système accorde-t-il les alarmes exactes à cette application ? */
  fun canScheduleExact(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
    val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    return manager.canScheduleExactAlarms()
  }

  fun schedule(context: Context, hour: Int, minute: Int): Long {
    val at = nextOccurrence(hour, minute)
    val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val intent = pendingIntent(context)
    try {
      if (canScheduleExact(context)) {
        manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, intent)
      } else {
        manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, intent)
      }
    } catch (e: SecurityException) {
      // La permission a pu être retirée entre la vérification et l'appel.
      manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, intent)
    }
    Preferences.saveWindow(context, hour, minute)
    return at
  }

  fun cancel(context: Context) {
    val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    manager.cancel(pendingIntent(context))
    Preferences.clearWindow(context)
  }

  /**
   * Repose l'alarme du lendemain.
   *
   * Une alarme ne se répète pas d'elle-même : sans ce réarmement après chaque
   * déclenchement et après chaque redémarrage du téléphone, la séance
   * n'aurait lieu qu'une fois.
   */
  fun rearm(context: Context) {
    val window = Preferences.readWindow(context) ?: return
    schedule(context, window.first, window.second)
  }
}

/** Petit stockage à part : le service démarre sans que JavaScript soit prêt. */
object Preferences {
  private const val FILE = "karakeep-worker"
  private const val HOUR = "window-hour"
  private const val MINUTE = "window-minute"

  fun saveWindow(context: Context, hour: Int, minute: Int) {
    context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit()
      .putInt(HOUR, hour).putInt(MINUTE, minute).apply()
  }

  fun clearWindow(context: Context) {
    context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit()
      .remove(HOUR).remove(MINUTE).apply()
  }

  private const val LAST_ALARM = "last-alarm"

  fun saveLastAlarm(context: Context, result: String) {
    context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit()
      .putString(LAST_ALARM, result)
      .putLong(LAST_ALARM + "-at", System.currentTimeMillis())
      .apply()
  }

  fun readLastAlarm(context: Context): Pair<String, Long>? {
    val prefs = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)
    val result = prefs.getString(LAST_ALARM, null) ?: return null
    return result to prefs.getLong(LAST_ALARM + "-at", 0L)
  }

  fun readWindow(context: Context): Pair<Int, Int>? {
    val prefs = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)
    val hour = prefs.getInt(HOUR, -1)
    val minute = prefs.getInt(MINUTE, -1)
    return if (hour in 0..23 && minute in 0..59) hour to minute else null
  }
}
