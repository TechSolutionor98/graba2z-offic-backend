/**
 * Take products off the website, from a list exported out of Admin -> Products.
 *
 * Reads the .xlsx (or .csv) straight from the export, matches each row to a
 * product by `_id` first and `sku` second, and reports exactly what it found
 * before it changes anything.
 *
 * Nothing is written without --write. Every run that writes takes a complete
 * copy of every affected document first, so --restore puts them back byte for
 * byte.
 *
 * Two ways to remove:
 *
 *   hide (default)   isActive: false, hideFromShop: true.
 *                    Gone from the shop, the search, the sitemap and the Google
 *                    feed. The record stays, so order history still resolves
 *                    and the decision is reversible with one command.
 *
 *   --hard-delete    The documents are deleted outright. Any order line, review
 *                    or offer page pointing at one is left pointing at nothing.
 *                    Only the backup file can undo this.
 *
 * Usage:
 *   node remove.mjs --file ~/Downloads/products_selected.xlsx            # dry run
 *   node remove.mjs --file ~/Downloads/products_selected.xlsx --write
 *   node remove.mjs --file ~/Downloads/products_selected.xlsx --write --hard-delete
 *   node remove.mjs --restore backups/2026-10-30T09-14-02.json
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import mongoose from "mongoose"
import dotenv from "dotenv"
import XLSX from "xlsx"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BACKUP_DIR = path.join(HERE, "backups")

dotenv.config({ path: path.join(HERE, "..", "..", ".env") })

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(`--${name}`)
const value = (name) => {
  const at = argv.indexOf(`--${name}`)
  return at === -1 ? null : argv[at + 1]
}

const WRITE = flag("write")
const HARD = flag("hard-delete")
const FILE = value("file")
const RESTORE = value("restore")

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
}

const connect = async () => {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI
  if (!uri) throw new Error("MONGO_URI is not set (looked in server/.env)")
  await mongoose.connect(uri)
  return mongoose.connection
}

/** Pull `_id` and `sku` out of the export, whatever case the headers are in. */
const readList = (file) => {
  const resolved = file.startsWith("~") ? path.join(process.env.HOME, file.slice(1)) : path.resolve(file)
  if (!fs.existsSync(resolved)) throw new Error(`No such file: ${resolved}`)

  const book = XLSX.readFile(resolved)
  const sheet = book.Sheets[book.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" })

  const pick = (row, names) => {
    const key = Object.keys(row).find((k) => names.includes(k.trim().toLowerCase()))
    return key ? String(row[key]).trim() : ""
  }

  return rows
    .map((row, i) => ({
      line: i + 2, // +2: the header is row 1 and the sheet is 1-based.
      id: pick(row, ["_id", "id", "product id", "productid"]),
      sku: pick(row, ["sku", "code"]),
      name: pick(row, ["name", "product name", "title"]),
    }))
    .filter((r) => r.id || r.sku)
}

/** Resolve each row to one product, and say plainly which rows did not resolve. */
const resolve = async (Products, rows) => {
  const ids = rows.filter((r) => /^[0-9a-f]{24}$/i.test(r.id)).map((r) => new mongoose.Types.ObjectId(r.id))
  const skus = rows.filter((r) => r.sku).map((r) => r.sku)

  const found = await Products.find({ $or: [{ _id: { $in: ids } }, { sku: { $in: skus } }] }).toArray()

  const byId = new Map(found.map((p) => [String(p._id), p]))
  const bySku = new Map(found.filter((p) => p.sku).map((p) => [String(p.sku).trim(), p]))

  const matched = new Map() // _id -> { product, row }
  const missing = []

  for (const row of rows) {
    const hit = (row.id && byId.get(row.id)) || (row.sku && bySku.get(row.sku))
    if (!hit) {
      missing.push(row)
      continue
    }
    // A row listed twice is counted once; the sheet is a set, not a quantity.
    if (!matched.has(String(hit._id))) matched.set(String(hit._id), { product: hit, row })
  }

  return { matched: [...matched.values()], missing }
}

/** What else in the database points at these products. */
const countReferences = async (db, ids) => {
  const existing = new Set((await db.db.listCollections().toArray()).map((x) => x.name))
  const checks = [
    ["orders", { "orderItems.product": { $in: ids } }, "order(s) contain one of these products"],
    ["reviews", { product: { $in: ids } }, "review(s)"],
    ["productreviews", { product: { $in: ids } }, "product review(s)"],
    ["offerproducts", { product: { $in: ids } }, "offer-page entr(ies)"],
    ["stockmovements", { product: { $in: ids } }, "stock movement(s)"],
    ["homesections", { products: { $in: ids } }, "home section(s)"],
    ["customslideritems", { product: { $in: ids } }, "slider item(s)"],
  ]

  const out = []
  for (const [name, query, label] of checks) {
    if (!existing.has(name)) continue
    try {
      const n = await db.collection(name).countDocuments(query)
      if (n > 0) out.push({ name, n, label })
    } catch {
      /* a collection whose shape does not take this query simply does not count */
    }
  }
  return out
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)

const run = async () => {
  const db = await connect()
  const Products = db.collection("products")

  if (RESTORE) {
    const file = path.isAbsolute(RESTORE) ? RESTORE : path.join(HERE, RESTORE)
    const backup = JSON.parse(fs.readFileSync(file, "utf8"))
    console.log(`\nRestoring ${backup.products.length} product(s) from ${c.bold(path.basename(file))}`)
    console.log(`  taken ${backup.takenAt}, mode "${backup.mode}"\n`)

    let restored = 0
    for (const doc of backup.products) {
      const parsed = mongoose.mongo.BSON.EJSON.deserialize(doc)
      await Products.replaceOne({ _id: parsed._id }, parsed, { upsert: true })
      restored += 1
    }
    console.log(c.green(`  ${restored} product(s) restored.\n`))
    await mongoose.disconnect()
    return
  }

  if (!FILE) {
    console.error(c.red("\n  --file is required (the .xlsx exported from Admin -> Products).\n"))
    await mongoose.disconnect()
    process.exitCode = 1
    return
  }

  const rows = readList(FILE)
  const { matched, missing } = await resolve(Products, rows)
  const ids = matched.map((m) => m.product._id)

  console.log(`\n${c.bold("Products to remove")}`)
  console.log(`  listed in the file : ${rows.length}`)
  console.log(`  matched in the db  : ${matched.length}`)
  console.log(`  not found          : ${missing.length}${missing.length ? c.red("  <- read these before writing") : ""}`)

  for (const row of missing.slice(0, 20)) {
    console.log(c.red(`      row ${row.line}: id="${row.id}" sku="${row.sku}" ${row.name.slice(0, 40)}`))
  }
  if (missing.length > 20) console.log(c.red(`      … and ${missing.length - 20} more`))

  const alreadyHidden = matched.filter((m) => m.product.isActive === false).length
  if (alreadyHidden) console.log(c.dim(`  already hidden     : ${alreadyHidden}`))

  const refs = await countReferences(db, ids)
  console.log(`\n${c.bold("What else points at them")}`)
  if (refs.length === 0) console.log("  nothing")
  for (const r of refs) console.log(`  ${String(r.n).padStart(6)}  ${r.label}`)

  console.log(`\n${c.bold("Method")}  ${HARD ? c.red("HARD DELETE — the records are destroyed") : c.green("hide — isActive:false, hideFromShop:true")}`)

  console.log(`\n${c.dim("first 10:")}`)
  for (const { product } of matched.slice(0, 10)) {
    console.log(c.dim(`  ${product.sku || "(no sku)"}  ${String(product.name).slice(0, 72)}`))
  }

  if (!WRITE) {
    console.log(c.yellow(`\n  Dry run. Nothing was changed. Add --write to apply.\n`))
    await mongoose.disconnect()
    return
  }

  if (matched.length === 0) {
    console.log(c.yellow("\n  Nothing matched, so nothing to do.\n"))
    await mongoose.disconnect()
    return
  }

  // Back up the complete documents before touching anything. EJSON keeps the
  // ObjectIds and dates as themselves, so a restore is exact rather than close.
  fs.mkdirSync(BACKUP_DIR, { recursive: true })
  const backupFile = path.join(BACKUP_DIR, `${stamp()}.json`)
  fs.writeFileSync(
    backupFile,
    JSON.stringify(
      {
        takenAt: new Date().toISOString(),
        mode: HARD ? "hard-delete" : "hide",
        sourceFile: FILE,
        count: matched.length,
        products: matched.map((m) => mongoose.mongo.BSON.EJSON.serialize(m.product)),
      },
      null,
      2,
    ),
  )
  console.log(`\n  backup written: ${c.bold(backupFile)}`)

  if (HARD) {
    const { deletedCount } = await Products.deleteMany({ _id: { $in: ids } })
    console.log(c.red(`  ${deletedCount} product(s) deleted.`))
  } else {
    const { modifiedCount } = await Products.updateMany(
      { _id: { $in: ids } },
      { $set: { isActive: false, hideFromShop: true } },
    )
    console.log(c.green(`  ${modifiedCount} product(s) hidden (${matched.length - modifiedCount} were already).`))
  }

  console.log(c.dim(`\n  undo:  node remove.mjs --restore backups/${path.basename(backupFile)}\n`))
  await mongoose.disconnect()
}

run().catch(async (err) => {
  console.error(c.red(`\n  ${err.message}\n`))
  await mongoose.disconnect().catch(() => {})
  process.exitCode = 1
})
