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
    try {
      WorkerService.start(context)
      Preferences.saveLastAlarm(context, "ok")
    } catch (e: Exception) {
      Log.w("KarakeepWorker", "Démarrage refusé par le système", e)
      Preferences.saveLastAlarm(
        context,
        "refus: " + (e.message ?: e.javaClass.simpleName),
      )
    }
    // Réarmé dans tous les cas : un refus ce soir ne doit pas supprimer la
    // séance de demain.
    AlarmScheduler.rearm(context)
  }
}
