import mongoose from "mongoose"

import LoyaltySettings from "../models/loyaltySettingsModel.js"
import LoyaltyRule from "../models/loyaltyRuleModel.js"
import LoyaltyTransaction from "../models/loyaltyTransactionModel.js"
import User from "../models/userModel.js"
import Order from "../models/orderModel.js"

// The loyalty engine. Every rate in here is expressed against AED, the currency product
// prices are stored in, so one configuration serves every country the store sells in.
//
// Two rules hold this together:
//   1. The spendable balance (User.loyaltyPoints) is only ever moved with an atomic $inc,
//      paired with a LoyaltyTransaction row. Nothing writes the balance directly.
//   2. Every payout is claimed with a conditional update before points are credited, so a
//      retried webhook or a double-clicked status change cannot pay out twice.

// ---------------------------------------------------------------------------
// Settings and rule caching
// ---------------------------------------------------------------------------

// Settings and category rules are read on nearly every product render, and change only
// when an admin saves. A short TTL keeps the storefront off the database without making
// an admin wait to see their own change.
const CACHE_TTL_MS = 60 * 1000

let settingsCache = { value: null, expiresAt: 0 }
let rulesCache = { value: null, expiresAt: 0 }

export function invalidateLoyaltyCache() {
  settingsCache = { value: null, expiresAt: 0 }
  rulesCache = { value: null, expiresAt: 0 }
}

export async function getLoyaltySettings({ fresh = false } = {}) {
  const now = Date.now()
  if (!fresh && settingsCache.value && settingsCache.expiresAt > now) {
    return settingsCache.value
  }

  const doc = await LoyaltySettings.getSingleton()
  const value = typeof doc.toObject === "function" ? doc.toObject() : doc
  settingsCache = { value, expiresAt: now + CACHE_TTL_MS }
  return value
}

// Category rules keyed as "<scope>:<refId>" for O(1) lookup while walking a product's
// category chain.
export async function getCategoryRuleMap({ fresh = false } = {}) {
  const now = Date.now()
  if (!fresh && rulesCache.value && rulesCache.expiresAt > now) {
    return rulesCache.value
  }

  const rules = await LoyaltyRule.find({ isActive: true }).lean()
  const map = new Map()
  for (const rule of rules) {
    map.set(`${rule.scope}:${String(rule.refId)}`, rule)
  }
  rulesCache = { value: map, expiresAt: now + CACHE_TTL_MS }
  return map
}

// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------

const toNumber = (value, fallback = 0) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

const applyRounding = (value, mode) => {
  if (!Number.isFinite(value)) return 0
  if (mode === "ceil") return Math.ceil(value)
  if (mode === "round") return Math.round(value)
  return Math.floor(value)
}

// Points -> AED. Floored to fils so a redemption can never hand back more money than the
// points cover.
export function pointsToAed(points, settings) {
  const perAed = toNumber(settings?.redeemPointsPerAed, 0)
  if (perAed <= 0) return 0
  const raw = toNumber(points, 0) / perAed
  return Math.floor(raw * 100) / 100
}

// AED -> points, floored: asking for 1.5 AED of headroom must not unlock a point that
// would buy 1.51 AED.
export function aedToPoints(amountAed, settings) {
  const perAed = toNumber(settings?.redeemPointsPerAed, 0)
  if (perAed <= 0) return 0
  return Math.floor(toNumber(amountAed, 0) * perAed)
}

// ---------------------------------------------------------------------------
// Earning rules
// ---------------------------------------------------------------------------

// Deepest category first: a rule on "Gaming Keyboards" beats one on "Accessories".
const CATEGORY_CHAIN = [
  { field: "subCategory4", scope: "subcategory" },
  { field: "subCategory3", scope: "subcategory" },
  { field: "subCategory2", scope: "subcategory" },
  { field: "category", scope: "subcategory" },
  { field: "subCategory", scope: "subcategory" },
  { field: "parentCategory", scope: "category" },
]

// A product/category reference may arrive as an id string or a populated document.
const refIdOf = (value) => {
  if (!value) return null
  if (typeof value === "string") return value
  if (typeof value === "object") {
    if (value._id) return String(value._id)
    return String(value)
  }
  return null
}

