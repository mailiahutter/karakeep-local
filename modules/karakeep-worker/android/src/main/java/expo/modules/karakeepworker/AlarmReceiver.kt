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
      // Alarme d'une version précédente : le mode ne se coupe plus seul le
      // matin (retour du 1er novembre), il reste actif jusqu'à ce qu'on le
      // désactive.
      return
    }
    // La nuit tombe : le mode Karakeep, s'il est automatique, coupe internet
    // pour les autres applications — et le reste jusqu'à ce qu'on le coupe
    // depuis le bouton des réglages rapides.
    if (kind == WorkerService.KIND_NIGHT && Preferences.isModeAuto(context) &&
      intent?.getBooleanExtra(AlarmScheduler.EXTRA_RETRY, false) != true
    ) {
      try {
        if (KarakeepModeService.start(context)) Preferences.saveModeActive(context, true)
      } catch (e: Exception) {
        Log.w("KarakeepWorker", "Mode Karakeep non activé", e)
      }
    }
    val isRetry = intent?.getBooleanExtra(AlarmScheduler.EXTRA_RETRY, false) == true
    val label = when {
      kind == WorkerService.KIND_DAY -> "jour"
      isRetry -> "garde de nuit"
      else -> "nuit"
    }
    val charging = Power.isCharging(context)
    // Garde de nuit : une séance déjà en cours, on repasse plus tard. Une
    // séance tuée par Android (le 4 novembre, vers 4 h 30, sans un mot dans
    // le journal) est relancée au passage suivant.
    if (kind == WorkerService.KIND_NIGHT && WorkerService.running) {
      val lastSign = maxOf(Preferences.lastBeat(context), WorkerService.startedAt)
      val silentFor = System.currentTimeMillis() - lastSign
      if (silentFor > FROZEN_AFTER_MS) {
        // Séance figée : plus aucun signe de vie depuis trois quarts d'heure.
        // On redémarre l'application ; le prochain passage la relance.
        Preferences.addAlarmEvent(context, "$label : séance figée depuis ${silentFor / 60000} min, redémarrage")
        AlarmScheduler.scheduleNightRetry(context, RESTART_DELAY_MS)
        if (!isRetry) AlarmScheduler.rearm(context)
        WorkerService.stop(context)
        android.os.Process.killProcess(android.os.Process.myPid())
        return
      }
      Preferences.addAlarmEvent(context, "$label : séance en cours, rien à faire")
      if (isRetry) AlarmScheduler.scheduleNightRetry(context) else AlarmScheduler.rearm(context)
      return
    }
    if (kind == WorkerService.KIND_NIGHT && !charging) {
      Preferences.addAlarmEvent(context, "$label : téléphone sur batterie, analyse attendue au branchement")
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
      Preferences.addAlarmEvent(context, "$label : séance lancée${if (charging) " (sur secteur)" else ""}")
      // Toute la nuit, jusqu'à 7 h, un passage toutes les demi-heures vérifie
      // que la séance tourne toujours. S'il n'y a plus rien à faire, la
      // séance relancée s'arrête aussitôt.
      if (kind == WorkerService.KIND_NIGHT) AlarmScheduler.scheduleNightRetry(context)
    } catch (e: Exception) {
      Log.w("KarakeepWorker", "Démarrage refusé par le système", e)
      Preferences.saveLastAlarm(
        context,
        "refus ($kind): " + (e.message ?: e.javaClass.simpleName),
      )
      Preferences.addAlarmEvent(context, "$label : démarrage REFUSÉ par Android (${e.message ?: e.javaClass.simpleName})")
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

  companion object {
    /** Sans signe de vie depuis ce temps, la séance est tenue pour figée. */
    const val FROZEN_AFTER_MS = 45L * 60L * 1000L
    const val RESTART_DELAY_MS = 2L * 60L * 1000L
  }
}
