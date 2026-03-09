package `in`.surprisebox.app

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class SurpriseFirebaseMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        PushTokenManager.saveToken(applicationContext, token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val title = message.notification?.title
            ?: message.data["title"]
            ?: "SurpriseBox"
        val body = message.notification?.body
            ?: message.data["body"]
            ?: "You have a new update."
        showPushNotification(applicationContext, title, body)
    }

    private fun showPushNotification(context: Context, title: String, body: String) {
        if (!hasNotificationPermission(context)) return
        ensurePushChannel(context)

        val openIntent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val openPendingIntent = PendingIntent.getActivity(
            context,
            (System.currentTimeMillis() % Int.MAX_VALUE).toInt(),
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(context, PUSH_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(openPendingIntent)
            .build()

        NotificationManagerCompat.from(context)
            .notify((System.currentTimeMillis() % Int.MAX_VALUE).toInt(), notification)
    }

    private fun ensurePushChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val existing = manager.getNotificationChannel(PUSH_CHANNEL_ID)
        if (existing != null) return

        val channel = NotificationChannel(
            PUSH_CHANNEL_ID,
            "Push Updates",
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "Reservation, reminder, and listing push updates."
        }
        manager.createNotificationChannel(channel)
    }

    private fun hasNotificationPermission(context: Context): Boolean {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
    }

    companion object {
        private const val PUSH_CHANNEL_ID = "push_updates"
    }
}
