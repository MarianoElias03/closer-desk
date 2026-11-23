package app.closerdesk

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// "bumper plates on chalk", same palette as the web app
object C {
    val chalk = Color(0xFFE8EBEF)
    val surface = Color(0xFFF6F7F9)
    val raised = Color.White
    val ink = Color(0xFF1A2433)
    val ink2 = Color(0xFF4B5667)
    val ink3 = Color(0xFF7A8494)
    val line = Color(0xFFD4D9E0)
    val red = Color(0xFFD7263D)
    val blue = Color(0xFF2563C9)
    val yellow = Color(0xFFF2B705)
    val green = Color(0xFF1E9E5A)
}

@Composable
fun CloserTheme(content: @Composable () -> Unit) = MaterialTheme(
    colorScheme = lightColorScheme(
        primary = C.ink,
        onPrimary = Color.White,
        secondary = C.blue,
        background = C.chalk,
        surface = C.raised,
        onSurface = C.ink,
        onBackground = C.ink,
        surfaceVariant = C.surface,
        outline = C.line,
        error = C.red
    ),
    content = content
)

fun stageColor(stage: String): Color = when (stage) {
    "booked" -> C.blue
    "callback", "call_callback" -> C.yellow
    "not_interested", "call_not_interested", "not_converted" -> C.red
    "call_closed", "converted" -> C.green
    "new" -> C.line
    else -> C.ink3
}
