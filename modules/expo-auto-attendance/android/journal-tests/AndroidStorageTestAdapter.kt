package android.content

import java.io.File
import java.io.FileOutputStream
import java.util.Properties

/** JVM adapter only. It does not emulate Android receiver or process lifecycle. */
open class Context(val directory: File) {
  val applicationContext: Context get() = this

  fun getSharedPreferences(name: String, mode: Int): SharedPreferences =
    FilePreferences(File(directory, "$name.properties"))

  companion object {
    const val MODE_PRIVATE = 0
  }
}

interface SharedPreferences {
  fun getString(key: String, default: String?): String?
  fun getBoolean(key: String, default: Boolean): Boolean
  fun edit(): Editor

  interface Editor {
    fun putString(key: String, value: String?): Editor
    fun putBoolean(key: String, value: Boolean): Editor
    fun remove(key: String): Editor
    fun commit(): Boolean
  }
}

private class FilePreferences(private val file: File) : SharedPreferences {
  private fun read(): Properties = Properties().also { values ->
    if (file.exists()) file.inputStream().use { values.load(it) }
  }

  override fun getString(key: String, default: String?): String? = read().getProperty(key, default)

  override fun getBoolean(key: String, default: Boolean): Boolean =
    read().getProperty(key)?.toBooleanStrict() ?: default

  override fun edit(): SharedPreferences.Editor = object : SharedPreferences.Editor {
    private val replacements = mutableMapOf<String, String?>()

    override fun putString(key: String, value: String?): SharedPreferences.Editor =
      apply { replacements[key] = value }

    override fun putBoolean(key: String, value: Boolean): SharedPreferences.Editor =
      apply { replacements[key] = value.toString() }

    override fun remove(key: String): SharedPreferences.Editor = apply { replacements[key] = null }

    override fun commit(): Boolean {
      val values = read()
      replacements.forEach { (key, value) ->
        if (value == null) values.remove(key) else values.setProperty(key, value)
      }
      val temporary = File(file.parentFile, "${file.name}.tmp")
      FileOutputStream(temporary).use { output ->
        values.store(output, null)
        output.fd.sync()
      }
      return temporary.renameTo(file)
    }
  }
}