// Work out which rule governs a product: its own override, else the nearest category
// rule, else the global rate. `source` is returned so the admin UI can explain itself.
export function resolveEarnRule(product, ruleMap) {
  if (!product) return { mode: "multiplier", multiplier: 1, fixedPoints: 0, source: "global" }

  const productMode = product.loyaltyPointsMode || "inherit"

  if (productMode === "none") {
    return { mode: "none", multiplier: 0, fixedPoints: 0, source: "product" }
  }
  if (productMode === "fixed") {
    return {
      mode: "fixed",
      multiplier: 1,
      fixedPoints: Math.max(0, toNumber(product.loyaltyPointsFixed, 0)),
      source: "product",
    }
  }
  if (productMode === "multiplier") {
    return {
      mode: "multiplier",
      multiplier: Math.max(0, toNumber(product.loyaltyPointsMultiplier, 1)),
      fixedPoints: 0,
      source: "product",
    }
  }

  // inherit: walk the category chain, deepest first.
  if (ruleMap && ruleMap.size > 0) {
    for (const { field, scope } of CATEGORY_CHAIN) {
      const refId = refIdOf(product[field])
      if (!refId) continue
      const rule = ruleMap.get(`${scope}:${refId}`)
      if (!rule) continue

      if (rule.mode === "fixed") {
        return {
          mode: "fixed",
          multiplier: 1,
          fixedPoints: Math.max(0, toNumber(rule.fixedPoints, 0)),
          source: "category",
          sourceName: rule.refName || "",
        }
      }
      return {
        mode: "multiplier",
        multiplier: Math.max(0, toNumber(rule.multiplier, 1)),
        fixedPoints: 0,
        source: "category",
        sourceName: rule.refName || "",
      }
    }
  }

  return { mode: "multiplier", multiplier: 1, fixedPoints: 0, source: "global" }
}

// Points a single unit of this product earns, at the price actually being charged.
//
// Rounding happens per unit rather than on the line total, so the number quoted on the
// product page is exactly what a buyer gets for each one they add.
export function calculateUnitPoints({ product, unitPriceAed, settings, ruleMap }) {
  if (!settings?.isEnabled) return 0

  const rule = resolveEarnRule(product, ruleMap)
  if (rule.mode === "none") return 0

  if (rule.mode === "fixed") {
    return Math.max(0, Math.floor(rule.fixedPoints))
  }

  const perAed = toNumber(settings.earnPointsPerAed, 0)
  if (perAed <= 0) return 0

  const price = Math.max(0, toNumber(unitPriceAed, 0))
  const raw = price * perAed * rule.multiplier
  return Math.max(0, applyRounding(raw, settings.earnRounding))
}

// Points for a whole cart or order.
//
// `items` entries need { product, price, quantity }, where product is a document (or the
// populated ref) and price is the unit price in AED actually charged. Buyer-protection
// lines carry no product and never earn.
export function calculateEarnedPoints({ items, settings, ruleMap, redeemedAmountAed = 0 }) {
  if (!settings?.isEnabled || !Array.isArray(items) || items.length === 0) {
    return { totalPoints: 0, perItem: [] }
  }

  const perItem = []
  let totalPoints = 0
  let eligibleSubtotal = 0

  for (const item of items) {
    const product = item.product && typeof item.product === "object" ? item.product : null
    const quantity = Math.max(0, toNumber(item.quantity, 0))
    const unitPrice = Math.max(0, toNumber(item.price, 0))

    if (item.isProtection || !product || quantity <= 0) {
      perItem.push({ points: 0, unitPoints: 0 })
      continue
    }

    const unitPoints = calculateUnitPoints({ product, unitPriceAed: unitPrice, settings, ruleMap })
    const linePoints = unitPoints * quantity

    perItem.push({ points: linePoints, unitPoints })
    totalPoints += linePoints
    eligibleSubtotal += unitPrice * quantity
  }

  // The share of the basket paid for with points does not earn points back, otherwise the
  // programme slowly refunds itself.
  const redeemed = Math.max(0, toNumber(redeemedAmountAed, 0))
  if (!settings.earnOnRedeemedPortion && redeemed > 0 && eligibleSubtotal > 0) {
    const payingRatio = Math.max(0, (eligibleSubtotal - redeemed) / eligibleSubtotal)
    totalPoints = Math.floor(totalPoints * payingRatio)
  }

  return { totalPoints: Math.max(0, totalPoints), perItem }
}

