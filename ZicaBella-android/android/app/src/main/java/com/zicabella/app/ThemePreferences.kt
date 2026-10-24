package com.zicabella.app

import android.content.Context
import androidx.appcompat.app.AppCompatDelegate
import java.io.File

/**
 * Launch/splash theme preference.
 * Written from JS via ZBThemePreferences; read in MainActivity before splash.
 */
object ThemePreferences {
  private const val PREFS = "zb_theme_prefs"
  private const val KEY = "theme"
  private const val FILE_NAME = "app-theme.txt"

  fun getExplicit(context: Context): String? {
    return try {
      val fromPrefs = context
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .getString(KEY, null)
        ?.trim()
      if (fromPrefs == "dark" || fromPrefs == "light") return fromPrefs

      val fromFile = try {
        File(context.filesDir, FILE_NAME).takeIf { it.isFile }?.readText()?.trim()
      } catch (_: Exception) {
        null
      }
      if (fromFile == "dark" || fromFile == "light") {
        try {
          context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY, fromFile)
            .commit()
        } catch (_: Exception) {
        }
        return fromFile
      }
      null
    } catch (_: Exception) {
      null
    }
  }

  fun get(context: Context): String {
    val explicit = getExplicit(context)
    if (explicit == "dark") return "dark"
    return "light"
  }

  fun isDark(context: Context): Boolean = get(context) == "dark"

  fun set(context: Context, theme: String) {
    val normalized = if (theme == "dark") "dark" else "light"
    try {
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit()
        .putString(KEY, normalized)
        .commit()
    } catch (_: Exception) {
    }

    try {
      File(context.filesDir, FILE_NAME).writeText(normalized)
    } catch (_: Exception) {
    }

    try {
      AppCompatDelegate.setDefaultNightMode(
        if (normalized == "dark") AppCompatDelegate.MODE_NIGHT_YES
        else AppCompatDelegate.MODE_NIGHT_NO
      )
    } catch (_: Exception) {
    }
  }
}
