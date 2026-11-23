package app.closerdesk

import android.Manifest
import android.annotation.SuppressLint
import android.app.role.RoleManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.view.ViewGroup
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import kotlinx.coroutines.launch
import java.text.NumberFormat
import java.util.Locale

// ---------- little pieces ----------

private val money = NumberFormat.getCurrencyInstance(Locale("en", "AU")).apply { maximumFractionDigits = 0 }
fun money(v: Double) = money.format(v)
fun pct(v: Double?) = if (v == null) "–" else "${"%.1f".format(v * 100)}%"

@Composable
fun Panel(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) = Column(
    modifier
        .fillMaxWidth()
        .clip(RoundedCornerShape(18.dp))
        .background(C.surface)
        .padding(16.dp),
    content = content
)

@Composable
fun Stat(label: String, value: String, color: Color = C.ink, modifier: Modifier = Modifier) = Column(modifier) {
    Text(value, fontSize = 22.sp, fontWeight = FontWeight.ExtraBold, color = color, maxLines = 1)
    Text(label, fontSize = 12.sp, color = C.ink3, maxLines = 1, overflow = TextOverflow.Ellipsis)
}

@Composable
fun TopBar(title: String, back: (() -> Unit)? = null, actions: @Composable RowScope.() -> Unit = {}) = Row(
    Modifier
        .fillMaxWidth()
        .statusBarsPadding()
        .padding(horizontal = 8.dp, vertical = 6.dp),
    verticalAlignment = Alignment.CenterVertically
) {
    if (back != null) IconButton(onClick = back) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
    else Spacer(Modifier.width(12.dp))
    Text(title, fontSize = 22.sp, fontWeight = FontWeight.ExtraBold, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
    actions()
}

@Composable
fun ErrorNote(msg: String?) {
    if (msg != null) Text(msg, color = C.red, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, modifier = Modifier.padding(vertical = 6.dp))
}

/** Runs [block] every time the screen comes back to the front. */
@Composable
fun OnResume(block: () -> Unit) {
    val owner = LocalLifecycleOwner.current
    DisposableEffect(owner) {
        val o = LifecycleEventObserver { _, e -> if (e == Lifecycle.Event.ON_RESUME) block() }
        owner.lifecycle.addObserver(o)
        onDispose { owner.lifecycle.removeObserver(o) }
    }
}

// ---------- sign in ----------

@Composable
fun LoginScreen(onSignedIn: () -> Unit) {
    val app = CloserApp.instance
    val scope = rememberCoroutineScope()
    var server by remember { mutableStateOf(app.prefs.server) }
    var user by remember { mutableStateOf("") }
    var pass by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var err by remember { mutableStateOf<String?>(null) }
    Column(
        Modifier
            .fillMaxSize()
            .background(C.chalk)
            .statusBarsPadding()
            .imePadding()
            .padding(20.dp),
        verticalArrangement = Arrangement.Center
    ) {
        Panel {
            Text("Closer Desk", fontSize = 28.sp, fontWeight = FontWeight.ExtraBold)
            Text("Sign in with your Closer Desk username and password.", color = C.ink2, modifier = Modifier.padding(bottom = 12.dp))
            OutlinedTextField(server, { server = it }, label = { Text("Closer Desk address") }, singleLine = true,
                placeholder = { Text("https://…") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri), modifier = Modifier.fillMaxWidth())
            OutlinedTextField(user, { user = it }, label = { Text("Username") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(pass, { pass = it }, label = { Text("Password") }, singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done), modifier = Modifier.fillMaxWidth())
            ErrorNote(err)
            Button(
                onClick = {
                    busy = true; err = null
                    scope.launch {
                        try {
                            app.api.login(server, user.trim(), pass, MainActivity.deviceName)
                            runCatching { app.directory.refresh() }
                            onSignedIn()
                        } catch (e: Exception) {
                            err = e.message
                        } finally {
                            busy = false
                        }
                    }
                },
                enabled = !busy && server.isNotBlank() && user.isNotBlank() && pass.isNotBlank(),
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp).height(48.dp)
            ) { Text(if (busy) "One moment" else "Sign in") }
            Text("Your phone needs Tailscale on to reach Closer Desk.", color = C.ink3, fontSize = 12.sp, modifier = Modifier.padding(top = 10.dp))
        }
    }
}

// ---------- every offer ----------

private var lastDashboard: Dashboard? = null

@Composable
fun HomeScreen(open: (Screen) -> Unit, onSignedOut: () -> Unit, dial: (DirLead) -> Unit) {
    val app = CloserApp.instance
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var dash by remember { mutableStateOf(lastDashboard) }
    var err by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(false) }
    var q by remember { mutableStateOf("") }
    var menu by remember { mutableStateOf(false) }
    var ready by remember { mutableStateOf(callSetupDone(ctx)) }
    val dir by app.directory.data.collectAsState()

    fun load() {
        loading = true
        scope.launch {
            try {
                dash = app.api.dashboard().also { lastDashboard = it }
                err = null
                runCatching { app.directory.refresh() }
            } catch (e: Exception) {
                err = e.message
                if (!app.prefs.signedIn) onSignedOut()
            } finally {
                loading = false
            }
        }
    }
    OnResume { ready = callSetupDone(ctx); load() }

    Column(Modifier.fillMaxSize().background(C.chalk)) {
        TopBar("Closer Desk") {
            IconButton(onClick = { load() }, enabled = !loading) { Icon(Icons.Default.Refresh, "Refresh") }
            Box {
                IconButton(onClick = { menu = true }) { Icon(Icons.Default.MoreVert, "More") }
                DropdownMenu(menu, { menu = false }) {
                    DropdownMenuItem(text = { Text("Call matching setup") }, onClick = { menu = false; open(Screen.Setup) })
                    DropdownMenuItem(text = { Text("Settings (web)") }, onClick = { menu = false; open(Screen.Web("/settings", null, "Settings")) })
                    DropdownMenuItem(text = { Text("Sign out ${app.prefs.username ?: ""}") }, onClick = {
                        menu = false
                        scope.launch { app.api.logout(); app.directory.clear(); lastDashboard = null; onSignedOut() }
                    })
                }
            }
        }
        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            item {
                OutlinedTextField(
                    q, { q = it },
                    leadingIcon = { Icon(Icons.Default.Search, null) },
                    placeholder = { Text("Search every lead: name, business or number") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(14.dp)
                )
            }
            if (q.isNotBlank()) {
                val hits = searchLeads(dir?.leads.orEmpty(), q).take(40)
                if (hits.isEmpty()) item { Text("No leads match \"$q\"", color = C.ink3, modifier = Modifier.padding(8.dp)) }
                items(hits, key = { "s${it.id}" }) { l -> LeadRow(l, showOffer = true, onOpen = { open(Screen.Web("/leads/${l.id}", l.offerId, l.name)) }, onDial = { dial(l) }) }
            } else {
                if (!ready) item {
                    Panel(Modifier.clickable { open(Screen.Setup) }) {
                        Text("Set up call matching", fontWeight = FontWeight.Bold)
                        Text("Let Closer Desk show who's calling and who you're calling, with their lead card over the call.", color = C.ink2, fontSize = 14.sp)
                    }
                }
                item { ErrorNote(err) }
                val d = dash
                if (d == null && loading) item { LinearProgressIndicator(Modifier.fillMaxWidth()) }
                if (d != null) {
                    item { Overview(d) }
                    items(d.offers, key = { it.id }) { o -> OfferCardView(o) { open(Screen.Offer(o.id)) } }
                }
            }
        }
    }
}

