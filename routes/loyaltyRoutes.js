import express from "express"
import asyncHandler from "express-async-handler"
import mongoose from "mongoose"

import LoyaltySettings from "../models/loyaltySettingsModel.js"
import LoyaltyRule from "../models/loyaltyRuleModel.js"
import LoyaltyTransaction from "../models/loyaltyTransactionModel.js"
import LoyaltyType from "../models/loyaltyTypeModel.js"
import User from "../models/userModel.js"
import Category from "../models/categoryModel.js"
import SubCategory from "../models/subCategoryModel.js"
import { protect, admin } from "../middleware/authMiddleware.js"
import { checkPermission, logActivity } from "../middleware/permissionMiddleware.js"
import {
  getLoyaltySettings,
  getCategoryRuleMap,
  invalidateLoyaltyCache,
  publicLoyaltySettings,
  computeRedemption,
  pointsToAed,
  adjustUserPoints,
  getUserLoyaltySummary,
  expireDuePoints,
  getUnannouncedEarnings,
  acknowledgeEarnings,
} from "../utils/loyalty.js"

const router = express.Router()

const isObjectId = (value) => typeof value === "string" && mongoose.Types.ObjectId.isValid(value)
const toNumber = (value, fallback = 0) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

// ===========================================================================
// Storefront
// ===========================================================================

// @desc    Programme configuration plus the active category rules, so the storefront can
//          work out a product's points without a round trip per product.
// @route   GET /api/loyalty/settings
// @access  Public
router.get(
  "/settings",
  asyncHandler(async (req, res) => {
    const settings = await getLoyaltySettings()

    if (!settings.isEnabled) {
      // Nothing else is any of the storefront's business while the programme is off.
      return res.json({ settings: { isEnabled: false }, rules: [] })
    }

    const ruleMap = await getCategoryRuleMap()
    const rules = Array.from(ruleMap.values()).map((rule) => ({
      scope: rule.scope,
      refId: String(rule.refId),
      mode: rule.mode,
      multiplier: rule.multiplier,
      fixedPoints: rule.fixedPoints,
    }))

    res.json({ settings: publicLoyaltySettings(settings), rules })
  }),
)

// @desc    Signed-in customer's balance, pending points and recent history
// @route   GET /api/loyalty/me
// @access  Private
router.get(
  "/me",
  protect,
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1)
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20))

    const [summary, transactions, totalCount] = await Promise.all([
      getUserLoyaltySummary(req.user._id),
      LoyaltyTransaction.find({ user: req.user._id, status: { $ne: "cancelled" } })
        .select("type status points amountAed description createdAt order expiresAt")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      LoyaltyTransaction.countDocuments({ user: req.user._id, status: { $ne: "cancelled" } }),
    ])

    const settings = await getLoyaltySettings()

    res.json({
      ...summary,
      settings: publicLoyaltySettings(settings),
      transactions,
      page,
      limit,
      totalCount,
      hasMore: page * limit < totalCount,
    })
  }),
)

// @desc    How many points this customer may put towards an order of this size, and what
//          a given number of points would take off. The authority is still the order
//          endpoint, which recalculates from verified prices -- this is the quote the
//          checkout screen renders.
// @route   POST /api/loyalty/quote
// @access  Private
router.post(
  "/quote",
  protect,
  asyncHandler(async (req, res) => {
    const settings = await getLoyaltySettings()
    const summary = await getUserLoyaltySummary(req.user._id)

    const quote = computeRedemption({
      eligibleAmountAed: toNumber(req.body.eligibleAmount, 0),
      availablePoints: summary.balance,
      requestedPoints: toNumber(req.body.requestedPoints, 0),
      settings,
    })

    res.json({
      ...quote,
      balance: summary.balance,
      pending: summary.pending,
      pointsName: settings.pointsName,
      redeemPointsPerAed: toNumber(settings.redeemPointsPerAed, 0),
      minPointsToRedeem: toNumber(settings.minPointsToRedeem, 0),
      redeemStep: toNumber(settings.redeemStep, 1),
    })
  }),
)

