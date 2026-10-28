// Google's "Guns and Parts" check matches the words "bullet" and "sniper"
// wherever they appear. Both are ordinary industry terms here -- a bullet
// camera is a cylindrical CCTV housing, a sniper button is a gaming-mouse DPI
// toggle -- but the automated check does not know that, and the products are
// disapproved. This rewrites them to wording that means the same thing.
//
//   node apply.mjs            dry run -- prints every change, writes nothing
//   node apply.mjs --write    applies, after writing a backup
//   node apply.mjs --revert <backup.json>
import mongoose from "mongoose"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../..")

const loadEnv = () => {
  const file = path.join(ROOT, ".env")
  if (!fs.existsSync(file)) throw new Error(`no .env at ${file}`)
  return Object.fromEntries(
    fs.readFileSync(file, "utf8").split("\n")
      .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
  )
}

// Fields that reach the Google feed. Anything else is not worth touching.
const FIELDS = [
  "name", "nameAr", "shortDescription", "shortDescriptionAr", "description", "descriptionAr",
  "metaTitle", "metaDescription", "keywords",
  "ogTitle", "ogDescription", "seoTitle", "seoDescription", "seoKeywords", "customSchema",
]

// Arabic terms the same check reacts to. None of these are about weapons here:
// خرطوشة is a printer ink cartridge (it is also the word for a shotgun shell),
// سلاحك السري is marketing copy meaning "your secret weapon", and the VIGI
// camera text is a literal machine translation of "bullet camera".
const ARABIC = [
  // the VIGI C330I description, worst first -- a doubled, literal translation
  ["\u0627\u0644\u0643\u0627\u0645\u064a\u0631\u0627 \u0627\u0644\u062e\u0627\u0631\u062c\u064a\u0629 \u0627\u0644\u0631\u0635\u0627\u0635\u0629 \u0627\u0644\u062e\u0627\u0631\u062c\u064a\u0629", "\u0627\u0644\u0643\u0627\u0645\u064a\u0631\u0627 \u0627\u0644\u062e\u0627\u0631\u062c\u064a\u0629 \u0627\u0644\u0623\u0633\u0637\u0648\u0627\u0646\u064a\u0629"],
  ["\u0642\u0627\u0628\u0644\u0629 \u0644\u0644\u0631\u0635\u0627\u0635", "\u0623\u0633\u0637\u0648\u0627\u0646\u064a\u0629"],
  ["\u0627\u0644\u0631\u0635\u0627\u0635\u0629 \u0627\u0644\u062e\u0627\u0631\u062c\u064a\u0629", "\u0627\u0644\u0623\u0633\u0637\u0648\u0627\u0646\u064a\u0629 \u0627\u0644\u062e\u0627\u0631\u062c\u064a\u0629"],
  ["\u0627\u0644\u0631\u0635\u0627\u0635\u0629", "\u0627\u0644\u0623\u0633\u0637\u0648\u0627\u0646\u064a\u0629"],
  ["\u0644\u0644\u0631\u0635\u0627\u0635", "\u0627\u0644\u0623\u0633\u0637\u0648\u0627\u0646\u064a\u0629"],
  // "a man carrying a gun" in an image alt text on a gaming monitor
  ["carrying a gun.", "holding a controller."],
  // the second Arabic plural of cartridge. The double plural goes first, then
  // the stem -- prefixes (\u0627\u0644 \u0628 \u0648 \u0644) stay attached and still read correctly.
  ["\u062e\u0631\u0627\u0637\u064a\u0634\u0627\u062a", "\u0639\u0628\u0648\u0627\u062a"],
  ["\u062e\u0631\u0627\u0637\u064a\u0634", "\u0639\u0628\u0648\u0627\u062a"],
  // \u0631\u0635\u0627\u0635\u064a means grey (lead-coloured); \u0631\u0645\u0627\u062f\u064a says grey without the word for lead.
  ["\u0631\u0635\u0627\u0635\u064a", "\u0631\u0645\u0627\u062f\u064a"],
  // ink cartridge -> ink pack. Definite and plural forms first.
  ["\u0627\u0644\u062e\u0631\u0637\u0648\u0634\u0627\u062a", "\u0627\u0644\u0639\u0628\u0648\u0627\u062a"],
  ["\u0627\u0644\u062e\u0631\u0637\u0648\u0634\u0629", "\u0627\u0644\u0639\u0628\u0648\u0629"],
  ["\u062e\u0631\u0637\u0648\u0634\u0627\u062a", "\u0639\u0628\u0648\u0627\u062a"],
  ["\u062e\u0631\u0637\u0648\u0634\u0629", "\u0639\u0628\u0648\u0629"],
  // "your secret weapon" -> "your secret tool"
  ["\u0633\u0644\u0627\u062d\u0643 \u0627\u0644\u0633\u0631\u064a", "\u0623\u062f\u0627\u062a\u0643 \u0627\u0644\u0633\u0631\u064a\u0629"],
  ["\u0633\u0644\u0627\u062d\u0643", "\u0623\u062f\u0627\u062a\u0643"],
]

