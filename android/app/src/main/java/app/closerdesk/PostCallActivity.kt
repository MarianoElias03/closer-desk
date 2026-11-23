package app.closerdesk

import android.app.DatePickerDialog
import android.app.NotificationManager
import android.app.TimePickerDialog
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * "How did that go?" after a call with a lead: the same outcome pad as the lead page, a reason (required),
 * an optional note, and the call-back or booked-call time where it's needed.
 */
class PostCallActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val app = CloserApp.instance
        getSystemService(NotificationManager::class.java).cancel(CallTracker.NOTE_ID)
        val lead = app.directory.lead(intent.getIntExtra("lead", 0))
        if (lead == null || !app.prefs.signedIn || lead.mode == "closing") {
            // closing-only offers have no pad: open the lead page instead
            if (lead != null) startActivity(Intent(this, MainActivity::class.java).putExtra("path", "/leads/${lead.id}").putExtra("offer", lead.offerId))
            finish()
            return
        }
        setContent { CloserTheme { LogSheet(lead, onDone = { finish() }, openLead = {
            startActivity(Intent(this, MainActivity::class.java).putExtra("path", "/leads/${lead.id}").putExtra("offer", lead.offerId))
            finish()
        }) } }
    }
}

@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
private fun LogSheet(lead: DirLead, onDone: () -> Unit, openLead: () -> Unit) {
    val app = CloserApp.instance
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val zone = ZoneId.of(app.directory.data.value?.tz ?: "Australia/Brisbane")
    val today = LocalDate.now(zone)
    val pads = Outcomes.forMode(lead.mode)
    var outcome by remember { mutableStateOf<Outcome?>(null) }
    var reason by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    var date by remember { mutableStateOf(today.plusDays(1)) }
    var time by remember { mutableStateOf("") }
    var alreadyBooked by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var err by remember { mutableStateOf<String?>(null) }
    val needsWhen = outcome?.key == "callback" || (outcome?.key == "booked" && lead.mode == "sdr" && lead.call == null && !alreadyBooked)

    fun pickDate() = DatePickerDialog(ctx, { _, y, m, d -> date = LocalDate.of(y, m + 1, d) }, date.year, date.monthValue - 1, date.dayOfMonth)
        .apply { datePicker.minDate = today.atStartOfDay(zone).toInstant().toEpochMilli() }.show()
    fun pickTime() = TimePickerDialog(ctx, { _, h, m -> time = "%02d:%02d".format(h, m) }, 10, 0, false).show()

    fun submit() {
        val o = outcome ?: return
        if (reason.isBlank()) { err = "Pick a reason"; return }
        if (needsWhen && time.isBlank()) { err = if (o.key == "callback") "Pick a time for the callback" else "Pick the time of the call"; return }
        busy = true; err = null
        val d = date.format(DateTimeFormatter.ISO_LOCAL_DATE)
        val body = buildJsonObject {
            put("outcome", o.key)
            put("reason", reason.trim())
            put("note", note.trim())
            if (o.key == "callback") { put("followUp", d); put("followUpTime", time) }
            if (o.key == "booked") {
                if (needsWhen) { put("bookDate", d); put("bookTime", time) } else put("bookSkip", true)
            }
        }
        scope.launch {
            try {
                app.api.logOutcome(lead, body)
                runCatching { app.directory.refresh() }
                android.widget.Toast.makeText(ctx, "${lead.name}: ${o.label.lowercase()}, ${reason.lowercase()}", android.widget.Toast.LENGTH_SHORT).show()
                onDone()
            } catch (e: Exception) {
                err = e.message
                busy = false
            }
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(C.chalk)
            .statusBarsPadding()
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text(lead.offer.uppercase(), fontSize = 11.sp, fontWeight = FontWeight.Bold, color = C.ink3)
        Text(lead.name, fontSize = 26.sp, fontWeight = FontWeight.ExtraBold)
        Text(listOf(lead.status, lead.reason).filter { it.isNotBlank() }.joinToString(", "), color = C.ink2)
        Text(if (lead.mode == "dm") "How did it go?" else "How did the call go?", fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 8.dp))
        // the pads, two per row
        pads.chunked(2).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                row.forEach { o ->
                    val on = outcome?.key == o.key
                    Box(
                        Modifier
                            .weight(1f)
                            .height(56.dp)
                            .clip(RoundedCornerShape(14.dp))
                            .background(Color(o.color).copy(alpha = if (on) 0.28f else 0.12f))
                            .border(if (on) 2.dp else 0.dp, Color(o.color), RoundedCornerShape(14.dp))
                            .clickable { outcome = o; reason = "" },
                        contentAlignment = androidx.compose.ui.Alignment.Center
                    ) { Text(o.label, fontWeight = FontWeight.Bold) }
                }
                if (row.size == 1) Spacer(Modifier.weight(1f))
            }
        }
        val o = outcome
        if (o != null) {
            Text("${o.label}: why?", fontWeight = FontWeight.Bold)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                app.directory.reasons(lead.offerId, o.key).forEach { r ->
                    FilterChip(reason == r, { reason = r }, label = { Text(r) })
                }
            }
            OutlinedTextField(reason, { reason = it.take(80) }, label = { Text("Reason") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            if (o.key == "booked" && lead.mode == "sdr" && lead.call == null) {
                Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                    Checkbox(alreadyBooked, { alreadyBooked = it })
                    Text("Already on my calendar")
                }
            }
            if (needsWhen) {
                Text(if (o.key == "callback") "Call back on" else "Call on", fontWeight = FontWeight.Bold)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { pickDate() }) { Text(date.format(DateTimeFormatter.ofPattern("EEE d MMM"))) }
                    OutlinedButton(onClick = { pickTime() }) { Text(time.ifBlank { "Pick a time" }) }
                }
                Text(if (o.key == "callback") "Goes on your calendar as a 15-minute slot." else "Goes on your calendar as a 1-hour call.", color = C.ink3, fontSize = 12.sp)
            }
        }
        OutlinedTextField(note, { note = it }, label = { Text("Note (optional)") }, minLines = 2, modifier = Modifier.fillMaxWidth())
        ErrorNote(err)
        Button(onClick = { submit() }, enabled = !busy && outcome != null, modifier = Modifier.fillMaxWidth().height(50.dp)) {
            Text(if (busy) "Saving" else "Log it")
        }
        Row {
            TextButton(onClick = openLead) { Text("Open the lead") }
            Spacer(Modifier.weight(1f))
            TextButton(onClick = onDone) { Text("Not now") }
        }
    }
}
