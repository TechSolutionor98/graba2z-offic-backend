import crypto from "crypto"
import mongoose from "mongoose"

import ReferralSettings from "../models/referralSettingsModel.js"
import Referral from "../models/referralModel.js"
import ReferralReward from "../models/referralRewardModel.js"
import User from "../models/userModel.js"
import Order from "../models/orderModel.js"
import { getSiteOrigin } from "./publicSiteUrl.js"

// The referral engine. Every amount in here is AED, the currency product prices are
// stored in, so one configuration serves every country the store sells in.
//
// Three rules hold this together:
//   1. A reward is spent with a conditional update that both checks it is still active
//      and marks it used, so two simultaneous checkouts cannot spend it twice.
//   2. A referral is qualified with a conditional update on its pending state, so a
//      retried or double-clicked status change cannot pay the referrer twice.
//   3. Rates are snapshotted onto the reward when it is minted. Changing the programme
//      never changes what a customer was already promised.

// ---------------------------------------------------------------------------
// Settings caching
// ---------------------------------------------------------------------------

// Settings are read on every checkout and every profile load, and change only when an
// admin saves. A short TTL keeps the storefront off the database without making an admin
// wait to see their own change.
const CACHE_TTL_MS = 60 * 1000

let settingsCache = { value: null, expiresAt: 0 }

export function invalidateReferralCache() {
  settingsCache = { value: null, expiresAt: 0 }
}

export async function getReferralSettings({ fresh = false } = {}) {
  const now = Date.now()
  if (!fresh && settingsCache.value && settingsCache.expiresAt > now) {
    return settingsCache.value
  }

  const doc = await ReferralSettings.getSingleton()
  const value = typeof doc.toObject === "function" ? doc.toObject() : doc
  settingsCache = { value, expiresAt: now + CACHE_TTL_MS }
  return value
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const toNumber = (value, fallback = 0) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

const round2 = (value) => Math.round((toNumber(value, 0) + Number.EPSILON) * 100) / 100

const isDuplicateKeyError = (error) => error?.code === 11000

// Ambiguous characters (0/O, 1/I) are left out so a code read aloud or copied by hand
// still works.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
const CODE_LENGTH = 8

const randomCode = () => {
  const bytes = crypto.randomBytes(CODE_LENGTH)
  let out = ""
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
  }
  return out
}

export const normalizeReferralCode = (value) =>
  String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")

/**
 * This customer's share code, generated on first use.
 *
 * Codes are assigned with a conditional update against the unique index rather than a
 * read-then-write, so two devices opening the referral panel at the same moment cannot
 * hand the same customer two codes or collide on one another's.
 */
export async function ensureReferralCode(userId) {
  const existing = await User.findById(userId).select("referralCode").lean()
  if (!existing) return null
  if (existing.referralCode) return existing.referralCode

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const code = randomCode()
    try {
      const updated = await User.findOneAndUpdate(
        { _id: userId, $or: [{ referralCode: null }, { referralCode: { $exists: false } }] },
        { $set: { referralCode: code } },
        { new: true, projection: { referralCode: 1 } },
      )
      // Another request assigned one first; whatever it chose is the answer.
      if (!updated) {
        const current = await User.findById(userId).select("referralCode").lean()
        return current?.referralCode || null
      }
      return updated.referralCode
    } catch (error) {
      // Code collided with another customer's. Try a different one.
      if (isDuplicateKeyError(error)) continue
      throw error
    }
  }

  throw new Error("Could not generate a referral code, please try again")
}

/**
 * Shareable link for a code. Built from the public storefront origin so a link created by
 * the API host, the mobile app or an integration is always openable.
 */
export function buildReferralLink(code, { country = "ae", lang = "en" } = {}) {
  const safeCode = normalizeReferralCode(code)
  if (!safeCode) return ""

  // The country arrives from a query string, so it is matched against the shape a country
  // prefix actually has rather than trimmed -- anything else would put caller-supplied
  // text straight into the path of a link the customer is about to share.
  const requested = String(country || "").toLowerCase()
  const countryPrefix = /^[a-z]{2}$/.test(requested) ? requested : "ae"
  const langPrefix = String(lang).toLowerCase() === "ar" ? "ar" : "en"

  return `${getSiteOrigin()}/${countryPrefix}-${langPrefix}/register?ref=${encodeURIComponent(safeCode)}`
}

