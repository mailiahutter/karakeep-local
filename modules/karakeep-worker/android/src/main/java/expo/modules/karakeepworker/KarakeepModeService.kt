package expo.modules.karakeepworker

import android.content.Context
import android.content.Intent
import android.net.VpnService
import android.os.ParcelFileDescriptor
import android.service.quicksettings.TileService
import android.util.Log
import java.io.FileInputStream

/**
 * « Mode Karakeep » : internet pour Karakeep seulement.
 *
 * Demande du 31 octobre : remplacer le mode avion par un mode qui bloque
 * tout sauf Karakeep, pour que les pages soient lues la nuit sans que le
 * téléphone sonne ou se mette à jour de partout.
 *
 * Aucune application ne peut couper le mode avion, ni le réseau d'une autre
 * application. Mais Android laisse une application devenir le VPN du
 * téléphone, et choisir quelles applications passent par lui : c'est ce que
 * font les pare-feu comme NetGuard. Ici, le « VPN » ne mène nulle part —
 * tout ce qui y entre est jeté — et Karakeep en est exclu, donc garde le
 * réseau normal. Rien ne sort du téléphone, rien n'est inspecté.
 *
 * Les appels et SMS ne passent pas par internet : les appels entrants sont
 * refusés par KarakeepCallScreener, et « Ne pas déranger » (alarmes
 * uniquement) fait taire le reste — voir QuietControl.
 */
class KarakeepModeService : VpnService() {

  private var tun: ParcelFileDescriptor? = null
  private var drain: Thread? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      stopBlocking()
      stopSelf()
      return START_NOT_STICKY
    }
    if (tun == null) startBlocking()
    return START_STICKY
  }

  override fun onRevoke() {
    // L'utilisateur a coupé le VPN depuis les réglages, ou un autre VPN a
    // pris la place : on s'efface.
    stopBlocking()
    super.onRevoke()
  }

  override fun onDestroy() {
    stopBlocking()
    super.onDestroy()
  }

  private fun startBlocking() {
    try {
      val builder = Builder()
        .setSession("Mode Karakeep")
        .addAddress("10.215.173.1", 32)
        .addAddress("fd00:6b61:7261:6b65::1", 128)
        .addRoute("0.0.0.0", 0)
        .addRoute("::", 0)
        // Karakeep garde son accès normal au réseau.
        .addDisallowedApplication(packageName)
      // Le gestionnaire de téléchargements d'Android télécharge les modèles
      // pour le compte de Karakeep, mais c'est un composant du système, pas
      // Karakeep : le bloquer, c'était bloquer les téléchargements (bug du
      // 1er novembre). Il passe donc lui aussi.
      for (pkg in DOWNLOAD_PROVIDERS) {
        try {
          builder.addDisallowedApplication(pkg)
        } catch (_: Exception) {
          // Absent sur ce téléphone.
        }
      }
      tun = builder.establish()
      Preferences.saveModeActive(this, tun != null)
      // Comme le mode avion : appels refusés (voir KarakeepCallScreener) et
      // silence, réveil excepté.
      if (tun != null) QuietControl.enter(this)
      // On vide la file du tunnel sans rien en faire : les paquets des
      // autres applications disparaissent, leurs connexions échouent.
      val fd = tun ?: return
      drain = Thread {
        val input = FileInputStream(fd.fileDescriptor)
        val buffer = ByteArray(32 * 1024)
        try {
          while (!Thread.currentThread().isInterrupted) {
            if (input.read(buffer) < 0) break
          }
        } catch (_: Exception) {
          // Tunnel fermé.
        }
      }.apply { isDaemon = true; start() }
      TileService.requestListeningState(this, android.content.ComponentName(this, KarakeepModeTile::class.java))
    } catch (e: Exception) {
      Log.w("KarakeepMode", "Impossible d'activer le mode", e)
      stopBlocking()
    }
  }

  private fun stopBlocking() {
    drain?.interrupt()
    drain = null
    try {
      tun?.close()
    } catch (_: Exception) {
    }
    val wasActive = tun != null
    tun = null
    Preferences.saveModeActive(this, false)
    if (wasActive) QuietControl.exit(this)
    TileService.requestListeningState(this, android.content.ComponentName(this, KarakeepModeTile::class.java))
  }

  companion object {
    private val DOWNLOAD_PROVIDERS = listOf(
      "com.android.providers.downloads",
      "com.google.android.providers.downloads",
      "com.android.providers.downloads.ui",
    )

    const val ACTION_STOP = "expo.modules.karakeepworker.STOP_KARAKEEP_MODE"

    /** L'utilisateur a-t-il déjà autorisé l'application à être le VPN ? */
    fun isPermitted(context: Context): Boolean = prepare(context) == null

    /** Active le mode. Faux si l'autorisation n'a pas encore été donnée. */
    fun start(context: Context): Boolean {
      if (!isPermitted(context)) return false
      context.startService(Intent(context, KarakeepModeService::class.java))
      return true
    }

    fun stop(context: Context) {
      context.startService(Intent(context, KarakeepModeService::class.java).setAction(ACTION_STOP))
    }
  }
}
