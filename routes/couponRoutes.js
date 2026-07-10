import express from "express"
import asyncHandler from "express-async-handler"
import Coupon from "../models/couponModel.js"
import Category from "../models/categoryModel.js"
import Product from "../models/productModel.js"
import AppDiscount from "../models/appDiscountModel.js"
import User from "../models/userModel.js"
import Order from "../models/orderModel.js"
import jwt from "jsonwebtoken"
import { protect, admin } from "../middleware/authMiddleware.js"
import { logActivity } from "../middleware/permissionMiddleware.js"

const router = express.Router()

const validateRules = (rulesList) => {
  if (!rulesList) return []
  if (typeof rulesList === "string") {
    try {
      rulesList = JSON.parse(rulesList)
    } catch (err) {
      throw new Error("Invalid rules format")
    }
  }
  if (!Array.isArray(rulesList)) {
    throw new Error("Rules must be an array")
  }

  const validatedRules = []
  for (const r of rulesList) {
    const minCartAmount = Number(r.minCartAmount)
    const maxCartAmount = Number(r.maxCartAmount)
    const discountValue = Number(r.discountValue)
    const discountType = String(r.discountType || "percentage").trim().toLowerCase()

    if (Number.isNaN(minCartAmount) || minCartAmount < 0) {
      throw new Error("Minimum cart amount must be a number greater than or equal to 0")
    }
    if (Number.isNaN(maxCartAmount) || maxCartAmount < minCartAmount) {
      throw new Error("Maximum cart amount must be a number greater than or equal to the minimum cart amount")
    }
    if (!["percentage", "fixed"].includes(discountType)) {
      throw new Error("Discount type must be percentage or fixed")
    }
    if (Number.isNaN(discountValue) || discountValue < 0) {
      throw new Error("Discount value must be a number greater than or equal to 0")
    }
    if (discountType === "percentage" && discountValue > 100) {
      throw new Error("Percentage discount value cannot exceed 100%")
    }
    if (discountType === "fixed" && discountValue > minCartAmount) {
      throw new Error(`Fixed discount value (AED ${discountValue}) cannot exceed the minimum cart amount (AED ${minCartAmount})`)
    }

    validatedRules.push({
      minCartAmount,
      maxCartAmount,
      discountType,
      discountValue,
    })
  }

  // Check for overlaps
  validatedRules.sort((a, b) => a.minCartAmount - b.minCartAmount)
  for (let i = 1; i < validatedRules.length; i++) {
    if (validatedRules[i].minCartAmount <= validatedRules[i - 1].maxCartAmount) {
      throw new Error(
        `Overlapping ranges detected: Slab [AED ${validatedRules[i - 1].minCartAmount} - AED ${validatedRules[i - 1].maxCartAmount}] overlaps with Slab [AED ${validatedRules[i].minCartAmount} - AED ${validatedRules[i].maxCartAmount}]`
      )
    }
  }
  return validatedRules
}

// @desc    Get all coupons
// @route   GET /api/coupons
// @access  Public
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const coupons = await Coupon.find({ isActive: true, validUntil: { $gte: new Date() }, visibility: "public" })
      .populate("categories", "name")
      .sort({ createdAt: -1 })

    res.json(coupons)
  }),
)

// @desc    Get all coupons (admin)
// @route   GET /api/coupons/admin
// @access  Private/Admin
router.get(
  "/admin",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const coupons = await Coupon.find({})
      .populate("categories", "name")
      .populate("createdBy", "name email")
      .sort({ createdAt: -1 })

    res.json(coupons)
  }),
)

// @desc    Get inactive coupons (admin)
// @route   GET /api/coupons/admin/inactive
// @access  Private/Admin
router.get(
  "/admin/inactive",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const coupons = await Coupon.find({ isActive: false })
      .populate("categories", "name")
      .populate("createdBy", "name email")
      .sort({ createdAt: -1 })

    res.json(coupons)
  }),
)

// @desc    Get expired/disabled coupons (admin)
// @route   GET /api/coupons/admin/expired
// @access  Private/Admin
router.get(
  "/admin/expired",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const coupons = await Coupon.find({
      validUntil: { $lt: new Date() },
    })
      .populate("categories", "name")
      .populate("createdBy", "name email")
      .sort({ createdAt: -1 })

    res.json(coupons)
  }),
)

