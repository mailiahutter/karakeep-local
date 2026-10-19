package expo.modules.karakeepworker

import android.content.Context
import android.net.Uri
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import com.yausername.ffmpeg.FFmpeg
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLRequest
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Outils natifs de capture et d'analyse, appelés depuis le pipeline JS.
 *
 * - Lecture du texte dans les images (ML Kit, modèle embarqué dans l'APK :
 *   aucun réseau, fonctionne en mode avion).
 * - yt-dlp (via youtubedl-android, le moteur de l'application Seal) : dernier
 *   recours quand les méthodes de l'application échouent, et seule voie pour
 *   les vidéos YouTube.
 *
 * Tout s'exécute sur un fil dédié : yt-dlp bloque pendant tout le transfert.
 */
object MediaTools {
  private val executor = Executors.newSingleThreadExecutor()
  @Volatile private var ytdlpReady = false

  fun <T> background(work: () -> T, done: (Result<T>) -> Unit) {
    executor.execute { done(runCatching(work)) }
  }

  /** Texte lu dans une image enregistrée sur l'appareil. */
  fun recognizeText(context: Context, path: String): String {
    val uri = if (path.startsWith("file://") || path.startsWith("content://")) {
      Uri.parse(path)
    } else {
      Uri.fromFile(File(path))
    }
    val image = InputImage.fromFilePath(context, uri)
    val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    val latch = CountDownLatch(1)
    var text = ""
    var failure: Exception? = null
    recognizer.process(image)
      .addOnSuccessListener { text = it.text }
      .addOnFailureListener { failure = it }
      .addOnCompleteListener { latch.countDown() }
    if (!latch.await(60, TimeUnit.SECONDS)) throw IllegalStateException("Lecture du texte trop longue")
    recognizer.close()
    failure?.let { throw it }
    return text
  }

  @Synchronized
  private fun ensureYtdlp(context: Context) {
    if (ytdlpReady) return
    YoutubeDL.getInstance().init(context)
    FFmpeg.getInstance().init(context)
    ytdlpReady = true
  }

  /**
   * Télécharge les médias d'une adresse dans `dir`. Renvoie les fichiers
   * produits et les métadonnées JSON de yt-dlp (une ligne par élément).
   */
  fun download(context: Context, url: String, dir: String): Map<String, Any> {
    ensureYtdlp(context)
    val target = File(dir.removePrefix("file://"))
    target.mkdirs()
    val before = target.listFiles()?.map { it.absolutePath }?.toSet() ?: emptySet()
    val request = YoutubeDLRequest(url)
      .addOption("-o", "${target.absolutePath}/%(id)s_%(autonumber)s.%(ext)s")
      // 720p suffit à regarder une idée sur un téléphone, et divise la place
      // occupée par quatre par rapport à la 4K.
      .addOption("-f", "bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720]/bv*+ba/b")
      .addOption("--merge-output-format", "mp4")
      .addOption("--no-simulate")
      .addOption("-j")
      .addOption("--no-playlist-reverse")
      .addOption("--socket-timeout", 30)
      .addOption("--retries", 3)
    val response = YoutubeDL.getInstance().execute(request, null, null)
    if (response.exitCode != 0) {
      throw IllegalStateException(response.err.lines().lastOrNull { it.isNotBlank() } ?: "yt-dlp a échoué")
    }
    val files = target.listFiles()
      ?.map { it.absolutePath }
      ?.filter { it !in before && !it.endsWith(".part") && !it.endsWith(".ytdl") }
      ?.sorted()
      ?: emptyList()
    return mapOf("files" to files, "info" to response.out)
  }

  /** Met yt-dlp à jour : les sites changent, lui suit. */
  fun update(context: Context): String {
    ensureYtdlp(context)
    val status = YoutubeDL.getInstance().updateYoutubeDL(context)
    return status?.name ?: "unknown"
  }

  fun version(context: Context): String? {
    ensureYtdlp(context)
    return YoutubeDL.getInstance().versionName(context)
  }
}
