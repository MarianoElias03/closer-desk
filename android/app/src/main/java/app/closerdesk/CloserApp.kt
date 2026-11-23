package app.closerdesk

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager

class CloserApp : Application() {
    lateinit var prefs: Prefs
    lateinit var api: Api
    lateinit var directory: Directory

    override fun onCreate() {
        super.onCreate()
        instance = this
        prefs = Prefs(this)
        api = Api(prefs)
        directory = Directory(this, api)
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL_CALLS, "After a call", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Log the outcome of a call with a lead"
            }
        )
    }

    companion object {
        const val CHANNEL_CALLS = "calls"
        lateinit var instance: CloserApp
    }
}
