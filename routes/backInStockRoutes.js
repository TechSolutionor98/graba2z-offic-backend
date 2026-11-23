import express from "express"
import asyncHandler from "express-async-handler"
import BackInStock from "../models/backInStockModel.js"
import Product from "../models/productModel.js"
import { protect, admin } from "../middleware/authMiddleware.js"
import { notifyBackInStockSubscribers, sendBackInStockEmail } from "../services/backInStockService.js"

const router = express.Router()

/**
 * @desc    Subscribe to Back-in-Stock alert
 * @route   POST /api/back-in-stock/subscribe
 * @access  Public
 */
router.post(
  "/subscribe",
  asyncHandler(async (req, res) => {
    const {
      productId,
      name,
      email,
      phone,
      country = "AE",
      countryCode = "AE",
      variant = "",
      selectedColor = "",
      selectedDos = "",
      selectedOption = "",
    } = req.body

    if (!productId || !name || !email || !phone) {
      res.status(400)
      throw new Error("Product ID, name, email, and phone number are required")
    }

    const cleanEmail = String(email).trim().toLowerCase()
    const cleanPhone = String(phone).trim()
    const cleanName = String(name).trim()
    const cleanVariant = String(variant || "").trim()

    // Fetch product to store snapshot metadata
    const product = await Product.findById(productId).select(
      "name nameAr price offerPrice image slug sku",
    )
    if (!product) {
      res.status(404)
      throw new Error("Product not found")
    }

    // Check if an unnotified subscription already exists for this email + product + variant
    let subscription = await BackInStock.findOne({
      product: productId,
      email: cleanEmail,
      variant: cleanVariant,
      notified: false,
    })

    if (subscription) {
      // Update with newest contact details
      subscription.name = cleanName
      subscription.phone = cleanPhone
      subscription.country = country
      subscription.countryCode = countryCode
      subscription.selectedColor = selectedColor || subscription.selectedColor
      subscription.selectedDos = selectedDos || subscription.selectedDos
      subscription.selectedOption = selectedOption || subscription.selectedOption
      await subscription.save()

      return res.status(200).json({
        success: true,
        message: "Your restock alert is already active and details have been updated.",
        subscription,
        isExisting: true,
      })
    }

    // Create new subscription
    subscription = await BackInStock.create({
      product: productId,
      user: req.user?._id || null,
      name: cleanName,
      email: cleanEmail,
      phone: cleanPhone,
      country,
      countryCode,
      variant: cleanVariant,
      selectedColor,
      selectedDos,
      selectedOption,
      metadata: {
        productName: product.name,
        productNameAr: product.nameAr || "",
        productPrice: product.offerPrice > 0 ? product.offerPrice : product.price,
        productImage: product.image || "",
        slug: product.slug || "",
        sku: product.sku || "",
      },
    })

    res.status(201).json({
      success: true,
      message: "Restock alert registered successfully! We will notify you as soon as this item is back in stock.",
      subscription,
    })
  }),
)

/**
 * @desc    Check if an email has an active alert for a product
 * @route   GET /api/back-in-stock/status/:productId
 * @access  Public
 */
router.get(
  "/status/:productId",
  asyncHandler(async (req, res) => {
    const { productId } = req.params
    const { email, variant = "" } = req.query

    if (!email) {
      return res.json({ isSubscribed: false })
    }

    const cleanEmail = String(email).trim().toLowerCase()
    const cleanVariant = String(variant || "").trim()

    const subscription = await BackInStock.findOne({
      product: productId,
      email: cleanEmail,
      variant: cleanVariant,
      notified: false,
    })

    res.json({
      isSubscribed: !!subscription,
      subscription: subscription || null,
    })
  }),
)

/**
 * @desc    Unsubscribe from a restock alert
 * @route   POST /api/back-in-stock/unsubscribe
 * @access  Public
 */