// ---------------------------------------------------------------------------
// Redemption
// ---------------------------------------------------------------------------

const snapToStep = (points, step) => {
  const size = Math.max(1, Math.floor(toNumber(step, 1)))
  return Math.floor(Math.max(0, points) / size) * size
}

// Work out how much of this order points may cover, and what applying `requestedPoints`
// would actually do. Pure: callers use it for both the checkout quote and server-side
// enforcement, so the two can never disagree.
export function computeRedemption({
  eligibleAmountAed,
  availablePoints,
  requestedPoints = 0,
  settings,
}) {
  const empty = {
    maxPoints: 0,
    maxDiscountAed: 0,
    appliedPoints: 0,
    discountAed: 0,
    blockedReason: null,
  }

  if (!settings?.isEnabled) {
    return { ...empty, blockedReason: "disabled" }
  }

  const available = Math.max(0, Math.floor(toNumber(availablePoints, 0)))
  const eligible = Math.max(0, toNumber(eligibleAmountAed, 0))
  const minPoints = Math.max(0, toNumber(settings.minPointsToRedeem, 0))

  if (available <= 0) return { ...empty, blockedReason: "no_points" }
  if (available < minPoints) return { ...empty, blockedReason: "below_minimum" }
  if (eligible <= 0) return { ...empty, blockedReason: "empty_cart" }

  // Cap by the configured share of the order, so points never take the payable amount to
  // zero and trip a payment gateway minimum.
  const percent = Math.min(100, Math.max(0, toNumber(settings.maxRedeemPercentOfOrder, 0)))
  const capAed = (eligible * percent) / 100
  let maxPoints = Math.min(available, aedToPoints(capAed, settings))

  const perOrderCeiling = Math.max(0, toNumber(settings.maxPointsPerOrder, 0))
  if (perOrderCeiling > 0) {
    maxPoints = Math.min(maxPoints, perOrderCeiling)
  }

  maxPoints = snapToStep(maxPoints, settings.redeemStep)

  if (maxPoints < minPoints) {
    // The cap leaves less headroom than the minimum redemption, so there is nothing to offer.
    return { ...empty, blockedReason: "cap_below_minimum" }
  }

  const requested = Math.max(0, Math.floor(toNumber(requestedPoints, 0)))
  let appliedPoints = snapToStep(Math.min(requested, maxPoints), settings.redeemStep)
  if (appliedPoints > 0 && appliedPoints < minPoints) {
    appliedPoints = 0
  }

  return {
    maxPoints,
    maxDiscountAed: pointsToAed(maxPoints, settings),
    appliedPoints,
    discountAed: pointsToAed(appliedPoints, settings),
    blockedReason: null,
  }
}

// ---------------------------------------------------------------------------
// Ledger operations
// ---------------------------------------------------------------------------

const rateSnapshotOf = (settings) => ({
  earnPointsPerAed: toNumber(settings?.earnPointsPerAed, null),
  redeemPointsPerAed: toNumber(settings?.redeemPointsPerAed, null),
})

// Thrown when a ledger row already exists for this (order, type). The unique index makes
// every payout idempotent; this turns the driver error into something callers can read.
const isDuplicateKeyError = (error) => error?.code === 11000

/**
 * Debit points for an order. Atomic: the conditional $inc both checks the balance and
 * spends it, so two simultaneous checkouts cannot spend the same points twice.
 * Returns null when the customer does not have the points.
 */
