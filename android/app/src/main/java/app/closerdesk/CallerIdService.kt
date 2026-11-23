package app.closerdesk

import android.os.Handler
import android.os.Looper
import android.telecom.Call
import android.telecom.CallScreeningService

/**
 * Android asks the Caller ID app about each incoming call as it arrives, which is the earliest moment
 * to show who it is. We never block or silence anything.
 */
class CallerIdService : CallScreeningService() {
    override fun onScreenCall(details: Call.Details) {
        respondToCall(details, CallResponse.Builder().build())
        if (details.callDirection != Call.Details.DIRECTION_INCOMING) return
        val number = details.handle?.schemeSpecificPart ?: return
        Handler(Looper.getMainLooper()).post { CallTracker.begin(applicationContext, number, incoming = true) }
    }
}
