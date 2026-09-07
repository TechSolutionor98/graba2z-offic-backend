import express from "express"
import asyncHandler from "express-async-handler"
import mongoose from "mongoose"

import ReferralSettings from "../models/referralSettingsModel.js"
import Referral from "../models/referralModel.js"
import ReferralReward from "../models/referralRewardModel.js"
import User from "../models/userModel.js"
import { protect, admin } from "../middleware/authMiddleware.js"
import { checkPermission, logActivity } from "../middleware/permissionMiddleware.js"
import {
  getReferralSettings,
  invalidateReferralCache,
  publicReferralSettings,
  publicReward,
  getReferralSummary,
  getSpendableRewards,
  computeRewardDiscount,
  hasPreviousOrder,
  resolveReferralCode,
  normalizeReferralCode,
  expireDueRewards,
} from "../utils/referral.js"

const router = express.Router()

const toNumber = (value, fallback = 0) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

// ===========================================================================
// Storefront
// ===========================================================================

// @desc    Programme configuration, so the storefront knows whether to show the
//          programme at all and what to promise a visitor arriving on a referral link.
// @route   GET /api/referrals/settings
// @access  Public
router.get(
  "/settings",
  asyncHandler(async (req, res) => {
    const settings = await getReferralSettings()

    if (!settings.isEnabled) {
      // Nothing else is any of the storefront's business while the programme is off.
      return res.json({ settings: { isEnabled: false } })
    }

    res.json({ settings: publicReferralSettings(settings) })
  }),
)

// @desc    Check a referral code before someone registers with it, so the signup form can
//          say "You have been invited by X" rather than silently swallowing a typo.
//          Deliberately returns 200 with valid:false -- an invalid code is an answer, not
//          an error, and a 404 here would be noisier than it is useful.
// @route   GET /api/referrals/validate/:code
// @access  Public
router.get(
  "/validate/:code",
  asyncHandler(async (req, res) => {
    const settings = await getReferralSettings()
    if (!settings.isEnabled) {
      return res.json({ valid: false, reason: "programme_disabled" })
    }

    const code = normalizeReferralCode(req.params.code)
    if (!code) return res.json({ valid: false, reason: "empty" })

    const referrer = await resolveReferralCode(code)
    if (!referrer) return res.json({ valid: false, reason: "unknown_code" })

    // Only the inviter's first name goes back -- enough to reassure the visitor the link
    // is genuine, without turning the code into a way to look up an email address.
    const firstName = String(referrer.name || "").trim().split(/\s+/)[0] || "a friend"

    res.json({
      valid: true,
      code,
      referrerName: firstName,
      reward: {
        discountType: settings.refereeDiscountType,
        discountValue: settings.refereeDiscountValue,
        maxDiscountAed: settings.refereeMaxDiscountAed,
        minOrderAed: settings.refereeMinOrderAed,
      },
    })
  }),
)

// @desc    The signed-in customer's link, their invites and their rewards
// @route   GET /api/referrals/me
// @access  Private
router.get(
  "/me",
  protect,
  asyncHandler(async (req, res) => {
    const settings = await getReferralSettings()

    if (!settings.isEnabled) {
      return res.json({ settings: { isEnabled: false }, code: null, link: "", invites: [], rewards: [], stats: null })
    }

    const summary = await getReferralSummary(req.user._id, {
      country: req.query.country || "ae",
      lang: req.query.lang || "en",
    })

    res.json({ ...summary, settings: publicReferralSettings(settings) })
  }),
)

// @desc    What this customer can spend on an order of this size right now. The authority
//          is still the order endpoint, which recalculates from verified prices -- this is
//          the quote the checkout screen renders.
// @route   POST /api/referrals/quote
// @access  Private
router.post(
  "/quote",
  protect,
  asyncHandler(async (req, res) => {
    const settings = await getReferralSettings()
    if (!settings.isEnabled) {
      return res.json({ rewards: [], best: null })
    }

    const eligibleAmountAed = Math.max(0, toNumber(req.body.eligibleAmount, 0))
    const rewards = await getSpendableRewards(req.user._id)

    // Only worth asking the orders collection once, however many rewards there are.
    const needsFirstOrderCheck = rewards.some((reward) => reward.firstOrderOnly)
    const isFirstOrder = needsFirstOrderCheck ? !(await hasPreviousOrder(req.user._id)) : true

    const quoted = rewards.map((reward) => {
      const quote = computeRewardDiscount({ reward, eligibleAmountAed, isFirstOrder })
      return { ...publicReward(reward), ...quote, applicable: quote.discountAed > 0 }
    })

    // The customer is offered the reward worth the most on this basket. They can still
    // pick another from the list; this is only the default.
    const best = quoted
      .filter((reward) => reward.applicable)
      .sort((a, b) => b.discountAed - a.discountAed)[0] || null

    res.json({ rewards: quoted, best, isFirstOrder })
  }),
)