// @desc    Points confirmed since the customer last looked, so the storefront can
//          congratulate them once after an order is delivered.
// @route   GET /api/loyalty/announcements
// @access  Private
router.get(
  "/announcements",
  protect,
  asyncHandler(async (req, res) => {
    res.json(await getUnannouncedEarnings(req.user._id))
  }),
)

// @desc    Mark the award as seen so the dialog does not return on the next page load
// @route   POST /api/loyalty/announcements/ack
// @access  Private
router.post(
  "/announcements/ack",
  protect,
  asyncHandler(async (req, res) => {
    const ids = Array.isArray(req.body?.transactionIds) ? req.body.transactionIds : null
    res.json(await acknowledgeEarnings(req.user._id, ids))
  }),
)

// ===========================================================================
// Admin - programme configuration
// ===========================================================================

const adminGuard = [protect, admin, checkPermission("loyalty")]

// @desc    Full settings document
// @route   GET /api/loyalty/admin/settings
// @access  Private/Admin
router.get(
  "/admin/settings",
  ...adminGuard,
  asyncHandler(async (req, res) => {
    const settings = await LoyaltySettings.getSingleton()
    res.json(settings)
  }),
)

// Fields an admin may write. Anything else in the body is ignored rather than trusted.
const EDITABLE_SETTING_FIELDS = [
  "isEnabled",
  "pointsName",
  "pointsNameAr",
  "pointsNameSingular",
  "earnPointsPerAed",
  "earnRounding",
  "earnOnDiscountedPrice",
  "earnOnRedeemedPortion",
  "redeemPointsPerAed",
  "minPointsToRedeem",
  "maxRedeemPercentOfOrder",
  "maxPointsPerOrder",
  "redeemStep",
  "awardOnOrderStatus",
  "cancelOnOrderStatuses",
  "pointsExpiryDays",
  "showOnProductPage",
  "showOnCart",
  "programmeTerms",
]

// @desc    Update the programme configuration
// @route   PUT /api/loyalty/admin/settings
// @access  Private/Admin
router.put(
  "/admin/settings",
  ...adminGuard,
  asyncHandler(async (req, res) => {
    const settings = await LoyaltySettings.getSingleton()
    const previous = settings.toObject()

    for (const field of EDITABLE_SETTING_FIELDS) {
      if (req.body[field] !== undefined) {
        settings[field] = req.body[field]
      }
    }
    settings.updatedBy = req.user._id

    // A zero or negative redemption rate would make every point worth infinite money.
    if (toNumber(settings.redeemPointsPerAed, 0) <= 0) {
      res.status(400)
      throw new Error("Points required per 1 AED must be greater than zero")
    }

    const saved = await settings.save()
    invalidateLoyaltyCache()

    await logActivity({
      user: req.user,
      action: "UPDATE",
      module: "SETTINGS",
      description: `Updated loyalty programme settings`,
      targetId: String(saved._id),
      targetName: "Loyalty settings",
      previousData: {
        isEnabled: previous.isEnabled,
        earnPointsPerAed: previous.earnPointsPerAed,
        redeemPointsPerAed: previous.redeemPointsPerAed,
      },
      newData: {
        isEnabled: saved.isEnabled,
        earnPointsPerAed: saved.earnPointsPerAed,
        redeemPointsPerAed: saved.redeemPointsPerAed,
      },
      req,
    })

    res.json(saved)
  }),
)

// ===========================================================================
// Admin - category earning rules
// ===========================================================================

