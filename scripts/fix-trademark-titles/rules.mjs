// Pure title transform. No database access. The review document and the update
// script both import this, so what you approve is exactly what would be written.
import { OVERRIDES } from "./overrides.mjs"

const DEV = "(?:iPhone|iPad|MacBook|Samsung(?:\\s+Galaxy)?|Galaxy|Xbox|PlayStation(?:\\s+\\d)?)"
const MODEL = `${DEV}(?:[\\s/]+(?:[0-9]{1,2}(?![.\d])|X[RS]?|SE|Air|Plus|Pro|Max|Ultra|Mini|[A-Z]\\d{1,3}))*`

// 1. Trademarks spelled the way their owner spells them.
const CASING = [
  [/\bi\s?phone\b/gi, "iPhone"], [/\bi\s?pad\b/gi, "iPad"], [/\bipod\b/gi, "iPod"],
  [/\bmac\s?book\b/gi, "MacBook"], [/\bimac\b/gi, "iMac"], [/\bairpods\b/gi, "AirPods"],
  [/\bmag\s?safe\b/gi, "MagSafe"], [/\bairtag\b/gi, "AirTag"],
  [/\bsamsung\b/gi, "Samsung"], [/\bgalaxy\b/gi, "Galaxy"],
  [/\bxbox\b/gi, "Xbox"], [/\bps5\b/gi, "PlayStation 5"], [/\bps4\b/gi, "PlayStation 4"],
  [/\bhuawei\b/gi, "Huawei"], [/\boneplus\b/gi, "OnePlus"], [/\bandroid\b/gi, "Android"],
]

// 2. Spelling mistakes found in the live titles.
const TYPOS = [
  [/\bSheild\b/gi, "Shield"], [/\bSlicon\b/gi, "Silicone"], [/\bScretch\b/gi, "Scratch"],
  [/\bMilitrary\b/gi, "Military"], [/\bMillitary\b/gi, "Military"],
  [/\bfrendly\b/gi, "Friendly"], [/\bAnti Scratch\b/g, "Anti-Scratch"],
  [/\bHd Clear\b/g, "HD Clear"], [/\bBubble free\b/gi, "Bubble-Free"],
]

// 3. Word orders that read as if we were selling the trademark owner's own
//    product. "MagSafe Case for iPhone" names Apple's own "MagSafe Case".
const compat = (d) => `Case, Compatible with ${d} and MagSafe Charging,`
const UNSAFE = [
  [new RegExp(`\\bCompatible with MagSafe Case for (${MODEL})`, "gi"), (_m, d) => compat(d)],
  [new RegExp(`\\bMagSafe Compatible Case for (${MODEL})`, "gi"), (_m, d) => compat(d)],
  [new RegExp(`\\bCase Compatible with MagSafe for (${MODEL})`, "gi"), (_m, d) => compat(d)],
  [new RegExp(`\\bCase for (${MODEL}),? Compatible with MagSafe`, "gi"), (_m, d) => compat(d)],
  [new RegExp(`\\bCase,? Compatible with MagSafe,? for (${MODEL})`, "gi"), (_m, d) => compat(d)],
  [new RegExp(`\\bMagSafe Compatible for (${MODEL})`, "gi"), (_m, d) => `Compatible with ${d} and MagSafe Charging,`],
  [/\bCase,? with Compatible with MagSafe\b/gi, "Case, Compatible with MagSafe Charging,"],
  [/\bMagSafe 2-in-1\b/gi, "2-in-1"],
  [/\bHolder MagSafe\b/gi, "Holder, Compatible with MagSafe Charging,"],
  [/\bcompatible with MagSafe\b/g, "Compatible with MagSafe Charging"],
]

const tidy = (t) =>
  t.replace(/\s{2,}/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/\s*\|\s*/g, " | ")
    .replace(/,\s*,/g, ",")
    .replace(/[\s,|-]+$/, "")
    .replace(/(Case,.*?)[,\s]+(?:[\w-]+\s+){0,2}Case$/i, "$1")
    .replace(/\s+(?:Compatible(?:\s+with)?|with|and|&|for|the|a|in|of|to|Supports)$/i, "")
    .replace(/[\s,|-]+$/, "")
    .trim()