// @desc    Validate coupon
// @route   POST /api/coupons/validate
// @access  Public
router.post(
  "/validate",
  asyncHandler(async (req, res) => {
    const { code, cartItems, orderSource } = req.body
    if (!code) {
      res.status(400)
      throw new Error("Coupon code is required")
    }

    const searchCode = String(code).trim().toUpperCase()
    const source = (orderSource || req.headers["x-order-source"] || req.headers["x-client-source"] || "web")
      .toString()
      .trim()
      .toLowerCase()
    const isApp = source === "app"

    // 1. Check in Coupon collection first
    let coupon = await Coupon.findOne({
      code: searchCode,
      isActive: true,
      validFrom: { $lte: new Date() },
      validUntil: { $gte: new Date() },
    }).populate("categories", "name")

    // 2. Check in AppDiscount collection if not found in Coupon
    let appDiscount = null
    if (!coupon) {
      appDiscount = await AppDiscount.findOne({
        name: searchCode,
        isActive: true,
        startsAt: { $lte: new Date() },
        endsAt: { $gte: new Date() },
      }).populate("categories", "name").populate("subcategories", "name")
    }

    if (!coupon && !appDiscount) {
      res.status(400)
      throw new Error("Invalid or expired coupon code")
    }

    // ── IF IT IS AN APP DISCOUNT ─────────────────────────────────────────────
    if (appDiscount) {
      if (!isApp) {
        res.status(400)
        throw new Error("This coupon is only valid on the GrabA2Z Mobile App.")
      }

      // Check User Eligibility if token is present
      let user = null
      if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
        try {
          const token = req.headers.authorization.split(" ")[1]
          const decoded = jwt.verify(token, process.env.JWT_SECRET)
          user = await User.findById(decoded.id).select("-password")
        } catch (err) {
          // ignore auth token parse errors for validation
        }
      }

      if (user) {
        const ACTIVE_ORDER_QUERY = {
          status: { $nin: ["Cancelled", "Deleted"] },
          documentType: { $ne: "quotation" },
        }
        const userOrderCount = await Order.countDocuments({ user: user._id, ...ACTIVE_ORDER_QUERY })
        const hasAnyOrder = userOrderCount > 0

        const isOnlyNewUsers = appDiscount.userEligibility
          ? appDiscount.userEligibility === "new"
          : appDiscount.onlyNewAppUsers

        if (isOnlyNewUsers && hasAnyOrder) {
          res.status(400)
          throw new Error("This coupon is only valid for new app users on their first order.")
        }

        const isSingleUse = appDiscount.usageLimitType
          ? appDiscount.usageLimitType === "one-time"
          : appDiscount.singleUsePerUser

        if (isSingleUse) {
          const usedBefore = await Order.exists({
            user: user._id,
            appDiscountApplied: true,
            appDiscountId: appDiscount._id,
          })
          if (usedBefore) {
            res.status(400)
            throw new Error("You have already used this coupon code.")
          }
        }
      }

      // Calculate eligible subtotal and items
      let eligibleItems = []
      let totalEligibleAmount = 0

      if (appDiscount.appliesTo === "products") {
        const targetProductIds = new Set((appDiscount.products || []).map((id) => id.toString()))
        for (const item of cartItems) {
          const prodId = item.product || item.productId
          if (prodId && targetProductIds.has(prodId.toString())) {
            eligibleItems.push(item)
            const product = await Product.findById(prodId)
            if (product) {
              const price = (product.offerPrice && product.offerPrice > 0) ? product.offerPrice : product.price
              totalEligibleAmount += price * (item.qty || item.quantity || 0)
            }
          }
        }
      } else if (appDiscount.appliesTo === "categories") {
        const targetCategoryIds = new Set((appDiscount.categories || []).map((id) => id.toString()))
        for (const item of cartItems) {
          const prodId = item.product || item.productId
          const product = await Product.findById(prodId).populate("parentCategory")
          if (product && product.parentCategory && targetCategoryIds.has(product.parentCategory._id.toString())) {
            eligibleItems.push(item)
            const price = (product.offerPrice && product.offerPrice > 0) ? product.offerPrice : product.price
            totalEligibleAmount += price * (item.qty || item.quantity || 0)
          }
        }
      } else if (appDiscount.appliesTo === "subcategories") {
        const targetSubcategoryIds = new Set((appDiscount.subcategories || []).map((id) => id.toString()))
        for (const item of cartItems) {
          const prodId = item.product || item.productId
          const product = await Product.findById(prodId)
          const subCatId = product && (product.category || product.subCategory)
          if (product && subCatId && targetSubcategoryIds.has(subCatId.toString())) {
            eligibleItems.push(item)
            const price = (product.offerPrice && product.offerPrice > 0) ? product.offerPrice : product.price
            totalEligibleAmount += price * (item.qty || item.quantity || 0)
          }
        }
      } else {
        eligibleItems = cartItems
        for (const item of cartItems) {
          const prodId = item.product || item.productId
          const product = await Product.findById(prodId)
          if (product) {
            const price = (product.offerPrice && product.offerPrice > 0) ? product.offerPrice : product.price
            totalEligibleAmount += price * (item.qty || item.quantity || 0)
          }
        }
      }

      if (eligibleItems.length === 0) {
        res.status(400)
        throw new Error("No eligible items in cart for this coupon.")
      }

      // Check rule slabs
      let discountType = appDiscount.discountType
      let discountValue = appDiscount.discountValue
      let maxDiscountAmount = appDiscount.maxDiscountAmount

      if (Array.isArray(appDiscount.rules) && appDiscount.rules.length > 0) {
        const matchingRule = appDiscount.rules.find(
          (r) => totalEligibleAmount >= r.minCartAmount && totalEligibleAmount <= r.maxCartAmount
        )
        if (!matchingRule) {
          res.status(400)
          throw new Error(`This coupon is not applicable for your cart total of AED ${totalEligibleAmount}.`)
        }
        discountType = matchingRule.discountType
        discountValue = matchingRule.discountValue
        maxDiscountAmount = null
      } else {
        if (appDiscount.minOrderAmount && totalEligibleAmount < appDiscount.minOrderAmount) {
          res.status(400)
          throw new Error(`Minimum order amount of AED ${appDiscount.minOrderAmount} required for this coupon.`)
        }
      }

      let discountAmount = 0
      if (discountType === "percentage") {
        discountAmount = (totalEligibleAmount * discountValue) / 100
        if (maxDiscountAmount && discountAmount > maxDiscountAmount) {
          discountAmount = maxDiscountAmount
        }
      } else {
        discountAmount = Math.min(discountValue, totalEligibleAmount)
      }

      return res.json({
        valid: true,
        coupon: {
          _id: appDiscount._id,
          code: appDiscount.name,
          discountType,
          discountValue,
          categories: appDiscount.categories || [],
          isAppDiscount: true,
        },
        discountAmount,
        eligibleItems,
        totalEligibleAmount,
      })
    }

    // ── IF IT IS A NORMAL COUPON ─────────────────────────────────────────────
    // Check usage limit
    if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) {
      res.status(400)
      throw new Error("Coupon usage limit exceeded")
    }

    // Calculate eligible items and discount
    let eligibleItems = []
    let totalEligibleAmount = 0

    if (coupon.categories && coupon.categories.length > 0) {
      // Category-specific coupon
      for (const item of cartItems) {
        const product = await Product.findById(item.product).populate("parentCategory")
        if (product && product.parentCategory && coupon.categories.some(c => c._id.toString() === product.parentCategory._id.toString())) {
          eligibleItems.push(item)
          // Use the actual selling price (offer price if available, otherwise regular price)
          const sellingPrice = (product.offerPrice && product.offerPrice > 0) ? product.offerPrice : product.price
          totalEligibleAmount += sellingPrice * item.qty
        }
      }
    } else {
      // General coupon applies to all items
      eligibleItems = cartItems
      for (const item of cartItems) {
        const product = await Product.findById(item.product)
        if (product) {
          // Use the actual selling price (offer price if available, otherwise regular price)
          const sellingPrice = (product.offerPrice && product.offerPrice > 0) ? product.offerPrice : product.price
          totalEligibleAmount += sellingPrice * item.qty
        }
      }
    }

    if (eligibleItems.length === 0) {
      res.status(400)
      throw new Error(
        coupon.categories && coupon.categories.length > 0
          ? `This coupon is only valid for products in: ${coupon.categories.map(c => c.name).join(", ")}. None of your cart items belong to these categories.`
          : "No eligible items in cart"
      )
    }

    // Check minimum order amount and rules
    let discountType = coupon.discountType
    let discountValue = coupon.discountValue
    let maxDiscountAmount = coupon.maxDiscountAmount

    if (Array.isArray(coupon.rules) && coupon.rules.length > 0) {
      const matchingRule = coupon.rules.find(
        (r) => totalEligibleAmount >= r.minCartAmount && totalEligibleAmount <= r.maxCartAmount
      )
      if (!matchingRule) {
        res.status(400)
        throw new Error(`This coupon is not applicable for your cart total of AED ${totalEligibleAmount}.`)
      }
      discountType = matchingRule.discountType
      discountValue = matchingRule.discountValue
      maxDiscountAmount = null
    } else {
      if (coupon.minOrderAmount && totalEligibleAmount < coupon.minOrderAmount) {
        res.status(400)
        throw new Error(`Minimum order amount of ${coupon.minOrderAmount} required for this coupon`)
      }
    }

    // Calculate discount
    let discountAmount = 0
    if (discountType === "percentage") {
      discountAmount = (totalEligibleAmount * discountValue) / 100
      if (maxDiscountAmount && discountAmount > maxDiscountAmount) {
        discountAmount = maxDiscountAmount
      }
    } else {
      discountAmount = Math.min(discountValue, totalEligibleAmount)
    }

    res.json({
      valid: true,
      coupon: {
        _id: coupon._id,
        code: coupon.code,
        discountType: discountType,
        discountValue: discountValue,
        categories: coupon.categories,
      },
      discountAmount,
      eligibleItems,
      totalEligibleAmount,
    })
  }),
)