// @desc    Every category rule, plus the categories available to attach one to
// @route   GET /api/loyalty/admin/rules
// @access  Private/Admin
router.get(
  "/admin/rules",
  ...adminGuard,
  asyncHandler(async (req, res) => {
    const [rules, categories, subCategories] = await Promise.all([
      LoyaltyRule.find({}).sort({ scope: 1, refName: 1 }).lean(),
      Category.find({ isActive: true, isDeleted: { $ne: true } }).select("name slug").sort({ name: 1 }).lean(),
      SubCategory.find({ isActive: true, isDeleted: { $ne: true } })
        .select("name slug level category parentSubCategory sortOrder")
        .sort({ sortOrder: 1, name: 1 })
        .lean(),
    ])

    res.json({ rules, categories, subCategories })
  }),
)

// @desc    Create or update the rule for one category
// @route   PUT /api/loyalty/admin/rules
// @access  Private/Admin
router.put(
  "/admin/rules",
  ...adminGuard,
  asyncHandler(async (req, res) => {
    const { scope, refId, mode, multiplier, fixedPoints, isActive } = req.body

    if (!["category", "subcategory"].includes(scope)) {
      res.status(400)
      throw new Error("Scope must be 'category' or 'subcategory'")
    }
    if (!isObjectId(refId)) {
      res.status(400)
      throw new Error("A valid category is required")
    }
    if (mode !== undefined && !["multiplier", "fixed"].includes(mode)) {
      res.status(400)
      throw new Error("Mode must be 'multiplier' or 'fixed'")
    }

    // Resolve the name now so the rules list can render without joining five collections.
    const source =
      scope === "category"
        ? await Category.findById(refId).select("name").lean()
        : await SubCategory.findById(refId).select("name").lean()

    if (!source) {
      res.status(404)
      throw new Error("Category not found")
    }

    const update = {
      scope,
      refId,
      refName: source.name || "",
      updatedBy: req.user._id,
    }
    if (mode !== undefined) update.mode = mode
    if (multiplier !== undefined) update.multiplier = Math.max(0, toNumber(multiplier, 1))
    if (fixedPoints !== undefined) update.fixedPoints = Math.max(0, Math.floor(toNumber(fixedPoints, 0)))
    if (isActive !== undefined) update.isActive = Boolean(isActive)

    const rule = await LoyaltyRule.findOneAndUpdate({ scope, refId }, { $set: update }, {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    })

    invalidateLoyaltyCache()
    res.json(rule)
  }),
)

// @desc    Remove a category rule, returning it to the global rate
// @route   DELETE /api/loyalty/admin/rules/:id
// @access  Private/Admin
router.delete(
  "/admin/rules/:id",
  ...adminGuard,
  asyncHandler(async (req, res) => {
    const deleted = await LoyaltyRule.findByIdAndDelete(req.params.id)
    if (!deleted) {
      res.status(404)
      throw new Error("Rule not found")
    }
    invalidateLoyaltyCache()
    res.json({ message: "Rule removed" })
  }),
)

// ===========================================================================
// Admin - customer balances and ledger
// ===========================================================================

// @desc    Customers holding points, newest balances first
// @route   GET /api/loyalty/admin/customers
// @access  Private/Admin
router.get(
  "/admin/customers",
  ...adminGuard,
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1)
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25))
    const search = typeof req.query.search === "string" ? req.query.search.trim() : ""
    const onlyWithPoints = req.query.onlyWithPoints === "true"

    const query = {}
    if (onlyWithPoints) query.loyaltyPoints = { $gt: 0 }
    if (search) {
      const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
      query.$or = [{ name: regex }, { email: regex }, { phone: regex }]
    }

    const [customers, totalCount] = await Promise.all([
      User.find(query)
        .select("name email phone loyaltyPoints loyaltyLifetimePoints loyaltyType createdAt")
        .populate("loyaltyType", "name color earnMultiplier")
        .sort({ loyaltyPoints: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      User.countDocuments(query),
    ])

    const settings = await getLoyaltySettings()
    const withValue = customers.map((customer) => ({
      ...customer,
      balanceValueAed: pointsToAed(customer.loyaltyPoints, settings),
    }))

    res.json({ customers: withValue, page, limit, totalCount, hasMore: page * limit < totalCount })
  }),
)

