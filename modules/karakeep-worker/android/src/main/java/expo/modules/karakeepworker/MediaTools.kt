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
import java.io.FileOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
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
  fun download(context: Context, url: String, dir: String, cookie: String? = null): Map<String, Any> {
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
      .addOption("--max-filesize", "300M")
      .addOption("--socket-timeout", 30)
      .addOption("--retries", 3)
    if (!cookie.isNullOrBlank()) request.addOption("--add-header", "Cookie:$cookie")
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

  /**
   * Archive ZIP de fichiers et de dossiers, écrite en flux : une sauvegarde
   * peut peser plusieurs gigaoctets de vidéos, rien ne doit tenir en mémoire.
   * Les médias sont déjà compressés : on les range sans les recompresser.
   */
  fun zip(sources: List<String>, dest: String): Map<String, Any> {
    val out = File(dest.removePrefix("file://"))
    out.parentFile?.mkdirs()
    var files = 0
    var bytes = 0L
    ZipOutputStream(FileOutputStream(out).buffered(1 shl 16)).use { zip ->
      for (raw in sources) {
        val root = File(raw.removePrefix("file://"))
        if (!root.exists()) continue
        val base = root.parentFile ?: root
        root.walkTopDown().filter { it.isFile }.forEach { file ->
          val entry = ZipEntry(file.relativeTo(base).path)
          val stored = !file.name.endsWith(".db") && !file.name.endsWith(".html")
          if (stored) {
            entry.method = ZipEntry.STORED
            entry.size = file.length()
            entry.compressedSize = file.length()
            entry.crc = java.util.zip.CRC32().also { crc ->
              file.inputStream().buffered(1 shl 16).use { input ->
                val buf = ByteArray(1 shl 16)
                while (true) {
                  val n = input.read(buf)
                  if (n < 0) break
                  crc.update(buf, 0, n)
                }
              }
            }.value
          }
          zip.putNextEntry(entry)
          file.inputStream().buffered(1 shl 16).use { it.copyTo(zip, 1 shl 16) }
          zip.closeEntry()
          files++
          bytes += file.length()
        }
      }
    }
    return mapOf("path" to out.absolutePath, "files" to files, "bytes" to bytes.toDouble(), "size" to out.length().toDouble())
  }

  // --- Vidéo : images-clés et son ------------------------------------------

  /**
   * Images réparties dans la vidéo (en évitant le tout début et la fin, où
   * l'on trouve écrans titres et appels à s'abonner), réduites à 768 px.
   */
  fun extractFrames(videoPath: String, count: Int, outDir: String): List<String> {
    val retriever = android.media.MediaMetadataRetriever()
    val out = mutableListOf<String>()
    try {
      retriever.setDataSource(videoPath.removePrefix("file://"))
      val durationMs = retriever
        .extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_DURATION)
        ?.toLongOrNull() ?: 0L
      val dir = File(outDir.removePrefix("file://")).apply { mkdirs() }
      for (i in 1..count) {
        val atUs = if (durationMs > 0) durationMs * 1000L * i / (count + 1) else 0L
        val frame = retriever.getFrameAtTime(atUs, android.media.MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
          ?: continue
        val scale = 768f / maxOf(frame.width, frame.height).coerceAtLeast(1)
        val bitmap = if (scale < 1f) {
          android.graphics.Bitmap.createScaledBitmap(
            frame,
            (frame.width * scale).toInt().coerceAtLeast(1),
            (frame.height * scale).toInt().coerceAtLeast(1),
            true,
          )
        } else frame
        val file = File(dir, "frame_$i.jpg")
        FileOutputStream(file).use { bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG, 85, it) }
        out.add(file.absolutePath)
      }
    } finally {
      retriever.release()
    }
    return out
  }

  /**
   * Piste son de la vidéo, décodée en WAV 16 kHz mono — le format attendu
   * par le modèle — et limitée à `maxSeconds`. `null` si la vidéo est muette.
   */
  fun extractAudio(videoPath: String, outPath: String, maxSeconds: Int): String? {
    val extractor = android.media.MediaExtractor()
    extractor.setDataSource(videoPath.removePrefix("file://"))
    var track = -1
    for (i in 0 until extractor.trackCount) {
      val mime = extractor.getTrackFormat(i).getString(android.media.MediaFormat.KEY_MIME) ?: continue
      if (mime.startsWith("audio/")) { track = i; break }
    }
    if (track < 0) { extractor.release(); return null }
    extractor.selectTrack(track)
    val format = extractor.getTrackFormat(track)
    val codec = android.media.MediaCodec.createDecoderByType(format.getString(android.media.MediaFormat.KEY_MIME)!!)
    codec.configure(format, null, null, 0)
    codec.start()

    val target = 16_000
    val maxSamples = target * maxSeconds
    val mono = java.io.ByteArrayOutputStream()
    var written = 0
    var sampleRate = format.getInteger(android.media.MediaFormat.KEY_SAMPLE_RATE)
    var channels = format.getInteger(android.media.MediaFormat.KEY_CHANNEL_COUNT)
    var floatPcm = false
    var position = 0.0
    val info = android.media.MediaCodec.BufferInfo()
    var inputDone = false
    var outputDone = false
    try {
      while (!outputDone && written < maxSamples) {
        if (!inputDone) {
          val inIndex = codec.dequeueInputBuffer(10_000)
          if (inIndex >= 0) {
            val buffer = codec.getInputBuffer(inIndex)!!
            val size = extractor.readSampleData(buffer, 0)
            if (size < 0) {
              codec.queueInputBuffer(inIndex, 0, 0, 0, android.media.MediaCodec.BUFFER_FLAG_END_OF_STREAM)
              inputDone = true
            } else {
              codec.queueInputBuffer(inIndex, 0, size, extractor.sampleTime, 0)
              extractor.advance()
            }
          }
        }
        val outIndex = codec.dequeueOutputBuffer(info, 10_000)
        if (outIndex == android.media.MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
          val f = codec.outputFormat
          sampleRate = f.getInteger(android.media.MediaFormat.KEY_SAMPLE_RATE)
          channels = f.getInteger(android.media.MediaFormat.KEY_CHANNEL_COUNT)
          floatPcm = f.containsKey(android.media.MediaFormat.KEY_PCM_ENCODING) &&
            f.getInteger(android.media.MediaFormat.KEY_PCM_ENCODING) == android.media.AudioFormat.ENCODING_PCM_FLOAT
        } else if (outIndex >= 0) {
          val buffer = codec.getOutputBuffer(outIndex)!!
          buffer.position(info.offset)
          buffer.limit(info.offset + info.size)
          buffer.order(java.nio.ByteOrder.LITTLE_ENDIAN)
          val frameBytes = (if (floatPcm) 4 else 2) * channels
          val frames = info.size / frameBytes
          val step = sampleRate.toDouble() / target
          // Rééchantillonnage au plus proche : suffisant pour de la parole.
          while (position < frames && written < maxSamples) {
            val base = info.offset + position.toInt() * frameBytes
            var sum = 0.0
            for (c in 0 until channels) {
              sum += if (floatPcm) buffer.getFloat(base + c * 4).toDouble()
              else buffer.getShort(base + c * 2) / 32768.0
            }
            val v = (sum / channels).coerceIn(-1.0, 1.0)
            val s16 = (v * 32767).toInt()
            mono.write(s16 and 0xff)
            mono.write((s16 shr 8) and 0xff)
            written++
            position += step
          }
          position -= frames
          codec.releaseOutputBuffer(outIndex, false)
          if (info.flags and android.media.MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outputDone = true
        }
      }
    } finally {
      codec.stop()
      codec.release()
      extractor.release()
    }
    if (written < target) return null // moins d'une seconde : rien à écouter
    val data = mono.toByteArray()
    val file = File(outPath.removePrefix("file://"))
    file.parentFile?.mkdirs()
    FileOutputStream(file).use { out ->
      val header = java.nio.ByteBuffer.allocate(44).order(java.nio.ByteOrder.LITTLE_ENDIAN)
      header.put("RIFF".toByteArray()).putInt(36 + data.size).put("WAVE".toByteArray())
      header.put("fmt ".toByteArray()).putInt(16).putShort(1).putShort(1)
        .putInt(target).putInt(target * 2).putShort(2).putShort(16)
      header.put("data".toByteArray()).putInt(data.size)
      out.write(header.array())
      out.write(data)
    }
    return file.absolutePath
  }
}