@Composable
private fun Overview(d: Dashboard) {
    val t = d.offers
    Panel {
        Text("TODAY, EVERY OFFER", fontSize = 11.sp, fontWeight = FontWeight.Bold, color = C.ink3)
        Spacer(Modifier.height(6.dp))
        Row(Modifier.fillMaxWidth()) {
            Stat("Contacted", t.sumOf { it.today.contacted + it.today.dms }.toString(), modifier = Modifier.weight(1f))
            Stat("Dials", t.sumOf { it.today.dials }.toString(), modifier = Modifier.weight(1f))
            Stat("Booked", t.sumOf { it.today.booked }.toString(), C.blue, Modifier.weight(1f))
            Stat("Cash", money(t.sumOf { it.today.cash }), C.green, Modifier.weight(1f))
        }
    }
}

@Composable
private fun OfferCardView(o: OfferCard, onClick: () -> Unit) {
    Panel(Modifier.clickable(onClick = onClick)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(o.name, fontSize = 18.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(listOf(o.industry, modeLabel(o)).filter { it.isNotBlank() }.joinToString(" · "), color = C.ink3, fontSize = 13.sp)
            }
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = C.ink3)
        }
        Spacer(Modifier.height(10.dp))
        Row(Modifier.fillMaxWidth()) {
            when (o.mode) {
                "sdr" -> {
                    Stat("Dials today", o.today.dials.toString(), modifier = Modifier.weight(1f))
                    Stat("To dial", o.leads.toDial.toString(), modifier = Modifier.weight(1f))
                    Stat("Callbacks due", o.leads.due.toString(), if (o.leads.due > 0) C.yellow else C.ink, Modifier.weight(1f))
                }
                "dm" -> {
                    Stat("DMs today", o.today.dms.toString(), modifier = Modifier.weight(1f))
                    Stat("Booked this month", o.month.booked.toString(), C.blue, Modifier.weight(1f))
                    Stat("Converted", o.month.converted.toString(), C.green, Modifier.weight(1f))
                }
                else -> {
                    Stat("Leads", o.leads.total.toString(), modifier = Modifier.weight(1f))
                    Stat("Calls today", o.today.calls.toString(), modifier = Modifier.weight(1f))
                }
            }
        }
        if ("closing" in o.roles) {
            Spacer(Modifier.height(10.dp))
            Row(Modifier.fillMaxWidth()) {
                Stat("Calls today", o.today.calls.toString(), modifier = Modifier.weight(1f))
                Stat("Closed this month", o.month.closed.toString(), C.green, Modifier.weight(1f))
                Stat("Cash this month", money(o.month.cash), C.green, Modifier.weight(1f))
            }
        }
        o.nextCalls.firstOrNull()?.let {
            Text("Next call: ${it.prospect ?: it.title ?: "booked call"}, ${CallOverlay.whenText(it.start)}", color = C.ink2, fontSize = 13.sp, modifier = Modifier.padding(top = 10.dp))
        }
    }
}

