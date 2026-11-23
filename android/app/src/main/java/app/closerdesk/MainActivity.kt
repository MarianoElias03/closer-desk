package app.closerdesk

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

sealed class Screen {
    data object Home : Screen()
    data class Offer(val id: Int) : Screen()
    data class Web(val path: String, val offerId: Int?, val title: String) : Screen()
    data object Setup : Screen()
}

class MainActivity : ComponentActivity() {
    private val stack = mutableStateListOf<Screen>(Screen.Home)
    private var signedIn by mutableStateOf(false)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val app = CloserApp.instance
        signedIn = app.prefs.signedIn
        if (signedIn) app.api.shareSessionWithWebViews()
        handle(intent)
        setContent {
            CloserTheme {
                if (!signedIn) {
                    LoginScreen(onSignedIn = {
                        signedIn = true
                        stack.clear(); stack.add(Screen.Home)
                    })
                } else {
                    val top = stack.last()
                    BackHandler(enabled = stack.size > 1) { stack.removeAt(stack.lastIndex) }
                    when (top) {
                        Screen.Home -> HomeScreen(
                            open = { stack.add(it) },
                            onSignedOut = { signedIn = false },
                            dial = ::dial
                        )
                        is Screen.Offer -> OfferScreen(top.id, open = { stack.add(it) }, back = { stack.removeAt(stack.lastIndex) }, dial = ::dial)
                        is Screen.Web -> WebScreen(top.path, top.offerId, top.title, back = { stack.removeAt(stack.lastIndex) })
                        Screen.Setup -> SetupScreen(back = { stack.removeAt(stack.lastIndex) })
                    }
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    /** From the call card or a notification: open that page. */
    private fun handle(i: Intent?) {
        val path = i?.getStringExtra("path") ?: return
        val offer = i.getIntExtra("offer", 0).takeIf { it > 0 }
        if (stack.isEmpty()) stack.add(Screen.Home)
        stack.add(Screen.Web(path, offer, "Lead"))
        i.removeExtra("path")
    }

    /** Ring a lead with the phone's own dialler; the card comes up as it connects. */
    fun dial(lead: DirLead) {
        if (lead.phone.isBlank()) return
        CallTracker.armOutgoing(this, lead.phone)
        startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + Uri.encode(lead.phone))))
    }

    companion object {
        val deviceName: String get() = "Closer Desk app on ${Build.MANUFACTURER.replaceFirstChar { it.uppercase() }} ${Build.MODEL}"
    }
}
