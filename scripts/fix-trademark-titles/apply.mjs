// Rewrites product titles that name another company's trademark, so Google
// Merchant Center reads them as compatible accessories rather than counterfeits.
//
//   node apply.mjs            dry run — prints every change, writes nothing
//   node apply.mjs --write    applies the changes, after writing a backup
//   node apply.mjs --revert <backup.json>   puts the old titles back
//
// Every run writes backup-<timestamp>.json next to this file before touching
// a single document, so any change can be undone.
import mongoose from "mongoose"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { rewriteTitle } from "./rules.mjs"
import { OVERRIDES } from "./overrides.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../..")

const loadEnv = () => {
  const file = path.join(ROOT, ".env")
  if (!fs.existsSync(file)) throw new Error(`no .env at ${file}`)
  return Object.fromEntries(
    fs.readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
  )
}

// The same trademark set the review used. A title is in scope only when its
// brand does not own the trademark it names.
const OWNER = {
  iphone: "apple", ipad: "apple", airpods: "apple", macbook: "apple", imac: "apple",
  "apple watch": "apple", magsafe: "apple", airtag: "apple", apple: "apple",
  galaxy: "samsung", samsung: "samsung",
  xbox: "microsoft",
  playstation: "sony", ps5: "sony", ps4: "sony",
  "nintendo switch": "nintendo",
  kindle: "amazon", alexa: "amazon", "echo dot": "amazon",
  gopro: "gopro", fitbit: "google", pixel: "google",
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const names = (title, tm) => new RegExp(`(^|[^a-z0-9])${esc(tm)}([^a-z0-9]|$)`, "i").test(title)

const connect = async (env) => {
  await mongoose.connect(env.MONGO_URI, { dbName: env.MONGO_DB_NAME || undefined })
  return mongoose.connection.db
}

const collect = async (db) => {
  const brands = new Map()
  for (const b of await db.collection("brands").find({}, { projection: { name: 1 } }).toArray()) {
    brands.set(String(b._id), b.name)
  }
  const products = await db.collection("products")
    .find({}, { projection: { name: 1, sku: 1, brand: 1 } })
    .toArray()

  const rows = []
  for (const p of products) {
    const title = String(p.name || "")
    const brand = brands.get(String(p.brand)) || ""
    const bn = brand.toLowerCase().replace(/\s+/g, "")
    const foreign = Object.keys(OWNER).filter(
      (tm) => names(title, tm) && OWNER[tm].replace(/\s+/g, "") !== bn
    )
    // In scope: the title names a trademark its brand does not own, or the
    // product has a hand-written title waiting for it.
    const hasOverride = Object.prototype.hasOwnProperty.call(OVERRIDES, p.sku)
    if (!foreign.length && !hasOverride) continue
    const newTitle = rewriteTitle(title, p.sku, brand)
    if (newTitle === title) continue
    rows.push({ id: String(p._id), sku: p.sku || "", brand, oldTitle: title, newTitle })
  }
  return rows
}

const revert = async (db, file) => {
  const backup = JSON.parse(fs.readFileSync(file, "utf8"))
  const ops = backup.map((r) => ({
    updateOne: { filter: { _id: new mongoose.Types.ObjectId(r.id) }, update: { $set: { name: r.oldTitle } } },
  }))
  const res = await db.collection("products").bulkWrite(ops, { ordered: false })
  console.log(`reverted ${res.modifiedCount} titles from ${path.basename(file)}`)
}

const run = async () => {
  const write = process.argv.includes("--write")
  const revertAt = process.argv.indexOf("--revert")
  const env = loadEnv()
  const db = await connect(env)
  console.log("database:", db.databaseName)

  if (revertAt !== -1) {
    const file = process.argv[revertAt + 1]
    if (!file) throw new Error("--revert needs the path to a backup file")
    await revert(db, path.resolve(file))
    await mongoose.disconnect()
    return
  }

  const rows = await collect(db)
  console.log(`${rows.length} titles would change\n`)
  for (const r of rows) {
    console.log(`[${r.brand}] ${r.sku}`)
    console.log(`  before: ${r.oldTitle}`)
    console.log(`  after : ${r.newTitle}\n`)
  }

  if (!write) {
    console.log("Dry run. Nothing was written. Re-run with --write to apply.")
    await mongoose.disconnect()
    return
  }

  const backup = path.join(HERE, `backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`)
  fs.writeFileSync(backup, JSON.stringify(rows, null, 2))
  console.log("backup written:", backup)

  const ops = rows.map((r) => ({
    updateOne: { filter: { _id: new mongoose.Types.ObjectId(r.id) }, update: { $set: { name: r.newTitle } } },
  }))
  const res = await db.collection("products").bulkWrite(ops, { ordered: false })
  console.log(`updated ${res.modifiedCount} of ${rows.length} titles`)
  console.log(`to undo: node apply.mjs --revert ${backup}`)
  await mongoose.disconnect()
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