private fun modeLabel(o: OfferCard) = listOfNotNull(
    if ("sdr" in o.roles) "Dialling" else null,
    if ("dm" in o.roles) "DM setting" else null,
    if ("closing" in o.roles) "Closing" else null
).joinToString(", ")

fun searchLeads(all: List<DirLead>, q: String): List<DirLead> {
    val needle = q.trim().lowercase()
    val digits = needle.filter { it.isDigit() }
    return all.filter { l ->
        (digits.length >= 3 && l.phone.filter { it.isDigit() }.contains(digits)) ||
            listOf(l.business, l.contact, l.suburb, l.email).any { it.lowercase().contains(needle) }
    }
}

@Composable
fun LeadRow(l: DirLead, showOffer: Boolean, onOpen: () -> Unit, onDial: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(C.raised)
            .border(1.dp, C.line, RoundedCornerShape(14.dp))
            .clickable(onClick = onOpen)
            .padding(start = 14.dp, top = 10.dp, bottom = 10.dp, end = 4.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(Modifier.size(10.dp).clip(CircleShape).background(stageColor(l.stage)))
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(l.name, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                listOfNotNull(if (showOffer) l.offer else null, l.status + (if (l.reason.isNotBlank()) ", ${l.reason.lowercase()}" else ""), l.followUp?.let { "follow up $it" })
                    .joinToString(" · "),
                color = C.ink2, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis
            )
        }
        if (l.phone.isNotBlank() && "call" !in l.doNotContact) IconButton(onClick = onDial) { Icon(Icons.Default.Call, "Call ${l.name}", tint = C.green) }
    }
}

// ---------- one offer ----------

