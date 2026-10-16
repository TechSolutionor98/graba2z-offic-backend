import mongoose from "mongoose"
import dotenv from "dotenv"
import path from "path"
import { fileURLToPath } from "url"

import Product from "../models/productModel.js"
import StockMovement, { MOVEMENT_REASONS } from "../models/stockMovementModel.js"

/**
 * Give every product that already holds stock an opening entry in the ledger.
 *
 * The ledger starts empty while the catalogue already holds stock, so without
 * this the In column reads zero beside a Stock column showing hundreds. The row
 * does not add up, and a stock page that does not add up gets distrusted
 * entirely -- so this is run once, before anyone is shown the new columns.
 *
 * Safe to run twice. Any product that already has an opening entry is skipped,
 * so a second run creates nothing rather than doubling anyone's stock.
 *
 *   node scripts/backfill-opening-stock.js --dry-run
 *   node scripts/backfill-opening-stock.js
 */

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

dotenv.config({ path: path.join(__dirname, "../.env") })

const DRY_RUN = process.argv.includes("--dry-run")
const BATCH_SIZE = 500

const connectDB = async () => {
  const mongoUri = process.env.MONGO_URI
  if (!mongoUri) {
    console.error("[Script Error] MONGO_URI is not defined in .env")
    process.exit(1)
  }
  const conn = await mongoose.connect(mongoUri)
  console.log(`[Script] MongoDB Connected: ${conn.connection.host}`)
}

const backfill = async () => {
  await connectDB()

  console.log("\n=======================================================")
  console.log("Opening stock backfill")
  console.log(DRY_RUN ? "MODE: dry run — nothing will be written" : "MODE: live")
  console.log("=======================================================\n")

  // Products holding nothing are left alone on purpose: an opening entry of zero
  // says nothing, and their first real delivery should be their first entry.
  const candidates = await Product.find({ countInStock: { $gt: 0 } })
    .select("name sku countInStock")
    .lean()

  console.log(`Products holding stock: ${candidates.length}`)

  if (candidates.length === 0) {
    console.log("Nothing to do.")
    return { created: 0, skipped: 0 }
  }

  // Which of them already have an opening entry. Asked once as a set rather than
  // once per product, so a large catalogue is one query instead of thousands.
  const alreadyOpened = await StockMovement.distinct("product", {
    product: { $in: candidates.map((product) => product._id) },
    type: "in",
    reason: MOVEMENT_REASONS.OPENING,
  })
  const opened = new Set(alreadyOpened.map((id) => String(id)))

  const pending = candidates.filter((product) => !opened.has(String(product._id)))
  const skipped = candidates.length - pending.length

  console.log(`Already have an opening entry: ${skipped}`)
  console.log(`To be given one now: ${pending.length}\n`)

  if (pending.length === 0) {
    console.log("Every product with stock already has its opening entry. Nothing created.")
    return { created: 0, skipped }
  }

  pending.slice(0, 10).forEach((product) => {
    console.log(`  ${product.sku || "(no sku)"}  ${String(product.name).slice(0, 48).padEnd(48)} ${product.countInStock}`)
  })
  if (pending.length > 10) console.log(`  … and ${pending.length - 10} more`)

  if (DRY_RUN) {
    console.log(`\nDry run: would create ${pending.length} opening movement(s). Nothing was written.`)
    return { created: 0, skipped }
  }

  // The stock figure is not touched. This records the stock that is already
  // there; moving it as well would double every product on the shelf.
  let created = 0
  for (let index = 0; index < pending.length; index += BATCH_SIZE) {
    const batch = pending.slice(index, index + BATCH_SIZE).map((product) => ({
      product: product._id,
      type: "in",
      quantity: Math.abs(Math.trunc(Number(product.countInStock) || 0)),
      reason: MOVEMENT_REASONS.OPENING,
      order: null,
      postedBy: null,
      postedByName: "",
      stockAfter: Number(product.countInStock) || 0,
    }))

    const inserted = await StockMovement.insertMany(batch, { ordered: false })
    created += inserted.length
    console.log(`  wrote ${created}/${pending.length}`)
  }

  console.log(`\nCreated ${created} opening movement(s). Skipped ${skipped} that already had one.`)
  return { created, skipped }
}

backfill()
  .then(() => mongoose.disconnect())
  .then(() => process.exit(0))
  .catch(async (error) => {
    console.error("[Script Error]", error)
    await mongoose.disconnect().catch(() => {})
    process.exit(1)
  })