// @desc    Create coupon
// @route   POST /api/coupons
// @access  Private/Admin
router.post(
  "/",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const { categories, ...couponData } = req.body

    // Verify categories exist if provided
    if (categories && categories.length > 0) {
      const categoryExists = await Category.find({ _id: { $in: categories } })
      if (categoryExists.length !== categories.length) {
        res.status(400)
        throw new Error("Invalid category")
      }
    }

    // Check if coupon code already exists
    const existingCoupon = await Coupon.findOne({ code: couponData.code.toUpperCase() })
    if (existingCoupon) {
      res.status(400)
      throw new Error("Coupon code already exists")
    }

    // Validate rules if provided
    let validatedRules = []
    if (couponData.rules !== undefined) {
      try {
        validatedRules = validateRules(couponData.rules)
      } catch (err) {
        res.status(400)
        throw new Error(err.message)
      }
    }

    const coupon = new Coupon({
      ...couponData, // includes visibility
      code: couponData.code.toUpperCase(),
      categories,
      rules: validatedRules,
      createdBy: req.user._id,
    })

    const createdCoupon = await coupon.save()
    const populatedCoupon = await Coupon.findById(createdCoupon._id)
      .populate("categories", "name")
      .populate("createdBy", "name email")

    // Log activity
    await logActivity(req, "CREATE", "COUPONS", `Created coupon: ${createdCoupon.code}`, createdCoupon._id, createdCoupon.code)

    res.status(201).json(populatedCoupon)
  }),
)

