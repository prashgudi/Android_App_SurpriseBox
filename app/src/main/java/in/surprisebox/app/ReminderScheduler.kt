package `in`.surprisebox.app

import android.Manifest
import android.R
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.annotation.RequiresPermission
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject

object ReminderScheduler {
    private const val CHANNEL_ID = "pickup_reminders"
    private const val CHANNEL_NAME = "Pickup Reminders"
    private const val CHANNEL_DESCRIPTION = "Reminder notifications for upcoming pickup slots."
    private const val PREFS_NAME = "pickup_reminder_prefs"
    private const val KEY_SCHEDULED_REMINDERS = "scheduled_reminders"
    private const val EXTRA_RESERVATION_ID = "extra_reservation_id"
    private const val EXTRA_RESTAURANT = "extra_restaurant"
    private const val EXTRA_PICKUP_SLOT = "extra_pickup_slot"
    private const val JSON_RESERVATION_ID = "reservationId"
    private const val JSON_RESTAURANT = "restaurant"
    private const val JSON_PICKUP_SLOT = "pickupSlot"
    private const val JSON_TRIGGER_AT = "triggerAtMillis"

    private data class ScheduledReminder(
        val reservationId: String,
        val restaurant: String,
        val pickupSlot: String,
        val triggerAtMillis: Long
    )

    fun scheduleReminder(
        context: Context,
        reservationId: String,
        restaurant: String,
        pickupSlot: String,
        triggerAtMillis: Long
    ) {
        if (triggerAtMillis <= System.currentTimeMillis()) return
        val reminder = ScheduledReminder(
            reservationId = reservationId,
            restaurant = restaurant,
            pickupSlot = pickupSlot,
            triggerAtMillis = triggerAtMillis
        )
        val reminders = loadStoredReminders(context)
        reminders[reservationId] = reminder
        saveStoredReminders(context, reminders)
        scheduleAlarm(context, reminder)
    }

    fun restoreReminders(context: Context) {
        val reminders = loadStoredReminders(context)
        if (reminders.isEmpty()) return

        val now = System.currentTimeMillis()
        val valid = linkedMapOf<String, ScheduledReminder>()
        reminders.values.forEach { reminder ->
            if (reminder.triggerAtMillis > now) {
                valid[reminder.reservationId] = reminder
                scheduleAlarm(context, reminder)
            }
        }
        saveStoredReminders(context, valid)
    }

    fun cancelReminder(context: Context, reservationId: String) {
        cancelAlarm(context, reservationId)
        val reminders = loadStoredReminders(context)
        if (reminders.remove(reservationId) != null) {
            saveStoredReminders(context, reminders)
        }
    }

    @RequiresPermission(Manifest.permission.POST_NOTIFICATIONS)
    fun showReminderNotification(
        context: Context,
        reservationId: String,
        restaurant: String,
        pickupSlot: String
    ) {
        cancelReminder(context, reservationId)
        if (!hasNotificationPermission(context)) return
        createNotificationChannel(context)

        val openIntent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val openPendingIntent = PendingIntent.getActivity(
            context,
            reservationId.hashCode(),
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val bodyRestaurant = restaurant.ifBlank { "Your restaurant" }
        val bodySlot = pickupSlot.ifBlank { "pickup window" }
        val text = "$bodyRestaurant pickup starts in 1 hour ($bodySlot)."

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_popup_reminder)
            .setContentTitle("Pickup reminder")
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(openPendingIntent)
            .build()

        NotificationManagerCompat.from(context).notify(reservationId.hashCode(), notification)
    }

    fun extractReservationId(intent: Intent): String {
        return intent.getStringExtra(EXTRA_RESERVATION_ID).orEmpty()
    }

    fun extractRestaurant(intent: Intent): String {
        return intent.getStringExtra(EXTRA_RESTAURANT).orEmpty()
    }

    fun extractPickupSlot(intent: Intent): String {
        return intent.getStringExtra(EXTRA_PICKUP_SLOT).orEmpty()
    }

    private fun scheduleAlarm(context: Context, reminder: ScheduledReminder) {
        createNotificationChannel(context)
        val pendingIntent = buildReminderPendingIntent(
            context = context,
            reservationId = reminder.reservationId,
            restaurant = reminder.restaurant,
            pickupSlot = reminder.pickupSlot,
            flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        ) ?: return

        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            alarmManager.setAndAllowWhileIdle(
                AlarmManager.RTC_WAKEUP,
                reminder.triggerAtMillis,
                pendingIntent
            )
        } else {
            alarmManager.set(AlarmManager.RTC_WAKEUP, reminder.triggerAtMillis, pendingIntent)
        }
    }

    private fun cancelAlarm(context: Context, reservationId: String) {
        val pendingIntent = buildReminderPendingIntent(
            context = context,
            reservationId = reservationId,
            restaurant = "",
            pickupSlot = "",
            flags = PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
        ) ?: return

        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        alarmManager.cancel(pendingIntent)
        pendingIntent.cancel()
    }

    private fun buildReminderPendingIntent(
        context: Context,
        reservationId: String,
        restaurant: String,
        pickupSlot: String,
        flags: Int
    ): PendingIntent? {
        val intent = Intent(context, PickupReminderReceiver::class.java).apply {
            putExtra(EXTRA_RESERVATION_ID, reservationId)
            putExtra(EXTRA_RESTAURANT, restaurant)
            putExtra(EXTRA_PICKUP_SLOT, pickupSlot)
        }
        return PendingIntent.getBroadcast(context, reservationId.hashCode(), intent, flags)
    }

    private fun loadStoredReminders(context: Context): LinkedHashMap<String, ScheduledReminder> {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val raw = prefs.getString(KEY_SCHEDULED_REMINDERS, null).orEmpty()
        if (raw.isBlank()) return linkedMapOf()

        val reminders = linkedMapOf<String, ScheduledReminder>()
        val array = runCatching { JSONArray(raw) }.getOrNull() ?: return linkedMapOf()
        for (index in 0 until array.length()) {
            val item = array.optJSONObject(index) ?: continue
            val reservationId = item.optString(JSON_RESERVATION_ID).trim()
            if (reservationId.isBlank()) continue
            reminders[reservationId] = ScheduledReminder(
                reservationId = reservationId,
                restaurant = item.optString(JSON_RESTAURANT),
                pickupSlot = item.optString(JSON_PICKUP_SLOT),
                triggerAtMillis = item.optLong(JSON_TRIGGER_AT, 0L)
            )
        }
        return reminders
    }

    private fun saveStoredReminders(
        context: Context,
        reminders: Map<String, ScheduledReminder>
    ) {
        val array = JSONArray()
        reminders.values.forEach { reminder ->
            array.put(
                JSONObject().apply {
                    put(JSON_RESERVATION_ID, reminder.reservationId)
                    put(JSON_RESTAURANT, reminder.restaurant)
                    put(JSON_PICKUP_SLOT, reminder.pickupSlot)
                    put(JSON_TRIGGER_AT, reminder.triggerAtMillis)
                }
            )
        }

        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_SCHEDULED_REMINDERS, array.toString())
            .apply()
    }

    private fun createNotificationChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val existing = manager.getNotificationChannel(CHANNEL_ID)
        if (existing != null) return

        val channel = NotificationChannel(
            CHANNEL_ID,
            CHANNEL_NAME,
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = CHANNEL_DESCRIPTION
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
}