@Composable
fun OfferScreen(id: Int, open: (Screen) -> Unit, back: () -> Unit, dial: (DirLead) -> Unit) {
    val app = CloserApp.instance
    val o = lastDashboard?.offers?.firstOrNull { it.id == id }
    val dir by app.directory.data.collectAsState()
    var q by remember { mutableStateOf("") }
    var filter by remember { mutableStateOf("open") }
    val today = lastDashboard?.today ?: ""
    val leads = remember(dir, q, filter) {
        val all = dir?.leads.orEmpty().filter { it.offerId == id }
        val f = when (filter) {
            "due" -> all.filter { it.followUp != null && it.followUp <= today && it.stage in setOf("new", "no_answer", "callback", "contacted") }
            "booked" -> all.filter { it.stage == "booked" }
            "open" -> all.filter { it.stage !in setOf("not_interested", "wrong_no", "call_not_interested", "call_unqualified", "not_converted", "call_closed", "converted") }
            else -> all
        }
        (if (q.isBlank()) f else searchLeads(f, q)).sortedWith(
            compareBy<DirLead> { if (it.followUp != null && it.followUp <= today) 0 else 1 }.thenByDescending { it.lastContactAt ?: "" }.thenByDescending { it.score ?: -1.0 }
        )
    }
    Column(Modifier.fillMaxSize().background(C.chalk)) {
        TopBar(o?.name ?: "Offer", back)
        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            if (o != null) item {
                // the full web pages for this offer
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    val tabs = buildList {
                        add("Leads" to "/leads")
                        if ("sdr" in o.roles) add("Dialling" to "/sdr")
                        if ("dm" in o.roles) add("DM Setting" to "/dm")
                        if ("closing" in o.roles) add("Closing" to "/closing")
                        add("Today" to "/")
                    }
                    tabs.take(4).forEach { (label, path) ->
                        OutlinedButton(onClick = { open(Screen.Web(path, o.id, "$label · ${o.name}")) }, contentPadding = PaddingValues(horizontal = 10.dp), modifier = Modifier.weight(1f)) {
                            Text(label, fontSize = 13.sp, maxLines = 1)
                        }
                    }
                }
            }
            item {
                OutlinedTextField(q, { q = it }, leadingIcon = { Icon(Icons.Default.Search, null) }, placeholder = { Text("Search this offer's leads") },
                    singleLine = true, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(14.dp))
            }
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf("open" to "Open", "due" to "Due", "booked" to "Booked", "all" to "All").forEach { (k, label) ->
                        FilterChip(filter == k, { filter = k }, label = { Text(label) })
                    }
                }
            }
            if (leads.isEmpty()) item { Text("No leads here", color = C.ink3, modifier = Modifier.padding(8.dp)) }
            items(leads.take(300), key = { it.id }) { l ->
                LeadRow(l, showOffer = false, onOpen = { open(Screen.Web("/leads/${l.id}", l.offerId, l.name)) }, onDial = { dial(l) })
            }
        }
    }
}

// ---------- web screens ----------

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun WebScreen(path: String, offerId: Int?, title: String, back: () -> Unit) {
    val app = CloserApp.instance
    var web by remember { mutableStateOf<WebView?>(null) }
    var canGoBack by remember { mutableStateOf(false) }
    BackHandler { if (web?.canGoBack() == true) web?.goBack() else back() }
    Column(Modifier.fillMaxSize().background(C.chalk)) {
        TopBar(title, back) {
            IconButton(onClick = { web?.reload() }) { Icon(Icons.Default.Refresh, "Reload") }
        }
        AndroidView(
            factory = { ctx ->
                app.api.shareSessionWithWebViews(offerId)
                WebView(ctx).apply {
                    layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                    webViewClient = object : WebViewClient() {
                        override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
                            val u = req.url
                            // phone numbers, emails and other sites go to their own apps
                            if (u.scheme == "tel") {
                                CallTracker.armOutgoing(ctx, u.schemeSpecificPart)
                                ctx.startActivity(Intent(Intent.ACTION_DIAL, u))
                                return true
                            }
                            if (!u.toString().startsWith(app.prefs.server)) {
                                runCatching { ctx.startActivity(Intent(Intent.ACTION_VIEW, u)) }
                                return true
                            }
                            return false
                        }
                        override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
                            canGoBack = view.canGoBack()
                        }
                    }
                    loadUrl(app.prefs.server + path)
                    web = this
                }
            },
            modifier = Modifier.fillMaxSize().navigationBarsPadding()
        )
    }
}

// ---------- call matching setup ----------