/** The customer a code belongs to, or null. */
export async function resolveReferralCode(code) {
  const safeCode = normalizeReferralCode(code)
  if (!safeCode) return null
  return User.findOne({ referralCode: safeCode }).select("_id name email referralCode").lean()
}

// ---------------------------------------------------------------------------
// Minting rewards
// ---------------------------------------------------------------------------

const rewardTermsFor = (settings, role) =>
  role === "referee"
    ? {
        discountType: settings.refereeDiscountType || "percentage",
        discountValue: Math.max(0, toNumber(settings.refereeDiscountValue, 0)),
        maxDiscountAed: Math.max(0, toNumber(settings.refereeMaxDiscountAed, 0)),
        minOrderAed: Math.max(0, toNumber(settings.refereeMinOrderAed, 0)),
        expiryDays: Math.max(0, toNumber(settings.refereeExpiryDays, 0)),
        firstOrderOnly: Boolean(settings.refereeFirstOrderOnly),
      }
    : {
        discountType: settings.referrerDiscountType || "percentage",
        discountValue: Math.max(0, toNumber(settings.referrerDiscountValue, 0)),
        maxDiscountAed: Math.max(0, toNumber(settings.referrerMaxDiscountAed, 0)),
        minOrderAed: Math.max(0, toNumber(settings.referrerMinOrderAed, 0)),
        expiryDays: Math.max(0, toNumber(settings.referrerExpiryDays, 0)),
        firstOrderOnly: false,
      }

/**
 * Create one side's reward for a referral. Safe to call twice: the unique (referral,
 * role) index makes the second call a no-op that returns the existing reward.
 *
 * Returns null when the configured discount is zero -- an offer worth nothing is not
 * shown to the customer as if it were something.
 */
export async function mintReward({ referral, role, settings, description }) {
  const terms = rewardTermsFor(settings, role)
  if (terms.discountValue <= 0) return null

  const userId = role === "referee" ? referral.referee : referral.referrer

  try {
    return await ReferralReward.create({
      user: userId,
      referral: referral._id,
      role,
      discountType: terms.discountType,
      discountValue: terms.discountValue,
      maxDiscountAed: terms.maxDiscountAed,
      minOrderAed: terms.minOrderAed,
      firstOrderOnly: terms.firstOrderOnly,
      status: "active",
      expiresAt: terms.expiryDays > 0 ? new Date(Date.now() + terms.expiryDays * 24 * 60 * 60 * 1000) : null,
      description: description || (role === "referee" ? "Welcome discount" : "Referral thank-you discount"),
    })
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return ReferralReward.findOne({ referral: referral._id, role })
    }
    throw error
  }
}

// ---------------------------------------------------------------------------
// Signup
// ---------------------------------------------------------------------------

/**
 * Attach a newly registered customer to the person who invited them and give them their
 * welcome discount.
 *
 * Called from registration. Never throws: a referral problem must not stop somebody
 * creating an account. Returns a short result object for the caller to log or surface.
 */
export async function attachReferralOnSignup({ refereeUser, code, source = "web" }) {
  try {
    const safeCode = normalizeReferralCode(code)
    if (!safeCode) return { attached: false, reason: "no_code" }

    const settings = await getReferralSettings()
    if (!settings.isEnabled) return { attached: false, reason: "programme_disabled" }

    const referrer = await resolveReferralCode(safeCode)
    if (!referrer) return { attached: false, reason: "unknown_code" }

    // Self-referral is the obvious abuse; refuse it outright.
    if (String(referrer._id) === String(refereeUser._id)) {
      return { attached: false, reason: "self_referral" }
    }

    let referral
    try {
      referral = await Referral.create({
        referrer: referrer._id,
        referee: refereeUser._id,
        code: safeCode,
        status: "pending",
        source: source === "app" ? "app" : "web",
      })
    } catch (error) {
      // Already referred by someone. The first link wins.
      if (isDuplicateKeyError(error)) return { attached: false, reason: "already_referred" }
      throw error
    }

    await User.updateOne(
      { _id: refereeUser._id },
      { $set: { referredBy: referrer._id, referredAt: new Date() } },
    )

    // The friend's welcome discount is theirs from the moment they join -- it is what the
    // link promised. The referrer's is only earned once this account actually orders.
    const reward = await mintReward({
      referral,
      role: "referee",
      settings,
      description: `Welcome discount from ${referrer.name || "a friend"}`,
    })

    if (reward) {
      await Referral.updateOne({ _id: referral._id }, { $set: { refereeReward: reward._id } })
    }

    return {
      attached: true,
      referralId: referral._id,
      referrerId: referrer._id,
      rewardId: reward?._id || null,
    }
  } catch (error) {
    console.error("Failed to attach referral on signup:", error)
    return { attached: false, reason: "error" }
  }
}

