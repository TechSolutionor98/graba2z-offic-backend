import mongoose from "mongoose"

import Product from "../models/productModel.js"
import StockMovement, { MOVEMENT_REASONS } from "../models/stockMovementModel.js"

/**
 * The only way stock changes.
 *
 * Every movement is posted here and nowhere else, because this function does two
 * things that have to happen together: it adjusts the product's stock figure and
 * it writes the ledger row that explains the adjustment. Anything that changed
 * countInStock on its own would put the figure and its history out of step, and
 * once they disagree neither can be trusted again.
 */

const SIGN = { in: 1, out: -1, damage: -1 }

/**
 * Post one movement and move the stock figure with it.
 *
 * Two things about this function matter more than anything else it does:
 *
 * 1. The stock figure is moved with an atomic $inc, never read-then-write. Two
 *    orders landing in the same moment would otherwise both read the same count
 *    and both write their own answer back, and one sale's worth of stock would
 *    simply vanish. The database does the arithmetic so the two increments
 *    cannot overwrite each other.
 *
 * 2. It never throws. It runs while an order is being placed, and a ledger
 *    problem must not fail a sale the customer has already paid for. A failure
 *    is logged and null comes back; the caller carries on.
 *
 * @returns the saved movement, or null if nothing was posted.
 */
export async function postStockMovement({
  product,
  type,
  quantity,
  reason,
  order = null,
  postedBy = null,
  postedByName = "",
}) {
  try {
    const productId = product?._id || product
    if (!productId || !mongoose.Types.ObjectId.isValid(String(productId))) {
      console.warn("[STOCK] Refusing a movement with no valid product")
      return null
    }

    const direction = SIGN[type]
    if (!direction) {
      console.warn(`[STOCK] Refusing a movement of unknown type "${type}"`)
      return null
    }

    // Quantities are always stored positive; a caller that sends -3 out means
    // three out, not three in, and a zero is not a movement at all.
    const units = Math.abs(Math.trunc(Number(quantity) || 0))
    if (units < 1) return null

    if (!reason || !String(reason).trim()) {
      console.warn("[STOCK] Refusing a movement with no reason")
      return null
    }

    // The atomic step. `new: true` hands back the figure *after* this increment,
    // which is exactly what the ledger row has to record -- reading it separately
    // would read whatever a concurrent order had done in the meantime.
    const updated = await Product.findByIdAndUpdate(
      productId,
      { $inc: { countInStock: direction * units } },
      { new: true, select: "countInStock" },
    )

    if (!updated) {
      console.warn(`[STOCK] No product ${productId} to move stock for`)
      return null
    }

    return await StockMovement.create({
      product: productId,
      type,
      quantity: units,
      reason: String(reason).trim(),
      order: order?._id || order || null,
      postedBy: postedBy?._id || postedBy || null,
      postedByName: postedByName || postedBy?.name || "",
      stockAfter: Number(updated.countInStock) || 0,
    })
  } catch (error) {
    // Deliberately swallowed. See the contract above.
    console.error("[STOCK] Could not post a stock movement:", error?.message || error)
    return null
  }
}

/**
 * The lines of an order that represent physical goods.
 *
 * Buyer protection and warranties are sold as order lines but nothing leaves a
 * shelf for them, so moving stock for one would invent a shortage.
 */
export function physicalOrderLines(order) {
  const lines = Array.isArray(order?.orderItems) ? order.orderItems : []
  return lines.filter((line) => {
    if (line?.isProtection) return false
    if (!line?.product) return false
    const quantity = Math.trunc(Number(line.quantity) || 0)
    return quantity > 0
  })
}

const lineProductId = (line) => line?.product?._id || line?.product

/** A short, readable reference for an order, matching the rest of the admin. */
const orderLabel = (order) => `#${String(order?._id || "").slice(-6).toUpperCase()}`

/**
 * Take an order's goods off the shelf.
 *
 * Unlike a notification this is awaited by the checkout. An order that does not
 * move stock leaves the shop overselling the next customer, which is a worse
 * outcome than a slow checkout.
 */
export async function recordOrderPlaced(order) {
  const lines = physicalOrderLines(order)
  if (lines.length === 0) return { posted: 0 }

  let posted = 0
  for (const line of lines) {
    const movement = await postStockMovement({
      product: lineProductId(line),
      type: "out",
      quantity: line.quantity,
      reason: `${MOVEMENT_REASONS.SALE} on order ${orderLabel(order)}`,
      order: order._id,
    })
    if (movement) posted += 1
  }

  console.log(`[STOCK] Order ${orderLabel(order)}: ${posted}/${lines.length} line(s) taken out of stock`)
  return { posted }
}

/**
 * Put a cancelled order's goods back on the shelf.
 *
 * Guarded against running twice. A cancelled order can be saved again -- by a
 * second click, by a status set back and forth, by the customer's WhatsApp tap
 * arriving after an admin already cancelled it -- and each of those would
 * otherwise return the stock again and quietly inflate the figure.
 */
export async function recordOrderCancelled(order) {
  const lines = physicalOrderLines(order)
  if (lines.length === 0) return { posted: 0, alreadyReturned: false }

  // The guard. One row is enough to know this order has already been put back:
  // the return is posted as a batch, so either all of it happened or none did.
  //
  // If the guard itself cannot be checked, nothing is posted. Failing closed
  // leaves a return for a person to post by hand, which is visible and fixable;
  // failing open would silently inflate stock on a figure nobody is watching.
  let alreadyReturned
  try {
    alreadyReturned = await StockMovement.exists({ order: order._id, type: "in" })
  } catch (error) {
    console.error(
      `[STOCK] Could not check whether order ${orderLabel(order)} was already returned, so nothing was posted:`,
      error?.message || error,
    )
    return { posted: 0, alreadyReturned: false, guardFailed: true }
  }

  if (alreadyReturned) {
    console.log(`[STOCK] Order ${orderLabel(order)} was already returned to stock — nothing posted`)
    return { posted: 0, alreadyReturned: true }
  }

  let posted = 0
  for (const line of lines) {
    const movement = await postStockMovement({
      product: lineProductId(line),
      type: "in",
      quantity: line.quantity,
      reason: `${MOVEMENT_REASONS.ORDER_RETURN} ${orderLabel(order)}`,
      order: order._id,
    })
    if (movement) posted += 1
  }

  console.log(`[STOCK] Order ${orderLabel(order)}: ${posted}/${lines.length} line(s) returned to stock`)
  return { posted, alreadyReturned: false }
}

/**
 * The in / out / damage totals for a set of products, keyed by product id.
 *
 * Used by the Store Stats columns. Only the products on the page are asked for,
 * so this stays a single indexed grouping however large the catalogue is.
 */
export async function movementTotalsFor(productIds = []) {
  const ids = productIds
    .map((id) => String(id?._id || id))
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id))

  if (ids.length === 0) return {}

  const rows = await StockMovement.aggregate([
    { $match: { product: { $in: ids } } },
    { $group: { _id: { product: "$product", type: "$type" }, total: { $sum: "$quantity" } } },
  ])

  const totals = {}
  for (const row of rows) {
    const key = String(row._id.product)
    if (!totals[key]) totals[key] = { in: 0, out: 0, damage: 0 }
    totals[key][row._id.type] = row.total
  }
  return totals
}

export default {
  postStockMovement,
  physicalOrderLines,
  recordOrderPlaced,
  recordOrderCancelled,
  movementTotalsFor,
}