export async function redeemPointsForOrder({ userId, points, order, settings, description }) {
  const amount = Math.max(0, Math.floor(toNumber(points, 0)))
  if (!userId || amount <= 0) return null

  const updatedUser = await User.findOneAndUpdate(
    { _id: userId, loyaltyPoints: { $gte: amount } },
    { $inc: { loyaltyPoints: -amount } },
    { new: true, projection: { loyaltyPoints: 1 } },
  )

  if (!updatedUser) return null

  try {
    return await LoyaltyTransaction.create({
      user: userId,
      order: order?._id || null,
      type: "redeem",
      status: "confirmed",
      points: -amount,
      balanceAfter: updatedUser.loyaltyPoints,
      amountAed: pointsToAed(amount, settings),
      rateSnapshot: rateSnapshotOf(settings),
      description: description || "Redeemed at checkout",
    })
  } catch (error) {
    // The ledger row is the audit trail; if it cannot be written, put the points back
    // rather than leaving the customer short with no record of why.
    await User.updateOne({ _id: userId }, { $inc: { loyaltyPoints: amount } })
    throw error
  }
}

/**
 * Record the points an order will pay out, held pending until the order reaches the award
 * status. Safe to call twice: the unique (order, type) index makes the second call a no-op.
 */
export async function recordPendingEarn({ userId, points, order, settings, description }) {
  const amount = Math.max(0, Math.floor(toNumber(points, 0)))
  if (!userId || amount <= 0) return null

  const expiryDays = Math.max(0, toNumber(settings?.pointsExpiryDays, 0))

  try {
    return await LoyaltyTransaction.create({
      user: userId,
      order: order?._id || null,
      type: "earn",
      status: "pending",
      points: amount,
      balanceAfter: null,
      amountAed: 0,
      rateSnapshot: rateSnapshotOf(settings),
      description: description || "Earned on order",
      expiresAt: expiryDays > 0 ? new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000) : null,
    })
  } catch (error) {
    if (isDuplicateKeyError(error)) return null
    throw error
  }
}

/**
 * Make an order's pending points spendable. Claims the order with a conditional update
 * first, so a retried or concurrent status change cannot credit the same points twice.
 */
export async function awardOrderPoints(orderId) {
  // A reversed order never pays out, even if it is later moved back to the award status.
  // Its redemption has already been refunded, so awarding as well would hand the customer
  // both the discount and the points. An admin who genuinely un-cancels an order can
  // credit the points by hand.
  const claimed = await Order.findOneAndUpdate(
    { _id: orderId, loyaltyPointsAwarded: { $ne: true }, loyaltyReversed: { $ne: true } },
    { $set: { loyaltyPointsAwarded: true, loyaltyPointsAwardedAt: new Date() } },
    { new: true, projection: { user: 1, loyaltyPointsEarned: 1 } },
  )

  // Already awarded, reversed, or the order is gone.
  if (!claimed) return { awarded: false, points: 0 }

  const points = Math.max(0, Math.floor(toNumber(claimed.loyaltyPointsEarned, 0)))
  if (!claimed.user || points <= 0) {
    return { awarded: false, points: 0 }
  }

  const updatedUser = await User.findByIdAndUpdate(
    claimed.user,
    { $inc: { loyaltyPoints: points, loyaltyLifetimePoints: points } },
    { new: true, projection: { loyaltyPoints: 1 } },
  )

  await LoyaltyTransaction.updateOne(
    { order: claimed._id, type: "earn" },
    {
      $set: {
        status: "confirmed",
        balanceAfter: updatedUser?.loyaltyPoints ?? null,
      },
    },
  )

  return { awarded: true, points, balance: updatedUser?.loyaltyPoints ?? null }
}

/**
 * Unwind an order's loyalty when it is cancelled or returned: refund whatever was spent,
 * and take back what it earned (cancelling it if still pending, debiting it if already
 * paid out).
 *
 * The whole reversal is claimed on the order first. Without that, a second cancelling
 * status change would debit the customer's earned points a second time -- the balance
 * moves before the ledger insert, so the unique index alone catches it too late.
 */