// ---------------------------------------------------------------------------
// Spending a reward
// ---------------------------------------------------------------------------

/**
 * What a reward would take off an order of this size, and why it cannot be used if it
 * cannot. Pure -- the checkout screen and the order endpoint both call it, so the number
 * quoted is the number charged.
 */
export function computeRewardDiscount({ reward, eligibleAmountAed, isFirstOrder = true }) {
  const eligible = Math.max(0, toNumber(eligibleAmountAed, 0))

  const blocked = (reason) => ({ discountAed: 0, blockedReason: reason, eligibleAmountAed: eligible })

  if (!reward) return blocked("no_reward")
  if (reward.status !== "active") return blocked("not_active")
  if (reward.expiresAt && new Date(reward.expiresAt).getTime() <= Date.now()) return blocked("expired")
  if (reward.firstOrderOnly && !isFirstOrder) return blocked("first_order_only")
  if (eligible <= 0) return blocked("empty_cart")

  const minOrder = Math.max(0, toNumber(reward.minOrderAed, 0))
  if (minOrder > 0 && eligible < minOrder) return blocked("below_minimum")

  let discount
  if (reward.discountType === "fixed") {
    discount = Math.max(0, toNumber(reward.discountValue, 0))
  } else {
    discount = (eligible * Math.max(0, toNumber(reward.discountValue, 0))) / 100
    const cap = Math.max(0, toNumber(reward.maxDiscountAed, 0))
    if (cap > 0 && discount > cap) discount = cap
  }

  // A reward can never take off more than the order is worth.
  discount = Math.min(discount, eligible)

  if (discount <= 0) return blocked("no_value")

  return { discountAed: round2(discount), blockedReason: null, eligibleAmountAed: eligible }
}

/** Has this customer ever placed an order? Drives the first-order-only restriction. */
export async function hasPreviousOrder(userId, { excludeOrderId = null } = {}) {
  if (!userId) return false
  const query = {
    user: userId,
    documentType: { $ne: "quotation" },
    status: { $nin: ["Cancelled", "Deleted"] },
  }
  if (excludeOrderId) query._id = { $ne: excludeOrderId }
  const existing = await Order.exists(query)
  return Boolean(existing)
}

/** Every reward this customer can currently spend, newest first. */
export async function getSpendableRewards(userId) {
  if (!userId) return []
  const now = new Date()
  return ReferralReward.find({
    user: userId,
    status: "active",
    $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
  })
    .sort({ createdAt: -1 })
    .lean()
}

/**
 * Spend a reward on an order. The conditional update both checks the reward is still
 * active and marks it used, so two simultaneous checkouts cannot spend it twice.
 * Returns null when it was already gone.
 */
export async function claimRewardForOrder({ rewardId, userId, discountAed, orderId = null }) {
  if (!rewardId || !userId) return null

  const now = new Date()
  return ReferralReward.findOneAndUpdate(
    {
      _id: rewardId,
      user: userId,
      status: "active",
      $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
    },
    {
      $set: {
        status: "used",
        order: orderId,
        usedAt: now,
        discountAppliedAed: round2(discountAed),
      },
    },
    { new: true },
  )
}

