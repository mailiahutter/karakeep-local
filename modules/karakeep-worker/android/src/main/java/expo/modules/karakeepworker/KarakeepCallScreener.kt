package expo.modules.karakeepworker

import android.os.Build
import android.telecom.Call
import android.telecom.CallScreeningService

/**
 * Pendant le mode Karakeep, les appels entrants sont refusés — l'appelant
 * tombe sur la messagerie, comme en mode avion.
 *
 * Android réserve ce pouvoir à l'application qui tient le rôle de « filtre
 * d'appels », accordé une fois par l'utilisateur. Hors mode Karakeep, tous
 * les appels passent normalement. Les appels sortants, y compris d'urgence,
 * ne sont jamais concernés.
 */
class KarakeepCallScreener : CallScreeningService() {
  override fun onScreenCall(details: Call.Details) {
    // Avant Android 10, le service n'est appelé que pour les appels entrants.
    val incoming = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
      details.callDirection == Call.Details.DIRECTION_INCOMING
    val block = incoming && Preferences.isModeActive(this)
    val response = CallResponse.Builder()
      .setDisallowCall(block)
      .setRejectCall(block)
      // L'appel reste dans le journal : on voit le matin qui a appelé.
      .setSkipCallLog(false)
      .setSkipNotification(false)
      .build()
    respondToCall(details, response)
  }
}
