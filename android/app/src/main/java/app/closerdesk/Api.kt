package app.closerdesk

import android.webkit.CookieManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

class ApiError(message: String, val status: Int = 0) : Exception(message)

/** Talks to Closer Desk with the session token (Bearer), the same session the web screens use as a cookie. */
class Api(private val prefs: Prefs) {
    val json = Json { ignoreUnknownKeys = true; coerceInputValues = true; explicitNulls = false }
    private val http = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()
    private val JSON = "application/json".toMediaType()

    private fun url(path: String): String {
        val base = prefs.server.trim().trimEnd('/')
        if (base.isBlank()) throw ApiError("Add your Closer Desk address first")
        return base + path
    }

    suspend fun get(path: String): String = call(Request.Builder().url(url(path)).get(), null)
    suspend fun post(path: String, body: String, offerId: Int? = null): String =
        call(Request.Builder().url(url(path)).post(body.toRequestBody(JSON)), offerId)

    private suspend fun call(b: Request.Builder, offerId: Int?): String = withContext(Dispatchers.IO) {
        prefs.token?.let { b.header("Authorization", "Bearer $it") }
        offerId?.let { b.header("X-Offer", it.toString()) }
        try {
            http.newCall(b.build()).execute().use { r ->
                val text = r.body?.string().orEmpty()
                if (!r.isSuccessful) {
                    val msg = runCatching { json.parseToJsonElement(text).jsonObject["message"]?.jsonPrimitive?.content }.getOrNull()
                    if (r.code == 401 && prefs.signedIn && msg == "Sign in first") prefs.signOut()
                    throw ApiError(msg ?: "Closer Desk said ${r.code}", r.code)
                }
                text
            }
        } catch (e: IOException) {
            throw ApiError("Can't reach Closer Desk. Is Tailscale on?")
        }
    }

    suspend fun login(server: String, username: String, password: String, device: String) {
        prefs.server = server
        val body = buildJsonObject {
            put("username", username)
            put("password", password)
            put("device", device)
        }.toString()
        val res = json.parseToJsonElement(post("/api/auth/login", body)).jsonObject
        prefs.token = res["token"]!!.jsonPrimitive.content
        prefs.username = res["username"]?.jsonPrimitive?.content ?: username
        shareSessionWithWebViews()
    }

    suspend fun logout() {
        runCatching { post("/api/auth/logout", "{}") }
        prefs.signOut()
        CookieManager.getInstance().removeAllCookies(null)
    }

    suspend fun dashboard(): Dashboard = json.decodeFromString(Dashboard.serializer(), get("/api/app/dashboard"))
    suspend fun directory(): String = get("/api/app/directory")

    /** Log an outcome on a lead, same rules as the pad on the lead page (a reason is required). */
    suspend fun logOutcome(lead: DirLead, body: JsonObject): String = post("/api/leads/${lead.id}/dials", body.toString(), lead.offerId)

    /** Web screens sign in with the same session, as a cookie, and open on the right offer. */
    fun shareSessionWithWebViews(offerId: Int? = null) {
        val base = prefs.server
        val token = prefs.token ?: return
        val cm = CookieManager.getInstance()
        val secure = if (base.startsWith("https")) "; Secure" else ""
        cm.setCookie(base, "cd_session=$token; Path=/; Max-Age=31536000; HttpOnly$secure; SameSite=Lax")
        offerId?.let { cm.setCookie(base, "offer=$it; Path=/; Max-Age=31536000; SameSite=Lax") }
        cm.flush()
    }
}