router.post(
  "/unsubscribe",
  asyncHandler(async (req, res) => {
    const { subscriptionId, email, productId, variant = "" } = req.body

    let query = {}
    if (subscriptionId) {
      query = { _id: subscriptionId }
    } else if (email && productId) {
      query = {
        email: String(email).trim().toLowerCase(),
        product: productId,
        variant: String(variant || "").trim(),
        notified: false,
      }
    } else {
      res.status(400)
      throw new Error("Subscription ID or email + productId required")
    }

    const deleted = await BackInStock.findOneAndDelete(query)
    if (!deleted) {
      return res.status(404).json({ success: false, message: "Subscription not found" })
    }

    res.json({ success: true, message: "Alert cancelled successfully" })
  }),
)

/**
 * @desc    Get all restock subscriptions (Admin Only)
 * @route   GET /api/back-in-stock/admin/list
 * @access  Private/Admin
 */
router.get(
  "/admin/list",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const page = Number(req.query.page) || 1
    const limit = Number(req.query.limit) || 20
    const search = req.query.search ? String(req.query.search).trim() : ""
    const status = req.query.status || "all" // 'all', 'pending', 'notified'
    const productId = req.query.productId

    const query = {}

    // Status filter
    if (status === "pending") {
      query.notified = false
    } else if (status === "notified") {
      query.notified = true
    }

    // Product filter
    if (productId) {
      query.product = productId
    }

    // Search filter across name, email, phone, product title, and variant
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
        { variant: { $regex: search, $options: "i" } },
        { "metadata.productName": { $regex: search, $options: "i" } },
        { "metadata.sku": { $regex: search, $options: "i" } },
      ]
    }

    const count = await BackInStock.countDocuments(query)
    const subscriptions = await BackInStock.find(query)
      .populate("product", "name slug sku image price offerPrice stockStatus countInStock")
      .sort({ createdAt: -1 })
      .skip(limit * (page - 1))
      .limit(limit)

    // Summary counts
    const totalCount = await BackInStock.countDocuments()
    const pendingCount = await BackInStock.countDocuments({ notified: false })
    const notifiedCount = await BackInStock.countDocuments({ notified: true })

    res.json({
      subscriptions,
      page,
      pages: Math.ceil(count / limit) || 1,
      total: count,
      stats: {
        total: totalCount,
        pending: pendingCount,
        notified: notifiedCount,
      },
    })
  }),
)

/**
 * @desc    Manually trigger notification emails for a product (Admin Only)
 * @route   POST /api/back-in-stock/admin/trigger/:productId
 * @access  Private/Admin
 */
router.post(
  "/admin/trigger/:productId",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const { productId } = req.params
    const force = req.body.force === true

    const result = await notifyBackInStockSubscribers(productId, { force })
    res.json(result)
  }),
)

/**
 * @desc    Manually send notification email to a single subscriber (Admin Only)
 * @route   POST /api/back-in-stock/admin/trigger-single/:id
 * @access  Private/Admin
 */
router.post(
  "/admin/trigger-single/:id",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const subscriber = await BackInStock.findById(req.params.id)
    if (!subscriber) {
      res.status(404)
      throw new Error("Subscription not found")
    }

    const product = await Product.findById(subscriber.product)
    const emailResult = await sendBackInStockEmail({ subscriber, product })

    if (emailResult.success) {
      subscriber.notified = true
      subscriber.notifiedAt = new Date()
      await subscriber.save()
      res.json({ success: true, message: "Alert email sent successfully!" })
    } else {
      res.status(500).json({ success: false, message: emailResult.error || "Failed to send email" })
    }
  }),
)

/**
 * @desc    Delete a subscription (Admin Only)
 * @route   DELETE /api/back-in-stock/admin/:id
 * @access  Private/Admin
 */
router.delete(
  "/admin/:id",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const subscriber = await BackInStock.findById(req.params.id)
    if (!subscriber) {
      res.status(404)
      throw new Error("Subscription not found")
    }

    await subscriber.deleteOne()
    res.json({ success: true, message: "Subscription deleted successfully" })
  }),
)

export default router