/** Put a claimed reward back, used when the order it was claimed for could not be saved. */
export async function releaseClaimedReward(rewardId) {
  if (!rewardId) return null
  return ReferralReward.findOneAndUpdate(
    { _id: rewardId, status: "used" },
    { $set: { status: "active", order: null, usedAt: null, discountAppliedAed: 0 } },
    { new: true },
  )
}

// ---------------------------------------------------------------------------
// Qualification
// ---------------------------------------------------------------------------

/**
 * Whether this referrer has already had as many rewards as the programme allows.
 * A limit of 0 means unlimited.
 */
async function referrerLimitReached(referrerId, settings) {
  const limit = Math.max(0, toNumber(settings.maxQualifiedReferralsPerUser, 0))
  if (limit <= 0) return false
  const qualified = await Referral.countDocuments({ referrer: referrerId, status: "qualified" })
  return qualified >= limit
}

/**
 * Pay the referrer for an order the invited friend has had delivered.
 *
 * The referral is claimed with a conditional update on its pending state before anything
 * is minted, so a retried webhook or a double-clicked status change cannot pay twice.
 */
export async function qualifyReferralForOrder(orderId) {
  const order = await Order.findById(orderId).select("user totalPrice documentType").lean()
  if (!order?.user) return { qualified: false, reason: "no_customer" }
  if (order.documentType === "quotation") return { qualified: false, reason: "quotation" }

  const settings = await getReferralSettings()
  if (!settings.isEnabled) return { qualified: false, reason: "programme_disabled" }

  const pending = await Referral.findOne({ referee: order.user, status: "pending" })
  if (!pending) return { qualified: false, reason: "no_pending_referral" }

  const orderTotal = Math.max(0, toNumber(order.totalPrice, 0))
  const minOrder = Math.max(0, toNumber(settings.qualifyMinOrderAed, 0))
  if (minOrder > 0 && orderTotal < minOrder) {
    // Left pending on purpose: a later, larger delivered order can still qualify it.
    return { qualified: false, reason: "below_minimum" }
  }

  if (settings.requireEmailVerified) {
    const referee = await User.findById(order.user).select("isEmailVerified").lean()
    if (!referee?.isEmailVerified) return { qualified: false, reason: "email_unverified" }
  }

  // Claim it. Whoever wins this update is the one that mints the reward.
  const claimed = await Referral.findOneAndUpdate(
    { _id: pending._id, status: "pending" },
    {
      $set: {
        status: "qualified",
        qualifyingOrder: order._id,
        qualifyingOrderTotalAed: orderTotal,
        qualifiedAt: new Date(),
      },
    },
    { new: true },
  )
  if (!claimed) return { qualified: false, reason: "already_claimed" }

  // The referral counts either way -- the referrer can see it on their list -- but past
  // the configured limit it stops paying out, and the reason is recorded so support can
  // explain it.
  if (await referrerLimitReached(claimed.referrer, settings)) {
    await Referral.updateOne({ _id: claimed._id }, { $set: { notRewardedReason: "limit_reached" } })
    return { qualified: true, rewarded: false, reason: "limit_reached", referralId: claimed._id }
  }

  const reward = await mintReward({
    referral: claimed,
    role: "referrer",
    settings,
    description: "Thank you for referring a friend",
  })

  if (reward) {
    await Referral.updateOne(
      { _id: claimed._id },
      { $set: { referrerReward: reward._id, notRewardedReason: "" } },
    )
  } else {
    await Referral.updateOne({ _id: claimed._id }, { $set: { notRewardedReason: "no_reward_configured" } })
  }

  return {
    qualified: true,
    rewarded: Boolean(reward),
    referralId: claimed._id,
    rewardId: reward?._id || null,
  }
}

/**
 * Undo a qualification when the order that earned it is cancelled or returned.
 *
 * An unspent referrer reward is withdrawn and the referral goes back to pending, so a
 * later genuine order can still qualify it. A reward that has already been spent is left
 * alone -- clawing it back would mean re-charging a customer for an order they have
 * already completed -- and the referral is flagged instead.
 */