// ===========================================================================
// Admin
// ===========================================================================

const adminGuard = [protect, admin, checkPermission("referrals")]

// @desc    Full programme configuration
// @route   GET /api/referrals/admin/settings
// @access  Private/Admin
router.get(
  "/admin/settings",
  ...adminGuard,
  asyncHandler(async (req, res) => {
    const settings = await ReferralSettings.getSingleton()
    res.json(settings)
  }),
)

// The fields an admin is allowed to write. Anything else in the body is ignored rather
// than trusted, so a stray client field can never reach the document.
const EDITABLE_SETTINGS = [
  "isEnabled",
  "programmeName",
  "programmeNameAr",
  "refereeDiscountType",
  "refereeDiscountValue",
  "refereeMaxDiscountAed",
  "refereeMinOrderAed",
  "refereeExpiryDays",
  "refereeFirstOrderOnly",
  "referrerDiscountType",
  "referrerDiscountValue",
  "referrerMaxDiscountAed",
  "referrerMinOrderAed",
  "referrerExpiryDays",
  "qualifyOnOrderStatus",
  "cancelOnOrderStatuses",
  "qualifyMinOrderAed",
  "maxQualifiedReferralsPerUser",
  "requireEmailVerified",
  "showInProfile",
  "shareMessage",
  "programmeTerms",
]

const PERCENT_FIELDS = new Set(["refereeDiscountValue", "referrerDiscountValue"])

// @desc    Save the programme configuration
// @route   PUT /api/referrals/admin/settings
// @access  Private/Admin
router.put(
  "/admin/settings",
  ...adminGuard,
  asyncHandler(async (req, res) => {
    const settings = await ReferralSettings.getSingleton()

    for (const field of EDITABLE_SETTINGS) {
      if (req.body[field] === undefined) continue
      settings[field] = req.body[field]
    }

    // A percentage above 100 would hand the order away for free and then some, so it is
    // refused rather than clamped -- an admin who typed 200 meant something, and quietly
    // storing 100 would hide the mistake.
    for (const field of PERCENT_FIELDS) {
      const typeField = field.replace("DiscountValue", "DiscountType")
      if (settings[typeField] === "percentage" && toNumber(settings[field], 0) > 100) {
        res.status(400)
        throw new Error(`${field} cannot be more than 100% - check the discount value`)
      }
    }

    settings.updatedBy = req.user._id
    const saved = await settings.save()
    invalidateReferralCache()

    await logActivity({
      user: req.user,
      action: "UPDATE",
      module: "REFERRALS",
      description: `Updated referral programme settings (enabled: ${saved.isEnabled})`,
      targetId: String(saved._id),
      targetName: "Referral settings",
      req,
    })

    res.json(saved)
  }),
)

// @desc    Every referral, filterable, for the admin list
// @route   GET /api/referrals/admin/list
// @access  Private/Admin
router.get(
  "/admin/list",
  ...adminGuard,
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1)
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25))

    const query = {}
    if (["pending", "qualified", "cancelled"].includes(req.query.status)) {
      query.status = req.query.status
    }

    // Free-text search runs over the customers, not the referrals, because a referral row
    // holds ids and a code -- never a name anyone would type.
    const search = String(req.query.search || "").trim()
    if (search) {
      const pattern = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
      const matchingUsers = await User.find({ $or: [{ name: pattern }, { email: pattern }] })
        .select("_id")
        .limit(500)
        .lean()
      const ids = matchingUsers.map((user) => user._id)
      query.$or = [{ referrer: { $in: ids } }, { referee: { $in: ids } }, { code: pattern }]
    }

    const [referrals, totalCount] = await Promise.all([
      Referral.find(query)
        .populate("referrer", "name email referralCode")
        .populate("referee", "name email isEmailVerified createdAt")
        .populate("referrerReward", "status discountType discountValue discountAppliedAed")
        .populate("refereeReward", "status discountType discountValue discountAppliedAed")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Referral.countDocuments(query),
    ])

    res.json({
      referrals,
      page,
      limit,
      totalCount,
      hasMore: page * limit < totalCount,
    })
  }),
)