export async function reverseOrderLoyalty(orderId, { reason = "Order cancelled" } = {}) {
  const claimed = await Order.findOneAndUpdate(
    { _id: orderId, loyaltyReversed: { $ne: true } },
    { $set: { loyaltyReversed: true, loyaltyReversedAt: new Date() } },
    {
      new: true,
      projection: { user: 1, loyaltyPointsRedeemed: 1, loyaltyPointsEarned: 1, loyaltyPointsAwarded: 1 },
    },
  )

  // Already reversed, or the order is gone.
  if (!claimed) return { refunded: 0, clawedBack: 0, alreadyReversed: true }
  if (!claimed.user) return { refunded: 0, clawedBack: 0 }

  const settings = await getLoyaltySettings()
  let refunded = 0
  let clawedBack = 0

  // 1. Give back the points the customer spent on this order.
  const spent = Math.max(0, Math.floor(toNumber(claimed.loyaltyPointsRedeemed, 0)))
  if (spent > 0) {
    const updatedUser = await User.findByIdAndUpdate(
      claimed.user,
      { $inc: { loyaltyPoints: spent } },
      { new: true, projection: { loyaltyPoints: 1 } },
    )
    try {
      await LoyaltyTransaction.create({
        user: claimed.user,
        order: claimed._id,
        type: "refund",
        status: "confirmed",
        points: spent,
        balanceAfter: updatedUser?.loyaltyPoints ?? null,
        amountAed: pointsToAed(spent, settings),
        rateSnapshot: rateSnapshotOf(settings),
        description: reason,
      })
      refunded = spent
    } catch (error) {
      // Never leave the balance changed without a ledger row explaining it.
      await User.updateOne({ _id: claimed.user }, { $inc: { loyaltyPoints: -spent } })
      throw error
    }
  }

  // 2. Take back what the order earned.
  const earned = Math.max(0, Math.floor(toNumber(claimed.loyaltyPointsEarned, 0)))
  if (earned > 0) {
    if (claimed.loyaltyPointsAwarded) {
      // Already spendable, so debit it -- but never below zero if the customer has since
      // spent it elsewhere. They keep the difference; clawing into unrelated points would
      // be worse than absorbing it.
      const user = await User.findById(claimed.user).select("loyaltyPoints").lean()
      const debit = Math.min(earned, Math.max(0, toNumber(user?.loyaltyPoints, 0)))

      if (debit > 0) {
        const updatedUser = await User.findByIdAndUpdate(
          claimed.user,
          { $inc: { loyaltyPoints: -debit } },
          { new: true, projection: { loyaltyPoints: 1 } },
        )
        try {
          await LoyaltyTransaction.create({
            user: claimed.user,
            order: claimed._id,
            type: "reverse",
            status: "confirmed",
            points: -debit,
            balanceAfter: updatedUser?.loyaltyPoints ?? null,
            amountAed: 0,
            rateSnapshot: rateSnapshotOf(settings),
            description: `${reason} - earned points reversed`,
          })
          clawedBack = debit
        } catch (error) {
          await User.updateOne({ _id: claimed.user }, { $inc: { loyaltyPoints: debit } })
          throw error
        }
      }
    } else {
      // Still pending, so it never touched the balance.
      await LoyaltyTransaction.updateOne(
        { order: claimed._id, type: "earn", status: "pending" },
        { $set: { status: "cancelled", description: `${reason} - award cancelled` } },
      )
    }
  }

  return { refunded, clawedBack }
}

/**
 * Apply the loyalty consequences of an order reaching `newStatus`: pay out on the award
 * status, unwind on a cancelling status, do nothing otherwise.
 *
 * Called from every route that changes an order's status. Both underlying operations are
 * idempotent, so a repeated or concurrent status change cannot double-credit. Never
 * throws: a points problem must not block an operational status change.
 */
export async function syncOrderLoyaltyForStatus(orderId, newStatus) {
  try {
    const settings = await getLoyaltySettings()
    const awardStatus = settings.awardOnOrderStatus || "Delivered"
    const cancelStatuses = Array.isArray(settings.cancelOnOrderStatuses) ? settings.cancelOnOrderStatuses : []

    if (newStatus === awardStatus) {
      const result = await awardOrderPoints(orderId)
      if (result.awarded) {
        console.log(`[LOYALTY] Awarded ${result.points} points for order ${orderId} (balance ${result.balance})`)
      }
      return result
    }

    if (cancelStatuses.includes(newStatus)) {
      const result = await reverseOrderLoyalty(orderId, { reason: `Order ${String(newStatus).toLowerCase()}` })
      if (result.refunded || result.clawedBack) {
        console.log(
          `[LOYALTY] Order ${orderId} ${newStatus}: refunded ${result.refunded}, reversed ${result.clawedBack}`,
        )
      }
      return result
    }

    return null
  } catch (error) {
    console.error("Loyalty sync failed for order status change:", error)
    return null
  }
}

