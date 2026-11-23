package app.closerdesk

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.telephony.TelephonyManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * Ringing, answered/dialled, hung up. With call log access Android includes the number, for incoming
 * and outgoing calls (it sends each change twice, once without the number; we wait for the one with it).
 */
class PhoneStateReceiver : BroadcastReceiver() {
    override fun onReceive(c: Context, intent: Intent) {
        val state = intent.getStringExtra(TelephonyManager.EXTRA_STATE) ?: return
        @Suppress("DEPRECATION")
        val number = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER)
        val sp = c.getSharedPreferences("call", Context.MODE_PRIVATE)
        val prev = sp.getString("state", TelephonyManager.EXTRA_STATE_IDLE)
        when (state) {
            TelephonyManager.EXTRA_STATE_RINGING -> {
                if (number != null) CallTracker.begin(c, number, incoming = true)
            }
            TelephonyManager.EXTRA_STATE_OFFHOOK -> {
                if (prev == TelephonyManager.EXTRA_STATE_RINGING) CallTracker.connected(c)
                else (number ?: CallTracker.pendingOutgoing(c))?.let { CallTracker.begin(c, it, incoming = false) }
            }
            TelephonyManager.EXTRA_STATE_IDLE -> {
                if (prev != TelephonyManager.EXTRA_STATE_IDLE) {
                    CallTracker.end(c)
                    // pick up anything that changed (e.g. logged from the web) for next time
                    val done = goAsync()
                    CoroutineScope(Dispatchers.IO).launch {
                        runCatching { CloserApp.instance.directory.refresh() }
                        done.finish()
                    }
                }
            }
        }
        sp.edit().putString("state", state).apply()
    }
}