fun callSetupDone(c: Context): Boolean {
    val role = c.getSystemService(RoleManager::class.java)
    val roleOk = role?.isRoleHeld(RoleManager.ROLE_CALL_SCREENING) == true
    val logOk = ContextCompat.checkSelfPermission(c, Manifest.permission.READ_CALL_LOG) == PackageManager.PERMISSION_GRANTED
    return Settings.canDrawOverlays(c) && (roleOk || logOk) &&
        ContextCompat.checkSelfPermission(c, Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED
}

@Composable
fun SetupScreen(back: () -> Unit) {
    val ctx = LocalContext.current
    val app = CloserApp.instance
    var tick by remember { mutableIntStateOf(0) }
    OnResume { tick++ }
    val perms = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { tick++ }
    val roleAsk = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { tick++ }
    fun has(p: String) = ContextCompat.checkSelfPermission(ctx, p) == PackageManager.PERMISSION_GRANTED
    val role = ctx.getSystemService(RoleManager::class.java)
    key(tick) {
        val roleOk = role?.isRoleHeld(RoleManager.ROLE_CALL_SCREENING) == true
        val phoneOk = has(Manifest.permission.READ_PHONE_STATE) && has(Manifest.permission.READ_CALL_LOG)
        val notesOk = Build.VERSION.SDK_INT < 33 || has(Manifest.permission.POST_NOTIFICATIONS)
        val overlayOk = Settings.canDrawOverlays(ctx)
        var overlayOn by remember { mutableStateOf(app.prefs.overlayOn) }
        Column(Modifier.fillMaxSize().background(C.chalk)) {
            TopBar("Call matching", back)
            LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                item {
                    Text(
                        "When a lead rings you, or you ring one, Closer Desk shows their card over the call: offer, status, reason, last contact and note. After the call it asks you to log the outcome.",
                        color = C.ink2
                    )
                }
                item {
                    Step("Show who's calling", "Makes Closer Desk your Caller ID app so it sees incoming numbers. It never blocks or silences calls.", roleOk) {
                        role?.createRequestRoleIntent(RoleManager.ROLE_CALL_SCREENING)?.let { roleAsk.launch(it) }
                    }
                }
                item {
                    Step("Calls you make, and when a call ends", "Phone and call log access, so it knows the number you dialled and when you hang up.", phoneOk) {
                        perms.launch(arrayOf(Manifest.permission.READ_PHONE_STATE, Manifest.permission.READ_CALL_LOG))
                    }
                }
                item {
                    Step("The card over the call", "\"Display over other apps\" lets the lead card float over the call screen.", overlayOk) {
                        ctx.startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${ctx.packageName}")))
                    }
                }
                item {
                    Step("Log the call afterwards", "A notification when the call ends, to log the outcome.", notesOk) {
                        if (Build.VERSION.SDK_INT >= 33) perms.launch(arrayOf(Manifest.permission.POST_NOTIFICATIONS))
                    }
                }
                item {
                    Panel {
                        Text("Greyed out or \"Restricted setting\"?", fontWeight = FontWeight.Bold)
                        Text(
                            "Android blocks call log and overlay access for apps installed outside the Play Store until you allow it: open App info, tap the ⋮ menu, choose \"Allow restricted settings\", then come back here.",
                            color = C.ink2, fontSize = 14.sp
                        )
                        TextButton(onClick = {
                            ctx.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${ctx.packageName}")))
                        }) { Text("Open App info") }
                    }
                }
                item {
                    Panel {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text("Show the lead card on calls", fontWeight = FontWeight.Bold)
                                Text("Turn off to only get the notification after the call.", color = C.ink2, fontSize = 14.sp)
                            }
                            Switch(overlayOn, { overlayOn = it; app.prefs.overlayOn = it })
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Step(title: String, text: String, done: Boolean, onClick: () -> Unit) = Panel {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(if (done) Icons.Default.CheckCircle else Icons.Default.Info, null, tint = if (done) C.green else C.ink3)
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(title, fontWeight = FontWeight.Bold)
            Text(text, color = C.ink2, fontSize = 14.sp)
        }
    }
    if (!done) Button(onClick = onClick, modifier = Modifier.padding(top = 8.dp)) { Text("Allow") }
}