// @desc    Manually credit or debit a customer's points
// @route   POST /api/loyalty/admin/customers/:id/adjust
// @access  Private/Admin
router.post(
  "/admin/customers/:id/adjust",
  ...adminGuard,
  asyncHandler(async (req, res) => {
    if (!isObjectId(req.params.id)) {
      res.status(400)
      throw new Error("Invalid customer id")
    }

    const points = Math.floor(toNumber(req.body.points, 0))
    if (points === 0) {
      res.status(400)
      throw new Error("Enter a non-zero number of points")
    }
    // A manual money movement always carries a reason.
    const note = typeof req.body.note === "string" ? req.body.note.trim() : ""
    if (!note) {
      res.status(400)
      throw new Error("A reason is required for a manual adjustment")
    }

    let transaction
    try {
      transaction = await adjustUserPoints({
        userId: req.params.id,
        points,
        note,
        adminId: req.user._id,
      })
    } catch (error) {
      res.status(error.statusCode || 400)
      throw error
    }

    const summary = await getUserLoyaltySummary(req.params.id)

    await logActivity({
      user: req.user,
      action: "UPDATE",
      module: "USERS",
      description: `${points > 0 ? "Credited" : "Debited"} ${Math.abs(points)} loyalty points - ${note}`,
      targetId: req.params.id,
      targetName: "Customer loyalty balance",
      newData: { points, note, balance: summary.balance },
      req,
    })

    res.json({ transaction, ...summary })
  }),
)

// @desc    The ledger, filterable by customer and movement type
// @route   GET /api/loyalty/admin/transactions
// @access  Private/Admin
router.get(
  "/admin/transactions",
  ...adminGuard,
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1)
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25))

    const query = {}
    if (isObjectId(req.query.user)) query.user = req.query.user
    if (typeof req.query.type === "string" && req.query.type !== "all") query.type = req.query.type
    if (typeof req.query.status === "string" && req.query.status !== "all") query.status = req.query.status

    const [transactions, totalCount] = await Promise.all([
      LoyaltyTransaction.find(query)
        .populate("user", "name email")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      LoyaltyTransaction.countDocuments(query),
    ])

    res.json({ transactions, page, limit, totalCount, hasMore: page * limit < totalCount })
  }),
)

// @desc    Programme totals for the admin dashboard
// @route   GET /api/loyalty/admin/stats
// @access  Private/Admin
router.get(
  "/admin/stats",
  ...adminGuard,
  asyncHandler(async (req, res) => {
    const settings = await getLoyaltySettings()

    const [balanceAgg, pendingAgg, byType, holders] = await Promise.all([
      User.aggregate([{ $group: { _id: null, points: { $sum: "$loyaltyPoints" } } }]),
      LoyaltyTransaction.aggregate([
        { $match: { type: "earn", status: "pending" } },
        { $group: { _id: null, points: { $sum: "$points" } } },
      ]),
      LoyaltyTransaction.aggregate([
        { $match: { status: "confirmed" } },
        { $group: { _id: "$type", points: { $sum: "$points" }, count: { $sum: 1 } } },
      ]),
      User.countDocuments({ loyaltyPoints: { $gt: 0 } }),
    ])

    const outstandingPoints = Math.max(0, toNumber(balanceAgg?.[0]?.points, 0))

    res.json({
      isEnabled: Boolean(settings.isEnabled),
      outstandingPoints,
      // What the unredeemed balance would cost the business if every customer spent it.
      outstandingLiabilityAed: pointsToAed(outstandingPoints, settings),
      pendingPoints: Math.max(0, toNumber(pendingAgg?.[0]?.points, 0)),
      customersWithPoints: holders,
      byType: byType.reduce((acc, row) => {
        acc[row._id] = { points: row.points, count: row.count }
        return acc
      }, {}),
    })
  }),
)