// 7. Our own brand must be visible in the title, and visible first. Google
//    reads a title that opens with someone else's trademark as a claim to be
//    their product; a title that opens with ours cannot be read that way.
const withBrand = (title, brand) => {
  if (!brand) return title
  const b = brand.trim()
  if (!b) return title
  // Already leading: leave it alone. The brand record is not always spelled the
  // way the brand spells itself ("BENQ" in the table, "BenQ" on the product).
  if (new RegExp(`^${b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(title)) return title
  // Present but buried, or absent: put it at the front and keep it there.
  const stripped = title.replace(new RegExp(`\\b${b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b\\s*`, "gi"), "").trim()
  const withIt = `${b} ${stripped}`
  if (withIt.length <= 150) return withIt
  const parts = withIt.split(/,\s*/)
  while (parts.join(", ").length > 150 && parts.length > 2) parts.splice(parts.length - 2, 1)
  return parts.join(", ")
}

export const rewriteTitle = (original, sku, brand) => {
  if (sku !== undefined && Object.prototype.hasOwnProperty.call(OVERRIDES, sku)) {
    return withBrand(OVERRIDES[sku] ?? original, brand)
  }
  let t = original
  for (const [re, to] of TYPOS) t = t.replace(re, to)
  for (const [re, to] of CASING) t = t.replace(re, to)
  t = t.replace(/^crownyx\s+/i, "CROWNYX ").replace(/^CROWNYX\s+CROWNYX\s+/i, "CROWNYX ")
  for (const [re, to] of UNSAFE) t = t.replace(re, to)

  // 4. A title must never open with someone else's trademark.
  const lead = new RegExp(
    `^(CROWNYX)\\s+for\\s+(${MODEL})\\s+((?:[A-Z][\\w-]*\\s+){1,5}?(?:Protector|Case|Cover|Cable|Charger|Holder|Hub|Adapter))\\b`,
    "i"
  )
  t = t.replace(lead, "$1 $3, Compatible with $2,")

  // 4b. The device may not sit between the product name and the product type:
  //     "Crystal Spin iPhone 15 case" -> "Crystal Spin Case, Compatible with iPhone 15,"
  const TYPE = "(?:Case|Cover|Screen Protector|Lens Protector|Protector|Cable|Charger|Holder|Hub|Adapter)"
  const midway = new RegExp(`^(CROWNYX(?:\\s+[\\w'\u00b0-]+){0,4}?)\\s+(${MODEL})\\s+(${TYPE})\\b`, "i")
  t = t.replace(midway, (_m, head, dev, type) => {
    const t2 = type.replace(/\b\w/g, (c) => c.toUpperCase())
    return `${head} ${t2}, Compatible with ${dev},`
  })

  // 5. The first device mention is introduced by "Compatible with" — never by a
  //    bare "for", and never left standing on its own.
  if (!/Compatible with/i.test(t)) {
    t = t.replace(/\|\s*For\s+(TV|Laptop)/i, "| Compatible with $1")
    const bareFor = new RegExp(`\\bfor\\s+(${DEV})\\b`, "i")
    const naked = new RegExp(`\\b(Protector|Case|Cover|Cable|Charger|Holder|Hub|Adapter)\\s+(${DEV})\\b`, "i")
    if (bareFor.test(t)) t = t.replace(bareFor, "Compatible with $1")
    else t = t.replace(naked, "$1, Compatible with $2")
  }

  // 5b. Last guard: "MagSafe Case", "MagSafe Charger" and the like are names of
  //     products Apple sells. On our own accessory the words may only appear as
  //     a compatibility statement, never as the thing being sold.
  t = t.replace(
    /(?:\bCompatible\s+with\s+)?\bMagSafe\s+(Case|Charger|Battery Pack|Wallet|Duo)\b(?:\s+(?:use\s+)?(?:for|compatible\s+with|with))?/gi,
    (_m, noun) => `${noun}, Compatible with MagSafe Charging,`
  )
  t = t.replace(/,\s*Compatible with MagSafe Charging,(\s*Compatible with MagSafe Charging,)+/gi, ", Compatible with MagSafe Charging,")

  t = tidy(t)

  // 6. Google allows 150 characters. Drop plain feature clauses from the end
  //    inward; never drop a clause that carries the compatibility statement.
  if (t.length > 150) {
    const parts = t.split(/,\s*/)
    const keeps = (c) => new RegExp(DEV, "i").test(c) || /MagSafe|Compatible/i.test(c)
    const droppable = () => {
      for (let i = parts.length - 2; i >= 1; i--) if (!keeps(parts[i])) return i
      return -1
    }
    let i
    while (parts.join(", ").length > 150 && (i = droppable()) !== -1) parts.splice(i, 1)
    // Still long: shave words off the longest descriptive clause — never off
    // the opening product name, and never off a compatibility statement.
    const longest = () => {
      let best = -1, n = 3
      for (let j = 1; j < parts.length; j++) {
        const w = parts[j].split(" ").length
        if (!keeps(parts[j]) && w > n) { n = w; best = j }
      }
      if (best !== -1) return best
      for (let j = 1; j < parts.length; j++) {
        const w = parts[j].split(" ").length
        if (w > n) { n = w; best = j }
      }
      return best
    }
    let j
    while (parts.join(", ").length > 150 && (j = longest()) !== -1) {
      parts[j] = parts[j].split(" ").slice(0, -1).join(" ")
    }
    t = tidy(parts.join(", "))
    if (t.length > 150) t = tidy(t.slice(0, t.slice(0, 150).lastIndexOf(" ")))
  }
  return withBrand(t, brand)
}
