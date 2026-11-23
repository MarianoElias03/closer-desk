package app.closerdesk

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.provider.Settings
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * The floating lead card over the call screen, like Zoho's: who it is, which offer, where they're at,
 * the last reason and note. Drag it up or down; Open jumps to the lead, the cross hides it.
 * Needs "Display over other apps".
 */
object CallOverlay {
    private var view: View? = null

    fun canShow(c: Context) = Settings.canDrawOverlays(c)

    @SuppressLint("ClickableViewAccessibility")
    fun show(c: Context, m: Match, incoming: Boolean) {
        if (!canShow(c)) return
        hide()
        val ctx = c.applicationContext
        val wm = ctx.getSystemService(WindowManager::class.java)
        fun dp(v: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), ctx.resources.displayMetrics).toInt()
        fun text(s: String, size: Float, color: Int, bold: Boolean = false, lines: Int = 1) = TextView(ctx).apply {
            text = s
            setTextSize(TypedValue.COMPLEX_UNIT_SP, size)
            setTextColor(color)
            if (bold) typeface = Typeface.DEFAULT_BOLD
            maxLines = lines
            ellipsize = TextUtils.TruncateAt.END
        }

        val ink = Color.parseColor("#1A2433")
        val ink2 = Color.parseColor("#4B5667")
        val card = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(14), dp(16), dp(12))
            background = GradientDrawable().apply {
                cornerRadius = dp(18).toFloat()
                setColor(Color.WHITE)
                setStroke(dp(1), Color.parseColor("#D4D9E0"))
            }
            elevation = dp(10).toFloat()
        }

        val (top, name, sub, status, extra, leadId, offerId) = when (m) {
            is Match.Lead -> {
                val l = m.lead
                Card(
                    "${if (incoming) "Incoming" else "Calling"} · ${l.offer}",
                    l.name,
                    listOf(l.contact.takeIf { l.business.isNotBlank() && it.isNotBlank() }, l.phone, l.suburb.ifBlank { null }).filterNotNull().joinToString("  ·  "),
                    listOf(l.status, l.reason.ifBlank { null }).filterNotNull().joinToString(", ") +
                        (l.followUp?.let { "  ·  follow up ${day(it)}" } ?: "") +
                        (l.call?.let { "  ·  call ${whenText(it.start)}" } ?: ""),
                    listOfNotNull(
                        l.lastContactAt?.let { "Last contact ${whenText(it)}" + (if (l.attempts > 0) ", ${l.attempts} call${if (l.attempts == 1) "" else "s"}" else "") },
                        l.lastNote.ifBlank { null },
                        if ("call" in l.doNotContact) "Asked not to be called" else null
                    ).joinToString("\n"),
                    l.id,
                    l.offerId
                )
            }
            is Match.Call -> {
                val k = m.call
                Card("${if (incoming) "Incoming" else "Calling"} · ${k.offer}", k.prospect ?: "Booked prospect", k.phone, "Booked call ${whenText(k.start)}", k.title ?: "", null, k.offerId)
            }
        }

        card.addView(text(top.uppercase(Locale.getDefault()), 11f, Color.parseColor("#7A8494"), bold = true))
        card.addView(text(name, 20f, ink, bold = true).apply { setPadding(0, dp(2), 0, 0) })
        if (sub.isNotBlank()) card.addView(text(sub, 13.5f, ink2))
        if (status.isNotBlank()) card.addView(text(status, 14f, ink, bold = true, lines = 2).apply { setPadding(0, dp(8), 0, 0) })
        if (extra.isNotBlank()) card.addView(text(extra, 13f, ink2, lines = 4).apply { setPadding(0, dp(4), 0, 0) })

        val row = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.END
            setPadding(0, dp(8), 0, 0)
        }
        fun button(label: String, onClick: () -> Unit) = Button(ctx, null, android.R.attr.borderlessButtonStyle).apply {
            text = label
            isAllCaps = false
            setTextColor(Color.parseColor("#2563C9"))
            setOnClickListener { onClick() }
        }
        row.addView(button("Hide") { hide() })
        row.addView(button("Open") {
            hide()
            val i = Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            if (leadId != null) i.putExtra("path", "/leads/$leadId").putExtra("offer", offerId)
            else if (m is Match.Call) i.putExtra("path", "/closing?open=${android.net.Uri.encode(m.call.id)}#calls").putExtra("offer", offerId)
            ctx.startActivity(i)
        })
        card.addView(row)

        // a little narrower than the screen, and below the ringing banner at the top
        val metrics = ctx.resources.displayMetrics
        val lp = WindowManager.LayoutParams(
            metrics.widthPixels - dp(24),
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            y = (metrics.heightPixels * 0.30).toInt()
        }
        // drag up or down out of the way of the call buttons
        var startY = 0f
        var startPos = 0
        card.setOnTouchListener { v, e ->
            when (e.action) {
                MotionEvent.ACTION_DOWN -> { startY = e.rawY; startPos = lp.y; false }
                MotionEvent.ACTION_MOVE -> {
                    lp.y = (startPos + (e.rawY - startY)).toInt().coerceAtLeast(0)
                    runCatching { wm.updateViewLayout(v, lp) }
                    true
                }
                else -> false
            }
        }
        runCatching {
            wm.addView(card, lp)
            view = card
        }
    }

    fun hide() {
        val v = view ?: return
        view = null
        runCatching { v.context.getSystemService(WindowManager::class.java).removeView(v) }
    }

    private data class Card(val top: String, val name: String, val sub: String, val status: String, val extra: String, val leadId: Int?, val offerId: Int)

    private fun zone() = ZoneId.of(CloserApp.instance.directory.data.value?.tz ?: "Australia/Brisbane")
    private fun day(d: String): String = runCatching {
        val date = LocalDate.parse(d)
        val today = LocalDate.now(zone())
        when (date) {
            today -> "today"
            today.plusDays(1) -> "tomorrow"
            else -> date.format(DateTimeFormatter.ofPattern("EEE d MMM"))
        }
    }.getOrDefault(d)

    /** "today 2:30 pm", "Tue 25 Nov", from an ISO instant. */
    fun whenText(iso: String): String = runCatching {
        val t = Instant.parse(iso).atZone(zone())
        val today = LocalDate.now(zone())
        val time = t.format(DateTimeFormatter.ofPattern("h:mm a")).lowercase()
        when (t.toLocalDate()) {
            today -> "today $time"
            today.minusDays(1) -> "yesterday $time"
            today.plusDays(1) -> "tomorrow $time"
            else -> t.format(DateTimeFormatter.ofPattern("EEE d MMM"))
        }
    }.getOrDefault(iso)
}
