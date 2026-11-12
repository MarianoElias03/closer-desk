// Same arithmetic as the CB Fitness sheet.
// SDR: Total leads = no answer + booked + not interested + callback + wrong no.
//      Spoken with = booked + not interested + callback + wrong no.
// Closing: Calls = no show + closed + not interested + callbacks + unqualified.

export const SDR_OUTCOMES = [
  { key: 'no_answer', label: 'No answer', short: 'No ans.', tone: 'iron' },
  { key: 'booked', label: 'Booked', short: 'Booked', tone: 'blue' },
  { key: 'not_interested', label: 'Not interested', short: 'Not int.', tone: 'red' },
  { key: 'callback', label: 'Callback', short: 'Callback', tone: 'yellow' },
  { key: 'wrong_no', label: 'Wrong number', short: 'Wrong no.', tone: 'slate' }
];

// DM setting: leads who messaged in, how many booked a call, and how those ended up.
export const DM_OUTCOMES = [
  { key: 'contacted', label: 'Contacted us', short: 'Contacted', tone: 'iron' },
  { key: 'booked', label: 'Booked', short: 'Booked', tone: 'blue' },
  { key: 'converted', label: 'Converted', short: 'Converted', tone: 'green' },
  { key: 'not_converted', label: 'Not converted', short: 'Not conv.', tone: 'red' }
];

export const CLOSE_OUTCOMES = [
  { key: 'no_show', label: 'No show', short: 'No show', tone: 'iron' },
  { key: 'closed', label: 'Closed', short: 'Closed', tone: 'green' },
  { key: 'not_interested', label: 'Not interested', short: 'Not int.', tone: 'red' },
  { key: 'callbacks', label: 'Callback', short: 'Callback', tone: 'yellow' },
  { key: 'unqualified', label: 'Unqualified', short: 'Unqual.', tone: 'slate' }
];

// Call outcome -> closing tally column
export const CALL_OUTCOMES = [
  { key: 'pending', label: 'Not logged', tone: 'none', column: null },
  { key: 'no_show', label: 'No show', tone: 'iron', column: 'no_show' },
  { key: 'closed', label: 'Closed', tone: 'green', column: 'closed' },
  { key: 'not_interested', label: 'Not interested', tone: 'red', column: 'not_interested' },
  { key: 'callback', label: 'Callback', tone: 'yellow', column: 'callbacks' },
  { key: 'unqualified', label: 'Unqualified', tone: 'slate', column: 'unqualified' }
];

export const sdrTotal = (d) => (d ? d.no_answer + d.booked + d.not_interested + d.callback + d.wrong_no : 0);
export const sdrSpoken = (d) => (d ? d.booked + d.not_interested + d.callback + d.wrong_no : 0);
export const closeCalls = (d) => (d ? d.no_show + d.closed + d.not_interested + d.callbacks + d.unqualified : 0);

const ratio = (a, b) => (b > 0 ? a / b : null);

export function sdrSummary(days, daysWorkedOverride) {
  const sum = { no_answer: 0, booked: 0, not_interested: 0, callback: 0, wrong_no: 0 };
  for (const d of days) for (const k in sum) sum[k] += d[k];
  const total = sdrTotal(sum);
  const spoken = sdrSpoken(sum);
  const activeDays = days.filter((d) => sdrTotal(d) > 0).length;
  const daysWorked = daysWorkedOverride ?? activeDays;
  return {
    ...sum,
    total,
    spoken,
    pickupRate: ratio(spoken, total),
    bookingRate: ratio(sum.booked, total),
    bookedPerSpoken: ratio(sum.booked, spoken),
    daysWorked,
    activeDays,
    bookingsPerDay: ratio(sum.booked, daysWorked),
    dialsPerDay: ratio(total, daysWorked)
  };
}

export function closeSummary(days, daysWorkedOverride) {
  const sum = { no_show: 0, closed: 0, not_interested: 0, callbacks: 0, unqualified: 0, cash: 0 };
  for (const d of days) for (const k in sum) sum[k] += d[k];
  const calls = closeCalls(sum);
  const showed = calls - sum.no_show;
  const activeDays = days.filter((d) => closeCalls(d) > 0 || d.cash > 0).length;
  const daysWorked = daysWorkedOverride ?? activeDays;
  return {
    ...sum,
    calls,
    showed,
    conversion: ratio(sum.closed, calls),
    closeRateOnShows: ratio(sum.closed, showed),
    noShowRate: ratio(sum.no_show, calls),
    showRate: ratio(showed, calls),
    daysWorked,
    activeDays,
    cashPerDay: ratio(sum.cash, daysWorked),
    salesPerDay: ratio(sum.closed, daysWorked),
    cashPerCall: ratio(sum.cash, calls)
  };
}

export function dmSummary(days, daysWorkedOverride) {
  const sum = { contacted: 0, booked: 0, converted: 0, not_converted: 0 };
  for (const d of days) for (const k in sum) sum[k] += d[k];
  const decided = sum.converted + sum.not_converted;
  const activeDays = days.filter((d) => d.contacted + d.booked + d.converted + d.not_converted > 0).length;
  const daysWorked = daysWorkedOverride ?? activeDays;
  return {
    ...sum,
    decided,
    bookingRate: ratio(sum.booked, sum.contacted),
    conversionRate: ratio(sum.converted, decided),
    convertedPerContact: ratio(sum.converted, sum.contacted),
    daysWorked,
    activeDays,
    contactsPerDay: ratio(sum.contacted, daysWorked),
    bookingsPerDay: ratio(sum.booked, daysWorked)
  };
}
