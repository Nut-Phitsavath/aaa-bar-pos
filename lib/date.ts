/**
 * Date formatting that survives the browser.
 *
 * Chrome ships no Lao locale data at all:
 *
 *   Intl.DateTimeFormat.supportedLocalesOf(['lo','lo-LA'])  ->  []
 *   new Intl.DateTimeFormat('lo-LA').resolvedOptions().locale -> "en-US"
 *
 * so toLocaleDateString('lo-LA', ...) silently renders English in the browser.
 * Node's full ICU *does* support it, which makes this worse than a translation
 * gap: the server renders "22 ສິງຫາ 2026", the client renders "August 22, 2026",
 * and React throws away the server HTML and rebuilds the page on the client
 * (hydration error #418 on /orders).
 *
 * Formatting Lao ourselves is the only way to get the same correct output on
 * both sides. The names below were cross-checked against Node's ICU data --
 * all 12 months and 7 weekdays match exactly.
 */

const LAO_MONTHS = [
    "ມັງກອນ", "ກຸມພາ", "ມີນາ", "ເມສາ", "ພຶດສະພາ", "ມິຖຸນາ",
    "ກໍລະກົດ", "ສິງຫາ", "ກັນຍາ", "ຕຸລາ", "ພະຈິກ", "ທັນວາ",
]

const LAO_WEEKDAYS = [
    "ວັນອາທິດ", "ວັນຈັນ", "ວັນອັງຄານ", "ວັນພຸດ", "ວັນພະຫັດ", "ວັນສຸກ", "ວັນເສົາ",
]

/**
 * "22 ສິງຫາ 2026" / "August 22, 2026", optionally with the weekday.
 *
 * Never pass a locale to the browser for Lao -- always branch here, or the till
 * quietly shows English.
 */
export function formatLongDate(date: Date, lang: string, opts?: { weekday?: boolean }): string {
    if (lang === "lo") {
        const base = `${date.getDate()} ${LAO_MONTHS[date.getMonth()]} ${date.getFullYear()}`
        return opts?.weekday ? `${LAO_WEEKDAYS[date.getDay()]}, ${base}` : base
    }
    // en-US is one of the few locales both Node and every browser agree on.
    return date.toLocaleDateString("en-US", {
        ...(opts?.weekday ? { weekday: "long" as const } : {}),
        day: "numeric",
        month: "long",
        year: "numeric",
    })
}
