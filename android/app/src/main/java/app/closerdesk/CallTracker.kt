package app.closerdesk

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat

/**
 * Follows one phone call from ringing (or dialling) to hang-up, across the caller ID service and the
 * phone-state broadcasts. State is kept in preferences because Android can start a fresh process for
 * each broadcast.
 */
object CallTracker {
    private fun sp(c: Context) = c.getSharedPreferences("call", Context.MODE_PRIVATE)

    /** A call started: remember it and show the lead card if the number is someone in Closer Desk. */
    fun begin(c: Context, number: String?, incoming: Boolean) {
        val app = CloserApp.instance
        if (!app.prefs.signedIn) return
        val key = Directory.phoneKey(number) ?: return
        val s = sp(c)
        // the same call reported twice (caller ID service, then the broadcast): keep the first
        if (s.getString("key", null) == key && System.currentTimeMillis() - s.getLong("at", 0) < 90_000) return
        s.edit().remove("match").putString("key", key).putString("number", number).putBoolean("incoming", incoming)
            .putLong("at", System.currentTimeMillis()).putBoolean("connected", !incoming).putBoolean("done", false).apply()
        val m = app.directory.match(number) ?: return
        s.edit().putString("match", when (m) {
            is Match.Lead -> "lead:${m.lead.id}"
            is Match.Call -> "call:${m.call.id}"
        }).apply()
        if (app.prefs.overlayOn) CallOverlay.show(c, m, incoming)
    }

    /** You tapped call in the app: remember the number, so the card shows when the call starts even without call log access. */
    fun armOutgoing(c: Context, number: String) =
        sp(c).edit().putString("pending_out", number).putLong("pending_at", System.currentTimeMillis()).apply()

    /** The number you just tapped to call in the app, if it was in the last two minutes. */
    fun pendingOutgoing(c: Context): String? {
        val s = sp(c)
        val n = s.getString("pending_out", null) ?: return null
        s.edit().remove("pending_out").apply()
        return if (System.currentTimeMillis() - s.getLong("pending_at", 0) < 120_000) n else null
    }

    /** They picked up (incoming) or the outgoing call went through. */
    fun connected(c: Context) = sp(c).edit().putBoolean("connected", true).apply()

    /** Hung up: hide the card and offer to log the call. */
    fun end(c: Context) {
        CallOverlay.hide()
        val s = sp(c)
        if (s.getBoolean("done", true)) return
        s.edit().putBoolean("done", true).apply()
        val match = s.getString("match", null) ?: return
        val incoming = s.getBoolean("incoming", false)
        val connected = s.getBoolean("connected", false)
        s.edit().remove("match").remove("key").apply()
        notifyAfterCall(c, match, incoming, connected)
    }

    private fun notifyAfterCall(c: Context, match: String, incoming: Boolean, connected: Boolean) {
        val app = CloserApp.instance
        val (kind, id) = match.split(":", limit = 2)
        val title: String
        val text: String
        val intent: Intent
        if (kind == "lead") {
            val lead = app.directory.lead(id.toInt()) ?: return
            title = when {
                incoming && !connected -> "Missed call from ${lead.name}"
                incoming -> "Call with ${lead.name}"
                else -> "You called ${lead.name}"
            }
            text = if (lead.mode == "closing") "${lead.offer}. Tap to open the lead." else "${lead.offer}. Tap to log the outcome."
            intent = Intent(c, PostCallActivity::class.java).putExtra("lead", lead.id).putExtra("incoming", incoming)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        } else {
            val call = app.directory.data.value?.calls?.firstOrNull { it.id == id } ?: return
            title = "${if (incoming) "Call with" else "You called"} ${call.prospect ?: "your booked prospect"}"
            text = "${call.offer}. Tap to open the call and log it."
            intent = Intent(c, MainActivity::class.java).putExtra("path", "/closing?open=${android.net.Uri.encode(call.id)}#calls")
                .putExtra("offer", call.offerId).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        val pi = PendingIntent.getActivity(c, match.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val n = NotificationCompat.Builder(c, CloserApp.CHANNEL_CALLS)
            .setSmallIcon(android.R.drawable.sym_action_call)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(pi)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .build()
        runCatching { c.getSystemService(NotificationManager::class.java).notify(NOTE_ID, n) }
    }

    const val NOTE_ID = 7001
}
