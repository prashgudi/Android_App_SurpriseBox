package `in`.surprisebox.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private val notificationPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            emitNotificationPermissionResult(granted)
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        val splashScreen = installSplashScreen()
        var keepSplash = true
        Handler(Looper.getMainLooper()).postDelayed({ keepSplash = false }, 50)
        splashScreen.setKeepOnScreenCondition { keepSplash }

        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        ReminderScheduler.restoreReminders(applicationContext)

        webView = findViewById(R.id.webView)
        configureWebView()
        webView.loadUrl("file:///android_asset/www/index.html")
        requestPushTokenFromFirebase()

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack()
                } else {
                    finish()
                }
            }
        })
    }

    private fun configureWebView() {
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.allowFileAccess = true
        webView.settings.allowContentAccess = true
        webView.settings.allowFileAccessFromFileURLs = true
        webView.settings.allowUniversalAccessFromFileURLs = true
        webView.settings.setSupportZoom(false)
        webView.webChromeClient = WebChromeClient()
        webView.addJavascriptInterface(AppBridge(), "SurpriseNative")

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView?,
                request: WebResourceRequest?
            ): Boolean {
                val url = request?.url ?: return false
                val scheme = url.scheme.orEmpty()
                if (scheme == "http" || scheme == "https" || scheme == "geo" || scheme == "tel") {
                    startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url.toString())))
                    return true
                }
                return false
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                emitPushToken(PushTokenManager.getStoredToken(applicationContext))
            }
        }
    }

    private fun isNotificationPermissionGranted(): Boolean {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            emitNotificationPermissionResult(true)
            return
        }
        if (isNotificationPermissionGranted()) {
            emitNotificationPermissionResult(true)
            return
        }
        notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    private fun emitNotificationPermissionResult(granted: Boolean) {
        if (!::webView.isInitialized) return
        val grantedLiteral = if (granted) "true" else "false"
        val js = "window.onNativeNotificationPermissionResult && window.onNativeNotificationPermissionResult($grantedLiteral);"
        webView.post { webView.evaluateJavascript(js, null) }
    }

    private fun requestPushTokenFromFirebase() {
        PushTokenManager.requestPushToken(applicationContext) { token ->
            emitPushToken(token)
        }
    }

    private fun emitPushToken(token: String) {
        if (!::webView.isInitialized) return
        if (token.isBlank()) return
        val escapedToken = token.replace("\\", "\\\\").replace("'", "\\'")
        val js = "window.onNativePushToken && window.onNativePushToken('$escapedToken');"
        webView.post { webView.evaluateJavascript(js, null) }
    }

    private inner class AppBridge {
        @JavascriptInterface
        fun schedulePickupReminder(
            reservationId: String?,
            restaurant: String?,
            pickupSlot: String?,
            triggerAtMillis: Long
        ) {
            val safeReservationId = reservationId?.trim().orEmpty()
            if (safeReservationId.isEmpty()) return
            ReminderScheduler.scheduleReminder(
                applicationContext,
                safeReservationId,
                restaurant?.trim().orEmpty(),
                pickupSlot?.trim().orEmpty(),
                triggerAtMillis
            )
        }

        @JavascriptInterface
        fun cancelPickupReminder(reservationId: String?) {
            val safeReservationId = reservationId?.trim().orEmpty()
            if (safeReservationId.isEmpty()) return
            ReminderScheduler.cancelReminder(applicationContext, safeReservationId)
        }

        @JavascriptInterface
        fun isNotificationPermissionGranted(): Boolean = this@MainActivity.isNotificationPermissionGranted()

        @JavascriptInterface
        fun requestNotificationPermission() {
            runOnUiThread { this@MainActivity.requestNotificationPermission() }
        }

        @JavascriptInterface
        fun getPushToken(): String {
            return PushTokenManager.getStoredToken(applicationContext)
        }

        @JavascriptInterface
        fun requestPushToken() {
            runOnUiThread { requestPushTokenFromFirebase() }
        }
    }

    override fun onDestroy() {
        webView.apply {
            stopLoading()
            clearHistory()
            removeAllViews()
            destroy()
        }
        super.onDestroy()
    }
}