// @desc    Run the expiry sweep now
// @route   POST /api/loyalty/admin/expire
// @access  Private/Admin
router.post(
  "/admin/expire",
  ...adminGuard,
  asyncHandler(async (req, res) => {
    const result = await expireDuePoints({ limit: 1000 })
    res.json(result)
  }),
)

// ===========================================================================
// Loyalty Point Types (Tiers: Silver, Gold, Platinum, etc.)
// ===========================================================================

// @desc    Get all loyalty point types
// @route   GET /api/loyalty/admin/types
// @access  Private/Admin
router.get(
  "/admin/types",
  ...adminGuard,
  asyncHandler(async (req, res) => {
    const types = await LoyaltyType.find({}).sort({ isDefault: -1, createdAt: -1 })
    res.json(types)
  }),
)

// @desc    Create a new loyalty point type
// @route   POST /api/loyalty/admin/types
// @access  Private/Admin
router.post(
  "/admin/types",
  ...adminGuard,
  asyncHandler(async (req, res) => {
    const {
      name,
      description,
      color,
      badgeText,
      earnMultiplier,
      customEarnPointsPerAed,
      redeemPointsPerAed,
      minPointsToRedeem,
      maxRedeemPercentOfOrder,
      isDefault,
      isActive,
    } = req.body

    const trimmedName = String(name || "").trim()
    if (!trimmedName) {
      res.status(400)
      throw new Error("Loyalty type name is required")
    }

    const existing = await LoyaltyType.findOne({ name: { $regex: new RegExp(`^${trimmedName}$`, "i") } })
    if (existing) {
      res.status(400)
      throw new Error(`A loyalty point type with name "${trimmedName}" already exists`)
    }

    if (isDefault) {
      await LoyaltyType.updateMany({}, { $set: { isDefault: false } })
    }

    const loyaltyType = await LoyaltyType.create({
      name: trimmedName,
      description: description || "",
      color: color || "#10b981",
      badgeText: badgeText || "",
      earnMultiplier: Math.max(0, toNumber(earnMultiplier, 1)),
      customEarnPointsPerAed:
        customEarnPointsPerAed !== undefined && customEarnPointsPerAed !== null && customEarnPointsPerAed !== ""
          ? Math.max(0, toNumber(customEarnPointsPerAed, 0))
          : null,
      redeemPointsPerAed:
        redeemPointsPerAed !== undefined && redeemPointsPerAed !== null && redeemPointsPerAed !== ""
          ? Math.max(1, toNumber(redeemPointsPerAed, 1000))
          : null,
      minPointsToRedeem:
        minPointsToRedeem !== undefined && minPointsToRedeem !== null && minPointsToRedeem !== ""
          ? Math.max(0, toNumber(minPointsToRedeem, 0))
          : null,
      maxRedeemPercentOfOrder:
        maxRedeemPercentOfOrder !== undefined && maxRedeemPercentOfOrder !== null && maxRedeemPercentOfOrder !== ""
          ? Math.max(0, Math.min(100, toNumber(maxRedeemPercentOfOrder, 50)))
          : null,
      isDefault: Boolean(isDefault),
      isActive: isActive !== undefined ? Boolean(isActive) : true,
      createdBy: req.user._id,
      updatedBy: req.user._id,
    })

    invalidateLoyaltyCache()

    await logActivity({
      user: req.user,
      action: "CREATE",
      module: "SETTINGS",
      description: `Created loyalty point type: ${loyaltyType.name}`,
      targetId: String(loyaltyType._id),
      targetName: loyaltyType.name,
      req,
    })

    res.status(201).json(loyaltyType)
  }),
)

