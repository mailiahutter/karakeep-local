package expo.modules.karakeepworker

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Les alarmes ne survivent pas à l'extinction du téléphone, ni au
 * remplacement de l'application lors d'une mise à jour. Sans ce récepteur, la
 * séance programmée disparaîtrait au premier redémarrage — silencieusement.
 */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    val action = intent?.action ?: return
    if (action == Intent.ACTION_BOOT_COMPLETED ||
      action == Intent.ACTION_MY_PACKAGE_REPLACED
    ) {
      AlarmScheduler.rearm(context)
    }
  }
}
