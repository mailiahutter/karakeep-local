package expo.modules.karakeepworker

import android.content.Intent
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

/**
 * Le bouton « Mode Karakeep » des réglages rapides, à côté du mode avion.
 *
 * Un toucher active ou coupe le mode. La toute première fois, Android exige
 * que l'autorisation soit donnée depuis l'application : le bouton l'ouvre
 * alors sur l'écran qui la demande.
 */
class KarakeepModeTile : TileService() {

  override fun onStartListening() {
    super.onStartListening()
    refresh()
  }

  override fun onClick() {
    super.onClick()
    if (Preferences.isModeActive(this)) {
      KarakeepModeService.stop(this)
      Preferences.saveModeActive(this, false)
    } else if (!KarakeepModeService.start(this)) {
      openApp()
      return
    } else {
      Preferences.saveModeActive(this, true)
    }
    refresh()
  }

  private fun openApp() {
    val intent = packageManager.getLaunchIntentForPackage(packageName)
      ?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      ?.setData(android.net.Uri.parse("karakeeplocal://settings/background"))
      ?: return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      val pending = android.app.PendingIntent.getActivity(
        this, 0, intent, android.app.PendingIntent.FLAG_IMMUTABLE,
      )
      startActivityAndCollapse(pending)
    } else {
      @Suppress("DEPRECATION")
      startActivityAndCollapse(intent)
    }
  }

  private fun refresh() {
    val tile = qsTile ?: return
    val active = Preferences.isModeActive(this)
    tile.state = if (active) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
    tile.label = "Mode Karakeep"
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      tile.subtitle = if (active) "Internet : Karakeep seul" else "Désactivé"
    }
    tile.updateTile()
  }
}
