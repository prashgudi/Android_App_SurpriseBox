package `in`.surprisebox.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class PickupReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val reservationId = ReminderScheduler.extractReservationId(intent)
        if (reservationId.isBlank()) return

        ReminderScheduler.showReminderNotification(
            context = context,
            reservationId = reservationId,
            restaurant = ReminderScheduler.extractRestaurant(intent),
            pickupSlot = ReminderScheduler.extractPickupSlot(intent)
        )
    }
}