export async function unqualifyReferralForOrder(orderId) {
  const referral = await Referral.findOne({ qualifyingOrder: orderId, status: "qualified" })
  if (!referral) return { reversed: false, reason: "not_qualified_by_this_order" }

  if (referral.referrerReward) {
    const withdrawn = await ReferralReward.findOneAndUpdate(
      { _id: referral.referrerReward, status: "active" },
      { $set: { status: "cancelled", description: "Withdrawn - the referred order was cancelled" } },
      { new: true },
    )

    if (!withdrawn) {
      await Referral.updateOne({ _id: referral._id }, { $set: { rewardAlreadySpent: true } })
      return { reversed: false, reason: "reward_already_spent", referralId: referral._id }
    }
  }

  await Referral.updateOne(
    { _id: referral._id },
    {
      $set: {
        status: "pending",
        qualifyingOrder: null,
        qualifyingOrderTotalAed: 0,
        qualifiedAt: null,
        referrerReward: null,
        notRewardedReason: "",
      },
    },
  )

  return { reversed: true, referralId: referral._id }
}

/**
 * Hand back a reward the cancelled order had spent, so the customer is not left out of
 * pocket for an order that no longer exists. Claimed on the order with a conditional
 * update so a repeated cancelling status cannot return it twice.
 */
export async function returnRewardFromCancelledOrder(orderId) {
  const claimed = await Order.findOneAndUpdate(
    { _id: orderId, referralRewardId: { $ne: null }, referralRewardReturned: { $ne: true } },
    { $set: { referralRewardReturned: true } },
    { new: true },
  )
  if (!claimed) return { returned: false }

  const restored = await ReferralReward.findOneAndUpdate(
    { _id: claimed.referralRewardId, order: claimed._id, status: "used" },
    { $set: { status: "active", order: null, usedAt: null, discountAppliedAed: 0 } },
    { new: true },
  )

  return { returned: Boolean(restored), rewardId: claimed.referralRewardId }
}

/**
 * Apply the referral consequences of an order reaching `newStatus`: qualify on the
 * configured status, unwind on a cancelling one, do nothing otherwise.
 *
 * Called from every route that changes an order's status. Every underlying operation is
 * idempotent, so a repeated or concurrent status change cannot double-reward. Never
 * throws: a referral problem must not block an operational status change.
 */
