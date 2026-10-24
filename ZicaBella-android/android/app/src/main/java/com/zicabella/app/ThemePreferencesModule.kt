package com.zicabella.app

import android.graphics.Color
import android.view.View
import androidx.core.view.WindowCompat
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager

class ThemePreferencesModule(
  private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = NAME

  @ReactMethod
  fun setTheme(theme: String) {
    ThemePreferences.set(reactContext, theme)
    reactContext.currentActivity?.let { activity ->
      activity.runOnUiThread {
        val dark = theme == "dark"
        val bg = if (dark) Color.BLACK else Color.WHITE
        val window = activity.window ?: return@runOnUiThread
        window.navigationBarColor = bg
        window.decorView.setBackgroundColor(bg)
        activity.findViewById<View>(android.R.id.content)?.setBackgroundColor(bg)
        WindowCompat.getInsetsController(window, window.decorView).apply {
          isAppearanceLightStatusBars = !dark
          isAppearanceLightNavigationBars = !dark
        }
      }
    }
  }

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun getTheme(): String = ThemePreferences.get(reactContext)

  companion object {
    const val NAME = "ZBThemePreferences"
  }
}

/** Classic ReactPackage — avoids TurboModule registration crashes on New Arch. */
class ThemePreferencesPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(ThemePreferencesModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}
