/**
 * A complete copy of the products collection, and the means to put it back.
 *
 * Every document in full, written as EJSON so ObjectIds, dates and numbers come
 * back as themselves rather than as strings that merely look right. A restore
 * is byte-for-byte, not approximately.
 *
 * Usage:
 *   node backup.mjs                          # take a backup
 *   node backup.mjs --out ~/Desktop          # …somewhere other than ./backups
 *   node backup.mjs --verify <file>          # check a file against the live data
 *   node backup.mjs --restore <file>         # put every product back as it was
 *   node backup.mjs --restore <file> --only-prices
 *                                            # put ONLY price, offerPrice and
 *                                            # discount back; leave everything
 *                                            # else as it is today
 *
 * --restore replaces documents by _id and re-creates any that have since been
 * deleted. It does not remove products created after the backup was taken.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import mongoose from "mongoose"
import dotenv from "dotenv"

const HERE = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(HERE, "..", "..", ".env") })

const argv = process.argv.slice(2)
const flag = (n) => argv.includes(`--${n}`)
const val = (n) => {
  const i = argv.indexOf(`--${n}`)
  return i === -1 ? null : argv[i + 1]
}

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
}

const expand = (p) => (p.startsWith("~") ? path.join(process.env.HOME, p.slice(1)) : path.resolve(p))
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`
const EJSON = () => mongoose.mongo.BSON.EJSON

const connect = async () => {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI
  if (!uri) throw new Error("MONGO_URI is not set (looked in server/.env)")
  await mongoose.connect(uri)
  return mongoose.connection.collection("products")
}

/** Read a backup file and hand back its documents, already deserialised. */
const load = (file) => {
  const resolved = expand(file)
  if (!fs.existsSync(resolved)) throw new Error(`No such file: ${resolved}`)
  const raw = JSON.parse(fs.readFileSync(resolved, "utf8"))
  if (!Array.isArray(raw.products)) throw new Error(`${resolved} is not a product backup`)
  return { meta: raw, docs: raw.products.map((d) => EJSON().deserialize(d)), file: resolved }
}

const take = async (Products) => {
  const total = await Products.countDocuments({})
  process.stdout.write(`  reading ${total} products… `)
  const docs = await Products.find({}).toArray()
  console.log("done")

  const outDir = val("out") ? expand(val("out")) : path.join(HERE, "backups")
  fs.mkdirSync(outDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
  const file = path.join(outDir, `products-${stamp}.json`)

  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        takenAt: new Date().toISOString(),
        collection: "products",
        count: docs.length,
        // What a restore puts back, written down so a future reader does not
        // have to infer it from the code.
        restores: "every field of every document, matched by _id",
        products: docs.map((d) => EJSON().serialize(d)),
      },
      null,
      2,
    ),
  )

  const size = fs.statSync(file).size
  console.log(`\n  ${c.green("backup written")}`)
  console.log(`  ${c.bold(file)}`)
  console.log(`  ${docs.length} products · ${mb(size)}`)

  // A backup nobody has checked is a hope, not a backup.
  const check = load(file)
  const sameCount = check.docs.length === docs.length
  const sameFirst = JSON.stringify(EJSON().serialize(check.docs[0])) === JSON.stringify(EJSON().serialize(docs[0]))
  const ids = new Set(check.docs.map((d) => String(d._id)))
  console.log(`\n  re-read and checked:`)
  console.log(`    document count matches : ${sameCount ? c.green("yes") : c.red("NO")}`)
  console.log(`    unique _id values      : ${ids.size === docs.length ? c.green(`${ids.size}, all distinct`) : c.red(`${ids.size} of ${docs.length}`)}`)
  console.log(`    first document identical: ${sameFirst ? c.green("yes") : c.red("NO")}`)

  const withPrice = check.docs.filter((d) => Number(d.price) > 0).length
  const zeroPrice = check.docs.filter((d) => !(Number(d.price) > 0)).length
  console.log(`    carrying a price       : ${withPrice}   (price of 0 or missing: ${zeroPrice})`)

  console.log(c.dim(`\n  restore everything : node backup.mjs --restore ${path.relative(HERE, file)}`))
  console.log(c.dim(`  restore prices only: node backup.mjs --restore ${path.relative(HERE, file)} --only-prices\n`))
}

