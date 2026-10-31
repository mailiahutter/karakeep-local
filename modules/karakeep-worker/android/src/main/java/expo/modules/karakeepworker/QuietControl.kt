package expo.modules.karakeepworker

import android.app.NotificationManager
import android.app.role.RoleManager
import android.content.Context
import android.os.Build

/**
 * Le silence du mode Karakeep : « Ne pas déranger », alarmes uniquement.
 *
 * Les SMS ne passent pas par internet et aucune application ne peut les
 * empêcher d'arriver ; mais en silence total, ils attendent le matin sans
 * réveiller personne — comme en mode avion, où on les découvre au retour du
 * réseau. Le réveil, lui, continue de sonner : couper aussi les alarmes
 * aurait été dangereux.
 *
 * L'état précédent est mémorisé et rétabli à la sortie du mode.
 */
object QuietControl {
  private const val PREV = "quiet-previous-filter"

  fun hasAccess(context: Context): Boolean =
    (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
      .isNotificationPolicyAccessGranted

  fun enter(context: Context) {
    if (!hasAccess(context)) return
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val prefs = context.getSharedPreferences("karakeep-worker", Context.MODE_PRIVATE)
    if (!prefs.contains(PREV)) prefs.edit().putInt(PREV, manager.currentInterruptionFilter).apply()
    manager.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_ALARMS)
  }

  fun exit(context: Context) {
    if (!hasAccess(context)) return
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val prefs = context.getSharedPreferences("karakeep-worker", Context.MODE_PRIVATE)
    val previous = prefs.getInt(PREV, NotificationManager.INTERRUPTION_FILTER_ALL)
    prefs.edit().remove(PREV).apply()
    manager.setInterruptionFilter(previous)
  }

  /** L'application tient-elle le rôle de filtre d'appels ? */
  fun screensCalls(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return false
    val roles = context.getSystemService(RoleManager::class.java) ?: return false
    return roles.isRoleHeld(RoleManager.ROLE_CALL_SCREENING)
  }
}