// @desc    Update coupon
// @route   PUT /api/coupons/:id
// @access  Private/Admin
router.put(
  "/:id",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const coupon = await Coupon.findById(req.params.id)

    if (coupon) {
      const { categories, ...updateData } = req.body

      // Verify categories exist if provided
      if (categories && categories.length > 0) {
        const categoryExists = await Category.find({ _id: { $in: categories } })
        if (categoryExists.length !== categories.length) {
          res.status(400)
          throw new Error("Invalid category")
        }
      }

      // Check if coupon code already exists (excluding current coupon)
      if (updateData.code) {
        const existingCoupon = await Coupon.findOne({
          code: updateData.code.toUpperCase(),
          _id: { $ne: req.params.id },
        })
        if (existingCoupon) {
          res.status(400)
          throw new Error("Coupon code already exists")
        }
      }

      // Validate rules if provided
      if (updateData.rules !== undefined) {
        try {
          updateData.rules = validateRules(updateData.rules)
        } catch (err) {
          res.status(400)
          throw new Error(err.message)
        }
      }

      // Update coupon fields
      Object.keys(updateData).forEach((key) => {
        if (key === "code") {
          coupon[key] = updateData[key].toUpperCase()
        } else {
          coupon[key] = updateData[key] // includes visibility
        }
      })

      if (categories) coupon.categories = categories

      const updatedCoupon = await coupon.save()
      const populatedCoupon = await Coupon.findById(updatedCoupon._id)
        .populate("categories", "name")
        .populate("createdBy", "name email")

      // Log activity
      await logActivity(req, "UPDATE", "COUPONS", `Updated coupon: ${updatedCoupon.code}`, updatedCoupon._id, updatedCoupon.code)

      res.json(populatedCoupon)
    } else {
      res.status(404)
      throw new Error("Coupon not found")
    }
  }),
)

// @desc    Delete coupon
// @route   DELETE /api/coupons/:id
// @access  Private/Admin
router.delete(
  "/:id",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const coupon = await Coupon.findById(req.params.id)

    if (coupon) {
      const couponCode = coupon.code
      const couponId = coupon._id
      await coupon.deleteOne()

      // Log activity
      await logActivity(req, "DELETE", "COUPONS", `Deleted coupon: ${couponCode}`, couponId, couponCode)

      res.json({ message: "Coupon removed" })
    } else {
      res.status(404)
      throw new Error("Coupon not found")
    }
  }),
)

export default router
