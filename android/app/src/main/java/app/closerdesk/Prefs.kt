package app.closerdesk

import android.content.Context

/** Where Closer Desk is and who you're signed in as. The token is the session from /api/auth/login. */
class Prefs(context: Context) {
    private val sp = context.getSharedPreferences("closer", Context.MODE_PRIVATE)

    var server: String
        get() = sp.getString("server", null)?.takeIf { it.isNotBlank() } ?: BuildConfig.DEFAULT_SERVER
        set(v) = sp.edit().putString("server", v.trim().trimEnd('/')).apply()
    var token: String?
        get() = sp.getString("token", null)
        set(v) = sp.edit().putString("token", v).apply()
    var username: String?
        get() = sp.getString("username", null)
        set(v) = sp.edit().putString("username", v).apply()
    /** Show the floating card for calls with leads (you can turn it off in Setup). */
    var overlayOn: Boolean
        get() = sp.getBoolean("overlay", true)
        set(v) = sp.edit().putBoolean("overlay", v).apply()

    val signedIn get() = !token.isNullOrBlank()
    fun signOut() = sp.edit().remove("token").remove("username").apply()
}