const TRIGGER = /\b(bullet|sniper)\b|\bgun\.|\u062e\u0631\u0637\u0648\u0634|\u062e\u0631\u0627\u0637\u064a\u0634|\u0633\u0644\u0627\u062d|\u0631\u0635\u0627\u0635/i

// Keep the replacement in the same case as the word it replaces, so ALL-CAPS
// titles and sentence-case body text both come out right.
const like = (sample, word) => {
  if (sample === sample.toUpperCase()) return word.toUpperCase()
  if (sample[0] === sample[0].toUpperCase()) return word[0].toUpperCase() + word.slice(1)
  return word
}

export const clean = (text) => {
  if (!text) return text
  // Slugs and absolute links contain "bullet" too, and renaming those would
  // break every URL that already points at the page. Hide links from the
  // replacements and put them back afterwards.
  const links = []
  let t = String(text).replace(/https?:\/\/\S+/g, (m) => {
    links.push(m)
    return `\u0000LINK${links.length - 1}\u0000`
  })
  // "Outdoor Bullet" with nothing after it is a truncated title: name the product.
  t = t.replace(/\bOutdoor Bullet\b(?!\s*(?:Camera|Network))/gi, (m) => m.replace(/Bullet/i, (b) => like(b, "Tube") + " Camera"))
  // "bullet points" is a writing term, not a camera shape.
  t = t.replace(/\bbullet(\s+)points?\b/gi, (_m, sp) => `key${sp}point${_m.trim().endsWith("s") ? "s" : ""}`)
  t = t.replace(/\bbullet\b/gi, (m) => like(m, "tube"))
  t = t.replace(/\bsniper\b/gi, (m) => like(m, "precision"))
  // "precision button" reads oddly; "precision DPI button" is what it is.
  t = t.replace(/\b(precision|Precision|PRECISION)\s+(button|Button|BUTTON)\b/g, (_m, p, b) => `${p} DPI ${b}`)
  for (const [from, to] of ARABIC) t = t.split(from).join(to)
  return t.replace(/\u0000LINK(\d+)\u0000/g, (_m, i) => links[Number(i)])
}

const connect = async (env) => {
  await mongoose.connect(env.MONGO_URI, { dbName: env.MONGO_DB_NAME || undefined })
  return mongoose.connection.db
}

const collect = async (db) => {
  const products = await db.collection("products")
    .find({}, { projection: Object.fromEntries([["sku", 1], ...FIELDS.map((f) => [f, 1])]) })
    .toArray()
  const rows = []
  for (const p of products) {
    const changes = {}
    for (const f of FIELDS) {
      const before = p[f]
      if (!before || !TRIGGER.test(String(before))) continue
      const after = clean(before)
      if (after !== String(before)) changes[f] = { before: String(before), after }
    }
    if (Object.keys(changes).length) rows.push({ id: String(p._id), sku: p.sku || "", changes })
  }
  return rows
}

const show = (rows) => {
  for (const r of rows) {
    console.log(`\n[${r.sku}]`)
    for (const [f, c] of Object.entries(r.changes)) {
      const n = (c.before.match(/\b(bullet|sniper)\b/gi) || []).length
      if (f === "name" || f === "nameAr" || f === "metaTitle") {
        console.log(`  ${f}`)
        console.log(`    before: ${c.before}`)
        console.log(`    after : ${c.after}`)
      } else {
        console.log(`  ${f}: ${n} occurrence(s) reworded`)
      }
    }
  }
}

const run = async () => {
  const write = process.argv.includes("--write")
  const revertAt = process.argv.indexOf("--revert")
  const env = loadEnv()
  const db = await connect(env)
  console.log("database:", db.databaseName)

  if (revertAt !== -1) {
    const file = path.resolve(process.argv[revertAt + 1] || "")
    const backup = JSON.parse(fs.readFileSync(file, "utf8"))
    const ops = backup.map((r) => ({
      updateOne: {
        filter: { _id: new mongoose.Types.ObjectId(r.id) },
        update: { $set: Object.fromEntries(Object.entries(r.changes).map(([f, c]) => [f, c.before])) },
      },
    }))
    const res = await db.collection("products").bulkWrite(ops, { ordered: false })
    console.log(`reverted ${res.modifiedCount} products`)
    await mongoose.disconnect()
    return
  }

  const rows = await collect(db)
  console.log(`${rows.length} products would change`)
  show(rows)

  if (!write) {
    console.log("\nDry run. Nothing was written. Re-run with --write to apply.")
    await mongoose.disconnect()
    return
  }

  const backup = path.join(HERE, `backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`)
  fs.writeFileSync(backup, JSON.stringify(rows, null, 2))
  console.log("\nbackup written:", backup)

  const ops = rows.map((r) => ({
    updateOne: {
      filter: { _id: new mongoose.Types.ObjectId(r.id) },
      update: { $set: Object.fromEntries(Object.entries(r.changes).map(([f, c]) => [f, c.after])) },
    },
  }))
  const res = await db.collection("products").bulkWrite(ops, { ordered: false })
  console.log(`updated ${res.modifiedCount} of ${rows.length} products`)
  console.log(`to undo: node apply.mjs --revert ${backup}`)
  await mongoose.disconnect()
}

run().catch((e) => { console.error(e); process.exit(1) })