// @desc    Update a loyalty point type
// @route   PUT /api/loyalty/admin/types/:id
// @access  Private/Admin
router.put(
  "/admin/types/:id",
  ...adminGuard,
  asyncHandler(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      res.status(400)
      throw new Error("Invalid loyalty point type id")
    }

    const type = await LoyaltyType.findById(req.params.id)
    if (!type) {
      res.status(404)
      throw new Error("Loyalty point type not found")
    }

    const {
      name,
      description,
      color,
      badgeText,
      earnMultiplier,
      customEarnPointsPerAed,
      redeemPointsPerAed,
      minPointsToRedeem,
      maxRedeemPercentOfOrder,
      isDefault,
      isActive,
    } = req.body

    if (name !== undefined) {
      const trimmedName = String(name).trim()
      if (!trimmedName) {
        res.status(400)
        throw new Error("Loyalty type name cannot be empty")
      }
      const existing = await LoyaltyType.findOne({
        _id: { $ne: type._id },
        name: { $regex: new RegExp(`^${trimmedName}$`, "i") },
      })
      if (existing) {
        res.status(400)
        throw new Error(`A loyalty point type with name "${trimmedName}" already exists`)
      }
      type.name = trimmedName
    }

    if (description !== undefined) type.description = description
    if (color !== undefined) type.color = color
    if (badgeText !== undefined) type.badgeText = badgeText
    if (earnMultiplier !== undefined) type.earnMultiplier = Math.max(0, toNumber(earnMultiplier, 1))
    if (customEarnPointsPerAed !== undefined) {
      type.customEarnPointsPerAed =
        customEarnPointsPerAed !== null && customEarnPointsPerAed !== ""
          ? Math.max(0, toNumber(customEarnPointsPerAed, 0))
          : null
    }
    if (redeemPointsPerAed !== undefined) {
      type.redeemPointsPerAed =
        redeemPointsPerAed !== null && redeemPointsPerAed !== ""
          ? Math.max(1, toNumber(redeemPointsPerAed, 1000))
          : null
    }
    if (minPointsToRedeem !== undefined) {
      type.minPointsToRedeem =
        minPointsToRedeem !== null && minPointsToRedeem !== "" ? Math.max(0, toNumber(minPointsToRedeem, 0)) : null
    }
    if (maxRedeemPercentOfOrder !== undefined) {
      type.maxRedeemPercentOfOrder =
        maxRedeemPercentOfOrder !== null && maxRedeemPercentOfOrder !== ""
          ? Math.max(0, Math.min(100, toNumber(maxRedeemPercentOfOrder, 50)))
          : null
    }
    if (isActive !== undefined) type.isActive = Boolean(isActive)

    if (isDefault !== undefined) {
      const boolDefault = Boolean(isDefault)
      if (boolDefault) {
        await LoyaltyType.updateMany({ _id: { $ne: type._id } }, { $set: { isDefault: false } })
      }
      type.isDefault = boolDefault
    }

    type.updatedBy = req.user._id
    const saved = await type.save()

    invalidateLoyaltyCache()

    await logActivity({
      user: req.user,
      action: "UPDATE",
      module: "SETTINGS",
      description: `Updated loyalty point type: ${saved.name}`,
      targetId: String(saved._id),
      targetName: saved.name,
      req,
    })

    res.json(saved)
  }),
)

// @desc    Delete a loyalty point type
// @route   DELETE /api/loyalty/admin/types/:id
// @access  Private/Admin
router.delete(
  "/admin/types/:id",
  ...adminGuard,
  asyncHandler(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      res.status(400)
      throw new Error("Invalid loyalty point type id")
    }

    const type = await LoyaltyType.findById(req.params.id)
    if (!type) {
      res.status(404)
      throw new Error("Loyalty point type not found")
    }

    const userCount = await User.countDocuments({ loyaltyType: type._id })
    if (userCount > 0) {
      await User.updateMany({ loyaltyType: type._id }, { $set: { loyaltyType: null } })
    }

    await LoyaltyType.findByIdAndDelete(req.params.id)
    invalidateLoyaltyCache()

    await logActivity({
      user: req.user,
      action: "DELETE",
      module: "SETTINGS",
      description: `Deleted loyalty point type: ${type.name}`,
      targetId: String(type._id),
      targetName: type.name,
      req,
    })

    res.json({ message: "Loyalty point type removed", unlinkedUsers: userCount })
  }),
)

export default router

