import express from "express"
import asyncHandler from "express-async-handler"
import mongoose from "mongoose"
import AppDiscount from "../models/appDiscountModel.js"
import Product from "../models/productModel.js"
import { protect, admin } from "../middleware/authMiddleware.js"
import { checkPermission, logActivity } from "../middleware/permissionMiddleware.js"
import { resolveAppDiscountForOrder } from "../services/appDiscountService.js"

const router = express.Router()

const parseBoolean = (value, fallback = false) => {
  if (typeof value === "boolean") return value
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase()
    if (normalized === "true") return true
    if (normalized === "false") return false
  }
  return fallback
}

const normalizeProducts = (products) => {
  if (!Array.isArray(products)) return []
  return [...new Set(products
    .map((id) => String(id || "").trim())
    .filter((id) => mongoose.Types.ObjectId.isValid(id)))]
}

const buildPayload = async (body, { forUpdate = false } = {}) => {
  const payload = {}

  if (body.name !== undefined) payload.name = String(body.name || "").trim()
  if (body.description !== undefined) payload.description = String(body.description || "").trim()
  if (body.isActive !== undefined) payload.isActive = parseBoolean(body.isActive, true)
  if (body.appliesTo !== undefined) payload.appliesTo = String(body.appliesTo || "all").trim().toLowerCase()
  if (body.discountType !== undefined) payload.discountType = String(body.discountType || "percentage").trim().toLowerCase()
  if (body.discountValue !== undefined) payload.discountValue = Number(body.discountValue)
  if (body.minOrderAmount !== undefined) payload.minOrderAmount = Number(body.minOrderAmount || 0)
  if (body.maxDiscountAmount !== undefined && body.maxDiscountAmount !== "") {
    payload.maxDiscountAmount = Number(body.maxDiscountAmount)
  } else if (body.maxDiscountAmount === "") {
    payload.maxDiscountAmount = null
  }
  if (body.onlyNewAppUsers !== undefined) payload.onlyNewAppUsers = parseBoolean(body.onlyNewAppUsers, true)
  if (body.singleUsePerUser !== undefined) payload.singleUsePerUser = parseBoolean(body.singleUsePerUser, true)
  if (body.priority !== undefined) payload.priority = Number(body.priority || 0)
  if (body.startsAt !== undefined) payload.startsAt = new Date(body.startsAt)
  if (body.endsAt !== undefined) payload.endsAt = new Date(body.endsAt)

  if (body.products !== undefined) {
    payload.products = normalizeProducts(body.products)
  }

  if (!forUpdate) {
    if (!payload.name) throw new Error("Discount name is required")
    if (!payload.startsAt || Number.isNaN(payload.startsAt.getTime())) throw new Error("Valid start date is required")
    if (!payload.endsAt || Number.isNaN(payload.endsAt.getTime())) throw new Error("Valid end date is required")
    if (!Number.isFinite(payload.discountValue) || payload.discountValue < 0) {
      throw new Error("Valid discount value is required")
    }
  }

  if (payload.startsAt && Number.isNaN(payload.startsAt.getTime())) {
    throw new Error("Valid start date is required")
  }
  if (payload.endsAt && Number.isNaN(payload.endsAt.getTime())) {
    throw new Error("Valid end date is required")
  }

  if (payload.appliesTo && !["all", "products"].includes(payload.appliesTo)) {
    throw new Error("Invalid appliesTo value")
  }

  if (payload.discountType && !["percentage", "fixed"].includes(payload.discountType)) {
    throw new Error("Invalid discount type")
  }

  if (payload.discountType === "percentage" && payload.discountValue > 100) {
    throw new Error("Percentage discount cannot exceed 100")
  }

  if (payload.startsAt && payload.endsAt && payload.endsAt <= payload.startsAt) {
    throw new Error("End date must be after start date")
  }

  if (payload.appliesTo === "products") {
    if (!payload.products || payload.products.length === 0) {
      throw new Error("Select at least one product for product-specific app discount")
    }

    const existingProducts = await Product.countDocuments({ _id: { $in: payload.products } })
    if (existingProducts !== payload.products.length) {
      throw new Error("One or more selected products are invalid")
    }
  }

  return payload
}

