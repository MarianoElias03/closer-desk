package app.closerdesk

import kotlinx.serialization.Serializable

@Serializable
data class Dashboard(val today: String, val month: String, val offers: List<OfferCard>)

@Serializable
data class OfferCard(
    val id: Int,
    val name: String,
    val industry: String = "",
    val roles: List<String> = emptyList(),
    val mode: String,
    val today: DayNumbers,
    val month: MonthNumbers,
    val leads: LeadCounts,
    val nextCalls: List<NextCall> = emptyList()
)

@Serializable
data class DayNumbers(val dials: Int = 0, val booked: Int = 0, val dms: Int = 0, val calls: Int = 0, val closed: Int = 0, val cash: Double = 0.0, val contacted: Int = 0)

@Serializable
data class MonthNumbers(
    val dials: Int = 0,
    val pickupRate: Double? = null,
    val booked: Int = 0,
    val bookingRate: Double? = null,
    val dms: Int = 0,
    val converted: Int = 0,
    val calls: Int = 0,
    val closed: Int = 0,
    val cash: Double = 0.0,
    val conversion: Double? = null
)

@Serializable
data class LeadCounts(val total: Int = 0, val toDial: Int = 0, val due: Int = 0)

@Serializable
data class NextCall(val id: String, val title: String? = null, val prospect: String? = null, val start: String, val outcome: String? = null)

@Serializable
data class DirectoryData(
    val at: String,
    val tz: String = "Australia/Brisbane",
    val leads: List<DirLead> = emptyList(),
    val calls: List<DirCall> = emptyList(),
    /** offer id -> outcome -> suggested reasons */
    val reasons: Map<String, Map<String, List<String>>> = emptyMap()
)

@Serializable
data class DirLead(
    val id: Int,
    val offerId: Int,
    val offer: String,
    val mode: String,
    val business: String = "",
    val contact: String = "",
    val phone: String = "",
    val phoneKey: String? = null,
    val email: String = "",
    val suburb: String = "",
    val score: Double? = null,
    val stage: String = "new",
    val status: String = "",
    val reason: String = "",
    val followUp: String? = null,
    val doNotContact: List<String> = emptyList(),
    val lastContactAt: String? = null,
    val lastNote: String = "",
    val attempts: Int = 0,
    val call: LeadCall? = null
) {
    val name get() = business.ifBlank { contact.ifBlank { phone.ifBlank { "Lead" } } }
}

@Serializable
data class LeadCall(val start: String, val outcome: String? = null, val title: String? = null)

@Serializable
data class DirCall(
    val id: String,
    val offerId: Int,
    val offer: String,
    val prospect: String? = null,
    val title: String? = null,
    val phone: String = "",
    val phoneKey: String? = null,
    val start: String,
    val outcome: String? = null
)

/** Who a phone number belongs to: a lead, or the prospect on a booked call that has no lead. */
sealed class Match {
    data class Lead(val lead: DirLead) : Match()
    data class Call(val call: DirCall) : Match()
}

/** The outcome pads, same as the web app. */
data class Outcome(val key: String, val label: String, val color: Long)

object Outcomes {
    val SDR = listOf(
        Outcome("no_answer", "No answer", 0xFF7A8494),
        Outcome("booked", "Booked", 0xFF2563C9),
        Outcome("not_interested", "Not interested", 0xFFD7263D),
        Outcome("callback", "Callback", 0xFFF2B705),
        Outcome("wrong_no", "Wrong number", 0xFF5B6B80)
    )
    val DM = listOf(
        Outcome("contacted", "Contacted", 0xFF7A8494),
        Outcome("booked", "Booked", 0xFF2563C9),
        Outcome("converted", "Converted", 0xFF1E9E5A),
        Outcome("not_converted", "Not converted", 0xFFD7263D)
    )
    fun forMode(mode: String) = if (mode == "dm") DM else if (mode == "sdr") SDR else emptyList()
}