const verify = async (Products, file) => {
  const { meta, docs, file: resolved } = load(file)
  console.log(`\n  ${c.bold(path.basename(resolved))}  taken ${meta.takenAt}  ${meta.count} products\n`)

  let missing = 0, identical = 0, differs = 0
  const priceMoves = []
  for (const old of docs) {
    const live = await Products.findOne({ _id: old._id })
    if (!live) { missing += 1; continue }
    if (JSON.stringify(EJSON().serialize(live)) === JSON.stringify(EJSON().serialize(old))) identical += 1
    else {
      differs += 1
      if (Number(old.price) !== Number(live.price) || Number(old.offerPrice) !== Number(live.offerPrice)) {
        priceMoves.push({ sku: live.sku, was: [old.price, old.offerPrice], now: [live.price, live.offerPrice] })
      }
    }
  }
  console.log(`  identical to the backup : ${identical}`)
  console.log(`  changed since           : ${differs}`)
  console.log(`  deleted since           : ${missing}`)
  console.log(`  of the changed, price or offer differs: ${priceMoves.length}`)
  for (const p of priceMoves.slice(0, 15)) {
    console.log(c.dim(`    ${String(p.sku).padEnd(24)} ${p.was[0]}/${p.was[1]}  ->  ${p.now[0]}/${p.now[1]}`))
  }
  if (priceMoves.length > 15) console.log(c.dim(`    … and ${priceMoves.length - 15} more`))
  console.log()
}

const restore = async (Products, file) => {
  const { meta, docs, file: resolved } = load(file)
  const pricesOnly = flag("only-prices")

  console.log(`\n  restoring from ${c.bold(path.basename(resolved))}`)
  console.log(`  taken ${meta.takenAt} · ${meta.count} products`)
  console.log(`  mode: ${pricesOnly ? c.yellow("price, offerPrice and discount only") : c.red("every field of every document")}\n`)

  let written = 0, recreated = 0, untouched = 0
  const ops = []
  for (const old of docs) {
    if (pricesOnly) {
      const live = await Products.findOne({ _id: old._id }, { projection: { price: 1, offerPrice: 1, discount: 1 } })
      if (!live) { untouched += 1; continue }
      const same =
        Number(live.price) === Number(old.price) &&
        Number(live.offerPrice) === Number(old.offerPrice) &&
        Number(live.discount) === Number(old.discount)
      if (same) { untouched += 1; continue }
      ops.push({
        updateOne: {
          filter: { _id: old._id },
          update: { $set: { price: old.price, offerPrice: old.offerPrice, discount: old.discount } },
        },
      })
      written += 1
    } else {
      ops.push({ replaceOne: { filter: { _id: old._id }, replacement: old, upsert: true } })
      written += 1
    }
    if (ops.length >= 500) { await Products.bulkWrite(ops); ops.length = 0 }
  }
  if (ops.length) {
    const r = await Products.bulkWrite(ops)
    recreated += r.upsertedCount || 0
  }

  console.log(`  ${c.green(`${written} product(s) written`)}${recreated ? ` (${recreated} re-created)` : ""}`)
  if (pricesOnly) console.log(c.dim(`  ${untouched} left alone (already matching, or no longer in the catalogue)`))
  console.log()
}

const run = async () => {
  const Products = await connect()
  try {
    if (val("verify")) await verify(Products, val("verify"))
    else if (val("restore")) await restore(Products, val("restore"))
    else await take(Products)
  } finally {
    await mongoose.disconnect()
  }
}

run().catch(async (err) => {
  console.error(c.red(`\n  ${err.message}\n`))
  await mongoose.disconnect().catch(() => {})
  process.exitCode = 1
})
