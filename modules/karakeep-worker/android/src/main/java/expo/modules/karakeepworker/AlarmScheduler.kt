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

  // --- Nouvel essai de nuit, en attendant le secteur -----------------------

  const val EXTRA_RETRY = "retry"
  private const val RETRY_REQUEST_CODE = 4714
  private const val RETRY_DELAY_MS = 30L * 60L * 1000L
  /** Au-delà de 6 h, inutile : la séance n'aurait plus le temps de rien. */
  private const val RETRY_LAST_HOUR = 7

  /** Programme un nouvel essai dans une demi-heure ; faux s'il est trop tard. */
  fun scheduleNightRetry(context: Context): Boolean {
    val at = System.currentTimeMillis() + RETRY_DELAY_MS
    val hour = Calendar.getInstance().apply { timeInMillis = at }.get(Calendar.HOUR_OF_DAY)
    val window = Preferences.readWindow(context)
    // Fenêtre de nuit : de l'heure choisie jusqu'à 6 h (en passant minuit si besoin).
    val inNight = if (window != null && window.first > RETRY_LAST_HOUR) {
      hour >= window.first || hour < RETRY_LAST_HOUR
    } else {
      hour < RETRY_LAST_HOUR
    }
    if (!inNight) return false
    val intent = PendingIntent.getBroadcast(
      context,
      RETRY_REQUEST_CODE,
      Intent(context, AlarmReceiver::class.java)
        .putExtra(WorkerService.EXTRA_KIND, WorkerService.KIND_NIGHT)
        .putExtra(EXTRA_RETRY, true),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    try {
      if (canScheduleExact(context)) manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, intent)
      else manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, intent)
    } catch (e: SecurityException) {
      manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, intent)
    }
    return true
  }

  // --- Fin du mode Karakeep automatique, le matin --------------------------

  private const val MORNING_REQUEST_CODE = 4715
  const val MORNING_HOUR = 7

  fun scheduleMorning(context: Context) {
    val at = nextOccurrence(MORNING_HOUR, 0)
    val intent = PendingIntent.getBroadcast(
      context,
      MORNING_REQUEST_CODE,
      Intent(context, AlarmReceiver::class.java).putExtra(WorkerService.EXTRA_KIND, WorkerService.KIND_MORNING),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    try {
      if (canScheduleExact(context)) manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, intent)
      else manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, intent)
    } catch (e: SecurityException) {
      manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, intent)
    }
  }

  // --- Passages de jour ------------------------------------------------------

  private const val DAY_REQUEST_CODE = 4713
  /** Toutes les deux heures, de 8 h à 22 h. */
  private val DAY_HOURS = listOf(8, 10, 12, 14, 16, 18, 20, 22)

  private fun dayIntent(context: Context): PendingIntent =
    PendingIntent.getBroadcast(
      context,
      DAY_REQUEST_CODE,
      Intent(context, AlarmReceiver::class.java).putExtra(WorkerService.EXTRA_KIND, WorkerService.KIND_DAY),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

  /** Prochain créneau de jour, aujourd'hui ou demain matin. */
  fun nextDaySlot(now: Long = System.currentTimeMillis()): Long =
    DAY_HOURS.map { nextOccurrence(it, 5, now) }.minOrNull() ?: nextOccurrence(8, 5, now)

  /**
   * Programme le prochain passage de jour.
   *
   * La nuit, le téléphone est en mode avion : une page partagée le soir ne
   * pouvait être lue qu'à l'ouverture suivante de l'application — c'est-à-dire
   * jamais. Ces passages courts lisent les pages tant que le réseau est là.
   */
  fun scheduleDay(context: Context): Long {
    val at = nextDaySlot()
    val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val intent = dayIntent(context)
    try {
      if (canScheduleExact(context)) {
        manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, intent)
      } else {
        manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, intent)
      }
    } catch (e: SecurityException) {
      manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, intent)
    }
    Preferences.saveDayEnabled(context, true)
    return at
  }

  fun cancelDay(context: Context) {
    val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    manager.cancel(dayIntent(context))
    Preferences.saveDayEnabled(context, false)
  }

  fun rearmDay(context: Context) {
    if (Preferences.isDayEnabled(context)) scheduleDay(context)
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

  private const val DAY_ENABLED = "day-enabled"

  fun saveDayEnabled(context: Context, enabled: Boolean) {
    context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putBoolean(DAY_ENABLED, enabled).apply()
  }

  fun isDayEnabled(context: Context): Boolean =
    context.getSharedPreferences(FILE, Context.MODE_PRIVATE).getBoolean(DAY_ENABLED, false)

  private const val MODE_ACTIVE = "karakeep-mode-active"
  private const val MODE_AUTO = "karakeep-mode-auto"

  fun saveModeActive(context: Context, active: Boolean) {
    context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putBoolean(MODE_ACTIVE, active).apply()
  }

  fun isModeActive(context: Context): Boolean =
    context.getSharedPreferences(FILE, Context.MODE_PRIVATE).getBoolean(MODE_ACTIVE, false)

  /** Mode Karakeep activé seul de l'heure de la séance jusqu'au matin. */
  fun saveModeAuto(context: Context, auto: Boolean) {
    context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putBoolean(MODE_AUTO, auto).apply()
  }

  fun isModeAuto(context: Context): Boolean =
    context.getSharedPreferences(FILE, Context.MODE_PRIVATE).getBoolean(MODE_AUTO, false)

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