// @desc    Programme headline numbers
// @route   GET /api/referrals/admin/stats
// @access  Private/Admin
router.get(
  "/admin/stats",
  ...adminGuard,
  asyncHandler(async (req, res) => {
    const [statusCounts, rewardCounts, spend] = await Promise.all([
      Referral.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      ReferralReward.aggregate([{ $group: { _id: { status: "$status", role: "$role" }, count: { $sum: 1 } } }]),
      ReferralReward.aggregate([
        { $match: { status: "used" } },
        { $group: { _id: "$role", totalAed: { $sum: "$discountAppliedAed" }, count: { $sum: 1 } } },
      ]),
    ])

    const byStatus = statusCounts.reduce((acc, row) => ({ ...acc, [row._id]: row.count }), {})
    const bySpend = spend.reduce((acc, row) => ({ ...acc, [row._id]: { totalAed: row.totalAed, count: row.count } }), {})

    res.json({
      referrals: {
        total: Object.values(byStatus).reduce((sum, count) => sum + count, 0),
        pending: byStatus.pending || 0,
        qualified: byStatus.qualified || 0,
        cancelled: byStatus.cancelled || 0,
      },
      rewards: rewardCounts.map((row) => ({ status: row._id.status, role: row._id.role, count: row.count })),
      discountGiven: {
        refereeAed: bySpend.referee?.totalAed || 0,
        referrerAed: bySpend.referrer?.totalAed || 0,
        totalAed: (bySpend.referee?.totalAed || 0) + (bySpend.referrer?.totalAed || 0),
      },
      // The people who actually bring customers in, so the team can see who to look after.
      topReferrers: await Referral.aggregate([
        { $match: { status: "qualified" } },
        { $group: { _id: "$referrer", qualified: { $sum: 1 } } },
        { $sort: { qualified: -1 } },
        { $limit: 10 },
        {
          $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "user" },
        },
        { $unwind: "$user" },
        { $project: { _id: 1, qualified: 1, name: "$user.name", email: "$user.email", code: "$user.referralCode" } },
      ]),
    })
  }),
)

// @desc    Withdraw an unspent reward, for the cases the automatic rules cannot see --
//          fraud, a duplicate account, a goodwill decision reversed.
// @route   POST /api/referrals/admin/rewards/:id/cancel
// @access  Private/Admin
router.post(
  "/admin/rewards/:id/cancel",
  ...adminGuard,
  asyncHandler(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      res.status(400)
      throw new Error("Invalid reward id")
    }

    const reason = String(req.body.reason || "").trim()
    if (!reason) {
      // The customer will ask why their discount vanished; there has to be an answer on
      // the record before it does.
      res.status(400)
      throw new Error("A reason is required to cancel a reward")
    }

    const reward = await ReferralReward.findOneAndUpdate(
      { _id: req.params.id, status: "active" },
      { $set: { status: "cancelled", description: `Cancelled by admin - ${reason}` } },
      { new: true },
    )

    if (!reward) {
      res.status(400)
      throw new Error("That reward is not active - it may already be spent, expired or cancelled")
    }

    await logActivity({
      user: req.user,
      action: "UPDATE",
      module: "REFERRALS",
      description: `Cancelled referral reward ${reward._id}: ${reason}`,
      targetId: String(reward._id),
      targetName: "Referral reward",
      req,
    })

    res.json(reward)
  }),
)

// @desc    Retire rewards that have aged out
// @route   POST /api/referrals/admin/expire
// @access  Private/Admin
router.post(
  "/admin/expire",
  ...adminGuard,
  asyncHandler(async (req, res) => {
    const result = await expireDueRewards({ limit: Number.parseInt(req.body.limit, 10) || 500 })
    res.json(result)
  }),
)

export default router