/**
 * Manual admin credit or debit. `points` is signed.
 */
export async function adjustUserPoints({ userId, points, note, adminId }) {
  const delta = Math.floor(toNumber(points, 0))
  if (!userId || delta === 0) return null

  const settings = await getLoyaltySettings()

  if (delta < 0) {
    // Conditional decrement: refuse rather than drive the balance negative.
    const updatedUser = await User.findOneAndUpdate(
      { _id: userId, loyaltyPoints: { $gte: Math.abs(delta) } },
      { $inc: { loyaltyPoints: delta } },
      { new: true, projection: { loyaltyPoints: 1 } },
    )
    if (!updatedUser) {
      const error = new Error("Customer does not have enough points for this deduction")
      error.statusCode = 400
      throw error
    }
    return LoyaltyTransaction.create({
      user: userId,
      type: "adjust",
      status: "confirmed",
      points: delta,
      balanceAfter: updatedUser.loyaltyPoints,
      rateSnapshot: rateSnapshotOf(settings),
      description: "Manual adjustment by admin",
      adminNote: note || "",
      createdBy: adminId || null,
    })
  }

  const updatedUser = await User.findByIdAndUpdate(
    userId,
    { $inc: { loyaltyPoints: delta, loyaltyLifetimePoints: delta } },
    { new: true, projection: { loyaltyPoints: 1 } },
  )
  if (!updatedUser) {
    const error = new Error("Customer not found")
    error.statusCode = 404
    throw error
  }

  return LoyaltyTransaction.create({
    user: userId,
    type: "adjust",
    status: "confirmed",
    points: delta,
    balanceAfter: updatedUser.loyaltyPoints,
    rateSnapshot: rateSnapshotOf(settings),
    description: "Manual adjustment by admin",
    adminNote: note || "",
    createdBy: adminId || null,
  })
}

/**
 * Points confirmed for this customer that they have not yet been told about, so the
 * storefront can congratulate them exactly once after an order is delivered.
 *
 * Only confirmed `earn` rows count: pending points are not theirs to spend yet, and a
 * refund or a manual adjustment is not an achievement to celebrate.
 */
export async function getUnannouncedEarnings(userId) {
  const settings = await getLoyaltySettings()
  if (!settings.isEnabled) return { hasNews: false }

  const rows = await LoyaltyTransaction.find({
    user: userId,
    type: "earn",
    status: "confirmed",
    announcedToUser: { $ne: true },
  })
    .select("points order description createdAt")
    .sort({ createdAt: -1 })
    .limit(20)
    .lean()

  if (rows.length === 0) return { hasNews: false }

  const points = rows.reduce((sum, row) => sum + Math.max(0, toNumber(row.points, 0)), 0)
  if (points <= 0) return { hasNews: false }

  const user = await User.findById(userId).select("loyaltyPoints").lean()
  const balance = Math.max(0, toNumber(user?.loyaltyPoints, 0))

  return {
    hasNews: true,
    points,
    orderCount: rows.length,
    // Ids are acknowledged back so a row confirmed between fetch and dismiss is not
    // silently marked as seen.
    transactionIds: rows.map((row) => String(row._id)),
    balance,
    balanceValueAed: pointsToAed(balance, settings),
    redeemPointsPerAed: toNumber(settings.redeemPointsPerAed, 0),
    minPointsToRedeem: toNumber(settings.minPointsToRedeem, 0),
    maxRedeemPercentOfOrder: toNumber(settings.maxRedeemPercentOfOrder, 0),
    pointsName: settings.pointsName,
    pointsNameAr: settings.pointsNameAr,
    pointsNameSingular: settings.pointsNameSingular,
    canRedeem: balance >= toNumber(settings.minPointsToRedeem, 0),
  }
}

/**
 * Mark award rows as announced. Scoped to the owning user so one customer can never
 * dismiss another's notification.
 */
