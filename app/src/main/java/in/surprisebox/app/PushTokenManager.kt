package `in`.surprisebox.app

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging

object PushTokenManager {
    private const val PREFS_NAME = "push_prefs"
    private const val KEY_FCM_TOKEN = "fcm_token"

    fun getStoredToken(context: Context): String {
        return context
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString(KEY_FCM_TOKEN, "")
            .orEmpty()
    }

    fun saveToken(context: Context, token: String) {
        if (token.isBlank()) return
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_FCM_TOKEN, token)
            .apply()
    }

    fun requestPushToken(context: Context, onToken: (String) -> Unit) {
        val cachedToken = getStoredToken(context)
        if (cachedToken.isNotBlank()) {
            onToken(cachedToken)
        }
        try {
            if (FirebaseApp.getApps(context).isEmpty()) {
                val initialized = FirebaseApp.initializeApp(context)
                if (initialized == null) return
            }
            FirebaseMessaging.getInstance().token
                .addOnCompleteListener { task ->
                    if (!task.isSuccessful) return@addOnCompleteListener
                    val token = task.result.orEmpty()
                    if (token.isBlank()) return@addOnCompleteListener
                    saveToken(context, token)
                    onToken(token)
                }
        } catch (_: Throwable) {
            // Firebase may not be configured on all builds/environments.
        }
    }
}