export async function syncOrderReferralForStatus(orderId, newStatus) {
  try {
    const settings = await getReferralSettings()
    if (!settings.isEnabled) return null

    const qualifyStatus = settings.qualifyOnOrderStatus || "Delivered"
    const cancelStatuses = Array.isArray(settings.cancelOnOrderStatuses) ? settings.cancelOnOrderStatuses : []

    if (newStatus === qualifyStatus) {
      const result = await qualifyReferralForOrder(orderId)
      if (result.qualified) {
        console.log(`[REFERRAL] Order ${orderId} qualified referral ${result.referralId} (rewarded: ${result.rewarded})`)
      }
      return result
    }

    if (cancelStatuses.includes(newStatus)) {
      const [reversal, returned] = await Promise.all([
        unqualifyReferralForOrder(orderId),
        returnRewardFromCancelledOrder(orderId),
      ])
      if (reversal.reversed || returned.returned) {
        console.log(
          `[REFERRAL] Order ${orderId} ${newStatus}: qualification reversed ${reversal.reversed}, reward returned ${returned.returned}`,
        )
      }
      return { ...reversal, ...returned }
    }

    return null
  } catch (error) {
    console.error("Referral sync failed for order status change:", error)
    return null
  }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * Everything the customer's referral panel needs: their link, how their invites are
 * doing, and what they have earned.
 */
export async function getReferralSummary(userId, { country = "ae", lang = "en" } = {}) {
  const code = await ensureReferralCode(userId)

  const [referrals, rewards, counts] = await Promise.all([
    Referral.find({ referrer: userId })
      .populate("referee", "name email createdAt")
      .sort({ createdAt: -1 })
      .limit(200)
      .lean(),
    ReferralReward.find({ user: userId }).sort({ createdAt: -1 }).limit(100).lean(),
    Referral.aggregate([
      { $match: { referrer: new mongoose.Types.ObjectId(String(userId)) } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
  ])

  const byStatus = counts.reduce((acc, row) => ({ ...acc, [row._id]: row.count }), {})

  // The invitee's identity is only ever shown to the person who invited them, and only
  // as a first name and a masked address -- enough to recognise who it is without
  // handing out a contact list.
  const invites = referrals.map((referral) => ({
    id: String(referral._id),
    name: maskName(referral.referee?.name),
    email: maskEmail(referral.referee?.email),
    status: referral.status,
    joinedAt: referral.referee?.createdAt || referral.createdAt,
    qualifiedAt: referral.qualifiedAt,
    rewarded: Boolean(referral.referrerReward),
    notRewardedReason: referral.notRewardedReason || "",
  }))

  const totalEarnedAed = rewards
    .filter((reward) => reward.role === "referrer" && reward.status === "used")
    .reduce((sum, reward) => sum + toNumber(reward.discountAppliedAed, 0), 0)

  return {
    code,
    link: buildReferralLink(code, { country, lang }),
    invites,
    rewards: rewards.map(publicReward),
    stats: {
      total: referrals.length,
      pending: byStatus.pending || 0,
      qualified: byStatus.qualified || 0,
      cancelled: byStatus.cancelled || 0,
      activeRewards: rewards.filter((reward) => reward.status === "active").length,
      totalEarnedAed: round2(totalEarnedAed),
    },
  }
}

// "Muhammad Fahad" -> "Muhammad F."
const maskName = (name) => {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "A friend"
  if (parts.length === 1) return parts[0]
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`
}

// "friend@example.com" -> "fr•••@example.com"
const maskEmail = (email) => {
  const raw = String(email || "").trim()
  const at = raw.indexOf("@")
  if (at < 1) return ""
  const local = raw.slice(0, at)
  const domain = raw.slice(at)
  const head = local.slice(0, Math.min(2, local.length))
  return `${head}•••${domain}`
}

/** The shape of a reward the storefront is allowed to see. */
export const publicReward = (reward) => ({
  id: String(reward._id),
  role: reward.role,
  discountType: reward.discountType,
  discountValue: reward.discountValue,
  maxDiscountAed: reward.maxDiscountAed,
  minOrderAed: reward.minOrderAed,
  firstOrderOnly: reward.firstOrderOnly,
  status: reward.status,
  expiresAt: reward.expiresAt,
  usedAt: reward.usedAt,
  discountAppliedAed: reward.discountAppliedAed,
  description: reward.description,
  createdAt: reward.createdAt,
})

/** The subset of the configuration the storefront is allowed to see. */
export function publicReferralSettings(settings) {
  return {
    isEnabled: Boolean(settings.isEnabled),
    programmeName: settings.programmeName,
    programmeNameAr: settings.programmeNameAr,
    refereeDiscountType: settings.refereeDiscountType,
    refereeDiscountValue: settings.refereeDiscountValue,
    refereeMaxDiscountAed: settings.refereeMaxDiscountAed,
    refereeMinOrderAed: settings.refereeMinOrderAed,
    refereeFirstOrderOnly: settings.refereeFirstOrderOnly,
    referrerDiscountType: settings.referrerDiscountType,
    referrerDiscountValue: settings.referrerDiscountValue,
    referrerMaxDiscountAed: settings.referrerMaxDiscountAed,
    referrerMinOrderAed: settings.referrerMinOrderAed,
    qualifyOnOrderStatus: settings.qualifyOnOrderStatus,
    qualifyMinOrderAed: settings.qualifyMinOrderAed,
    showInProfile: settings.showInProfile,
    shareMessage: settings.shareMessage,
    programmeTerms: settings.programmeTerms,
  }
}

/**
 * Retire rewards that have aged out. Called from the admin screen and safe to run on a
 * schedule; it only ever touches rewards that are past their date and still unspent.
 */
export async function expireDueRewards({ limit = 500 } = {}) {
  const due = await ReferralReward.find({
    status: "active",
    expiresAt: { $ne: null, $lte: new Date() },
  })
    .limit(limit)
    .select("_id")
    .lean()

  if (due.length === 0) return { expired: 0 }

  const result = await ReferralReward.updateMany(
    { _id: { $in: due.map((reward) => reward._id) }, status: "active" },
    { $set: { status: "expired" } },
  )

  return { expired: result.modifiedCount || 0 }
}