export async function acknowledgeEarnings(userId, transactionIds) {
  const filter = {
    user: userId,
    type: "earn",
    status: "confirmed",
    announcedToUser: { $ne: true },
  }

  // Acknowledge only what was actually shown, when the client tells us.
  if (Array.isArray(transactionIds) && transactionIds.length > 0) {
    filter._id = { $in: transactionIds.filter((id) => mongoose.Types.ObjectId.isValid(id)) }
  }

  const result = await LoyaltyTransaction.updateMany(filter, { $set: { announcedToUser: true } })
  return { acknowledged: result.modifiedCount || 0 }
}

/**
 * Balance, pending total and AED value for one customer.
 */
export async function getUserLoyaltySummary(userId) {
  const settings = await getLoyaltySettings()

  const [user, pendingAgg] = await Promise.all([
    User.findById(userId).select("loyaltyPoints loyaltyLifetimePoints").lean(),
    LoyaltyTransaction.aggregate([
      { $match: { user: userId, type: "earn", status: "pending" } },
      { $group: { _id: null, points: { $sum: "$points" } } },
    ]),
  ])

  const balance = Math.max(0, toNumber(user?.loyaltyPoints, 0))
  const pending = Math.max(0, toNumber(pendingAgg?.[0]?.points, 0))

  return {
    balance,
    pending,
    lifetime: Math.max(0, toNumber(user?.loyaltyLifetimePoints, 0)),
    balanceValueAed: pointsToAed(balance, settings),
    canRedeem: settings.isEnabled && balance >= toNumber(settings.minPointsToRedeem, 0),
  }
}

/**
 * Expire confirmed points whose expiry date has passed. Not scheduled anywhere: call it
 * from the admin screen or a cron. A no-op while pointsExpiryDays is 0.
 */
export async function expireDuePoints({ limit = 500 } = {}) {
  const settings = await getLoyaltySettings()
  if (!settings.isEnabled || toNumber(settings.pointsExpiryDays, 0) <= 0) {
    return { expiredRows: 0, expiredPoints: 0 }
  }

  const due = await LoyaltyTransaction.find({
    type: "earn",
    status: "confirmed",
    expiresAt: { $ne: null, $lte: new Date() },
  })
    .limit(limit)
    .select("user points")
    .lean()

  let expiredPoints = 0

  for (const row of due) {
    const amount = Math.max(0, Math.floor(toNumber(row.points, 0)))
    if (amount <= 0) continue

    const user = await User.findById(row.user).select("loyaltyPoints")
    const debit = Math.min(amount, Math.max(0, toNumber(user?.loyaltyPoints, 0)))

    if (debit > 0) {
      const updatedUser = await User.findByIdAndUpdate(
        row.user,
        { $inc: { loyaltyPoints: -debit } },
        { new: true, projection: { loyaltyPoints: 1 } },
      )
      await LoyaltyTransaction.create({
        user: row.user,
        type: "expire",
        status: "confirmed",
        points: -debit,
        balanceAfter: updatedUser?.loyaltyPoints ?? null,
        description: "Points expired",
      })
      expiredPoints += debit
    }

    // Clear the expiry so the row is not processed again.
    await LoyaltyTransaction.updateOne({ _id: row._id }, { $set: { expiresAt: null } })
  }

  return { expiredRows: due.length, expiredPoints }
}

// What the storefront is allowed to know about the programme.
export function publicLoyaltySettings(settings) {
  if (!settings) return { isEnabled: false }
  return {
    isEnabled: Boolean(settings.isEnabled),
    pointsName: settings.pointsName,
    pointsNameAr: settings.pointsNameAr,
    pointsNameSingular: settings.pointsNameSingular,
    earnPointsPerAed: toNumber(settings.earnPointsPerAed, 0),
    redeemPointsPerAed: toNumber(settings.redeemPointsPerAed, 0),
    minPointsToRedeem: toNumber(settings.minPointsToRedeem, 0),
    maxRedeemPercentOfOrder: toNumber(settings.maxRedeemPercentOfOrder, 0),
    maxPointsPerOrder: toNumber(settings.maxPointsPerOrder, 0),
    redeemStep: toNumber(settings.redeemStep, 1),
    showOnProductPage: Boolean(settings.showOnProductPage),
    showOnCart: Boolean(settings.showOnCart),
    programmeTerms: settings.programmeTerms || "",
  }
}
