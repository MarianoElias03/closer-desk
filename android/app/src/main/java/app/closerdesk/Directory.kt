package app.closerdesk

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import java.io.File

/**
 * Every lead across every offer, kept on the phone so a ringing number is matched instantly, even
 * before the network wakes up. Refreshed when the app opens, after you log something, and after each
 * call; the last good copy stays on disk.
 */
class Directory(private val context: Context, private val api: Api) {
    private val file = File(context.filesDir, "directory.json")
    private val _data = MutableStateFlow<DirectoryData?>(null)
    val data: StateFlow<DirectoryData?> = _data

    init {
        runCatching { if (file.exists()) _data.value = api.json.decodeFromString(DirectoryData.serializer(), file.readText()) }
    }

    suspend fun refresh(): DirectoryData {
        val text = api.directory()
        val d = api.json.decodeFromString(DirectoryData.serializer(), text)
        file.writeText(text)
        _data.value = d
        return d
    }

    fun clear() {
        file.delete()
        _data.value = null
    }

    /** The lead (or booked call) for a phone number, matched on its last 9 digits like the server does. */
    fun match(number: String?): Match? {
        val key = phoneKey(number) ?: return null
        val d = _data.value ?: return null
        // a lead you're working beats an old one: prefer open stages, then the most recently contacted
        d.leads.filter { it.phoneKey == key }
            .sortedWith(compareBy<DirLead> { if (it.stage in CLOSED) 1 else 0 }.thenByDescending { it.lastContactAt ?: "" })
            .firstOrNull()?.let { return Match.Lead(it) }
        return d.calls.filter { it.phoneKey == key }.maxByOrNull { it.start }?.let { Match.Call(it) }
    }

    fun lead(id: Int) = _data.value?.leads?.firstOrNull { it.id == id }
    fun reasons(offerId: Int, outcome: String) = _data.value?.reasons?.get(offerId.toString())?.get(outcome).orEmpty()

    companion object {
        private val CLOSED = setOf("not_interested", "wrong_no", "call_not_interested", "call_unqualified", "not_converted")

        /** Same rule as the server: digits only, +61 becomes 0, last 9 digits, needs at least 8. */
        fun phoneKey(p: String?): String? {
            var d = (p ?: "").filter { it.isDigit() }
            if (d.startsWith("61")) d = "0" + d.substring(2)
            return if (d.length >= 8) d.takeLast(9) else null
        }
    }
}
