package expo.modules.karakeepworker

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * L'heure dite : on démarre la séance, puis on repose l'alarme du lendemain.
 *
 * Le démarrage peut être refusé par Android — restriction sur les services au
 * premier plan lancés depuis l'arrière-plan. On le note plutôt que de laisser
 * l'échec invisible : c'est exactement le genre de silence qui a fait croire
 * pendant des semaines que le travail d'arrière-plan « ne marchait pas ».
 */
class AlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    val kind = intent?.getStringExtra(WorkerService.EXTRA_KIND) ?: WorkerService.KIND_NIGHT
    if (kind == WorkerService.KIND_MORNING) {
      if (Preferences.isModeAuto(context)) KarakeepModeService.stop(context)
      return
    }
    // La nuit tombe : le mode Karakeep, s'il est automatique, coupe internet
    // pour les autres applications, jusqu'à 7 h.
    if (kind == WorkerService.KIND_NIGHT && Preferences.isModeAuto(context) &&
      intent?.getBooleanExtra(AlarmScheduler.EXTRA_RETRY, false) != true
    ) {
      try {
        if (KarakeepModeService.start(context)) AlarmScheduler.scheduleMorning(context)
      } catch (e: Exception) {
        Log.w("KarakeepWorker", "Mode Karakeep non activé", e)
      }
    }
    if (kind == WorkerService.KIND_NIGHT && !Power.isCharging(context)) {
      // Pas encore branché : l'analyse n'a lieu que sur secteur. On repasse
      // dans une demi-heure, jusqu'à 6 h, plutôt que de perdre la nuit pour
      // un chargeur branché un peu tard.
      val retry = AlarmScheduler.scheduleNightRetry(context)
      Preferences.saveLastAlarm(context, if (retry) "attente du secteur" else "pas branché de la nuit")
      if (intent?.getBooleanExtra(AlarmScheduler.EXTRA_RETRY, false) != true) AlarmScheduler.rearm(context)
      return
    }
    try {
      WorkerService.start(context, kind)
      Preferences.saveLastAlarm(context, "ok ($kind)")
    } catch (e: Exception) {
      Log.w("KarakeepWorker", "Démarrage refusé par le système", e)
      Preferences.saveLastAlarm(
        context,
        "refus ($kind): " + (e.message ?: e.javaClass.simpleName),
      )
    }
    // Réarmé dans tous les cas : un refus ce soir ne doit pas supprimer la
    // séance de demain.
    when {
      kind == WorkerService.KIND_DAY -> AlarmScheduler.rearmDay(context)
      // Un nouvel essai ne repose pas l'alarme du lendemain : celle de ce
      // soir s'en est déjà chargée.
      intent?.getBooleanExtra(AlarmScheduler.EXTRA_RETRY, false) == true -> Unit
      else -> AlarmScheduler.rearm(context)
    }
  }
}