// @desc    Get active app discounts for public/app integration
// @route   GET /api/app-discounts/active
// @access  Public
router.get(
  "/active",
  asyncHandler(async (req, res) => {
    const now = new Date()
    const discounts = await AppDiscount.find({
      isActive: true,
      startsAt: { $lte: now },
      endsAt: { $gte: now },
    })
      .select(
        "name description appliesTo discountType discountValue minOrderAmount maxDiscountAmount onlyNewAppUsers singleUsePerUser startsAt endsAt priority",
      )
      .sort({ priority: -1, createdAt: -1 })
      .lean()

    res.json(discounts)
  }),
)

// @desc    Preview app discount eligibility for authenticated app user
// @route   POST /api/app-discounts/preview
// @access  Private
router.post(
  "/preview",
  protect,
  asyncHandler(async (req, res) => {
    const { orderItems } = req.body

    const result = await resolveAppDiscountForOrder({
      user: req.user,
      orderItems,
    })

    res.json(result)
  }),
)

// @desc    Get all app discounts
// @route   GET /api/app-discounts/admin
// @access  Private/Admin
router.get(
  "/admin",
  protect,
  admin,
  checkPermission("appDiscounts"),
  asyncHandler(async (req, res) => {
    const discounts = await AppDiscount.find({})
      .populate("products", "name sku price offerPrice")
      .populate("createdBy", "name email")
      .sort({ createdAt: -1 })

    res.json(discounts)
  }),
)

// @desc    Create app discount
// @route   POST /api/app-discounts
// @access  Private/Admin
router.post(
  "/",
  protect,
  admin,
  checkPermission("appDiscounts"),
  asyncHandler(async (req, res) => {
    const payload = await buildPayload(req.body)

    const discount = new AppDiscount({
      ...payload,
      createdBy: req.user._id,
    })

    const created = await discount.save()
    const populated = await AppDiscount.findById(created._id)
      .populate("products", "name sku price offerPrice")
      .populate("createdBy", "name email")

    await logActivity({
      user: req.user,
      action: "CREATE",
      module: "APP_DISCOUNTS",
      description: `Created app discount: ${created.name}`,
      targetId: created._id,
      targetName: created.name,
      req,
    })

    res.status(201).json(populated)
  }),
)

// @desc    Update app discount
// @route   PUT /api/app-discounts/:id
// @access  Private/Admin
router.put(
  "/:id",
  protect,
  admin,
  checkPermission("appDiscounts"),
  asyncHandler(async (req, res) => {
    const discount = await AppDiscount.findById(req.params.id)

    if (!discount) {
      res.status(404)
      throw new Error("App discount not found")
    }

    const payload = await buildPayload(req.body, { forUpdate: true })

    Object.keys(payload).forEach((key) => {
      discount[key] = payload[key]
    })

    const updated = await discount.save()
    const populated = await AppDiscount.findById(updated._id)
      .populate("products", "name sku price offerPrice")
      .populate("createdBy", "name email")

    await logActivity({
      user: req.user,
      action: "UPDATE",
      module: "APP_DISCOUNTS",
      description: `Updated app discount: ${updated.name}`,
      targetId: updated._id,
      targetName: updated.name,
      req,
    })

    res.json(populated)
  }),
)

// @desc    Delete app discount
// @route   DELETE /api/app-discounts/:id
// @access  Private/Admin
router.delete(
  "/:id",
  protect,
  admin,
  checkPermission("appDiscounts"),
  asyncHandler(async (req, res) => {
    const discount = await AppDiscount.findById(req.params.id)

    if (!discount) {
      res.status(404)
      throw new Error("App discount not found")
    }

    const deletedName = discount.name
    const deletedId = discount._id
    await discount.deleteOne()

    await logActivity({
      user: req.user,
      action: "DELETE",
      module: "APP_DISCOUNTS",
      description: `Deleted app discount: ${deletedName}`,
      targetId: deletedId,
      targetName: deletedName,
      req,
    })

    res.json({ message: "App discount deleted" })
  }),
)

export default router
