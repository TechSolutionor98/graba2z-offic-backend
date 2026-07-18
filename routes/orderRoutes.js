import express from "express"
import asyncHandler from "express-async-handler"
import Order from "../models/orderModel.js"
import DeliveryCharge from "../models/deliveryChargeModel.js"
import Product from "../models/productModel.js"
import BuyerProtection from "../models/buyerProtectionModel.js"
import Coupon from "../models/couponModel.js"
import { protect, admin } from "../middleware/authMiddleware.js"
import { logActivity } from "../middleware/permissionMiddleware.js"
import { sendOrderPlacedEmail, sendOrderStatusUpdateEmail } from "../utils/emailService.js"
import { resolveAppDiscountForOrder } from "../services/appDiscountService.js"

const router = express.Router()
const ORDER_DOCUMENT_QUERY = {
  $or: [{ documentType: "order" }, { documentType: { $exists: false } }],
}

const resolveOrderSource = (payloadSource, headers = {}) => {
  const headerSource = headers["x-order-source"] || headers["x-client-source"]
  const normalized = String(payloadSource || headerSource || "")
    .trim()
    .toLowerCase()

  return normalized === "app" ? "app" : "web"
}

// Middleware to optionally protect routes (sets req.user if token exists)
const optionalProtect = asyncHandler(async (req, res, next) => {
  let token

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1]
      const jwt = await import('jsonwebtoken')
      const User = await import('../models/userModel.js')
      
      const decoded = jwt.default.verify(token, process.env.JWT_SECRET)
      req.user = await User.default.findById(decoded.id).select('-password')
    } catch (error) {
      console.log('Optional auth failed:', error.message)
      // Don't throw error, just continue without user
    }
  }
  next()
})

// Helper function to get display name for payment method
const getPaymentMethodDisplay = (actualPaymentMethod, paymentMethod) => {
  const method = actualPaymentMethod || paymentMethod
  switch (method?.toLowerCase()) {
    case 'tabby':
      return 'Tabby'
    case 'tamara':
      return 'Tamara'
    case 'card':
      return 'Pay by Card'
    case 'cod':
    case 'cash on delivery':
      return 'Cash on Delivery'
    default:
      return paymentMethod || 'Cash on Delivery'
  }
}

// @desc    Create new order
// @route   POST /api/orders
// @access  Public (supports both authenticated and guest checkout)
router.post(
  "/",
  optionalProtect,
  asyncHandler(async (req, res) => {
    const {
      orderItems,
      shippingAddress,
      pickupDetails,
      deliveryType,
      itemsPrice,
      shippingPrice,
      deliveryChargeId,
      totalPrice,
      orderSource,
      customerNotes,
      paymentMethod,
      actualPaymentMethod,
    } = req.body

    if (!orderItems || orderItems.length === 0) {
      res.status(400)
      throw new Error("No order items")
    }

    if (!deliveryType || !["home", "pickup"].includes(deliveryType)) {
      res.status(400)
      throw new Error("Invalid or missing delivery type")
    }

    if (deliveryType === "home") {
      // Validate shipping address fields
      if (
        !shippingAddress ||
        !shippingAddress.name ||
        !shippingAddress.email ||
        !shippingAddress.phone ||
        !shippingAddress.address ||
        !shippingAddress.city ||
        !shippingAddress.state ||
        !shippingAddress.zipCode
      ) {
        res.status(400)
        throw new Error("Missing shipping address details for home delivery")
      }
    }

    if (deliveryType === "pickup") {
      // Validate pickup details fields
      if (!pickupDetails || !pickupDetails.phone || !pickupDetails.location || !pickupDetails.storeId) {
        res.status(400)
        throw new Error("Missing pickup details for store pickup")
      }
    }

    const requestedShippingPrice = Number.isFinite(Number(shippingPrice)) ? Number(shippingPrice) : 0
    const normalizedItemsPrice = Number.isFinite(Number(itemsPrice)) ? Number(itemsPrice) : 0

    let normalizedShippingPrice = 0
    if (deliveryType === "home") {
      let selectedAdminDeliveryCharge = null

      if (typeof deliveryChargeId === "string" && /^[a-fA-F0-9]{24}$/.test(deliveryChargeId)) {
        selectedAdminDeliveryCharge = await DeliveryCharge.findOne({
          _id: deliveryChargeId,
          isActive: true,
        }).lean()
      }

      if (!selectedAdminDeliveryCharge) {
        selectedAdminDeliveryCharge = await DeliveryCharge.findOne({ isActive: true })
          .sort({ createdAt: -1 })
          .lean()
      }

      if (selectedAdminDeliveryCharge) {
        normalizedShippingPrice = Math.max(0, Number(selectedAdminDeliveryCharge.charge) || 0)
      }
    }

    const normalizedOrderSource = resolveOrderSource(orderSource, req.headers)

    // Server-side Recalculation & Validation of Items
    let calculatedItemsPrice = 0
    const verifiedOrderItems = []

    for (const item of orderItems) {
      if (item.isProtection) {
        // Buyer protection item
        const protection = await BuyerProtection.findById(item.protectionData)
        if (!protection || !protection.isActive) {
          res.status(400)
          throw new Error(`Invalid or inactive buyer protection item: ${item.name}`)
        }

        let protectionPrice = 0
        // Find parent item in the order
        const parentItem = verifiedOrderItems.find(
          (oi) => oi.product && oi.product.toString() === item.protectionFor?.toString()
        )
        if (parentItem) {
          const parentPrice = parentItem.price
          if (protection.pricingType === "percentage") {
            protectionPrice = (parentPrice * protection.pricePercentage) / 100
            if (protection.minPrice && protectionPrice < protection.minPrice) {
              protectionPrice = protection.minPrice
            }
            if (protection.maxPrice && protectionPrice > protection.maxPrice) {
              protectionPrice = protection.maxPrice
            }
          } else {
            protectionPrice = protection.price
          }
        } else {
          res.status(400)
          throw new Error(`Parent product for buyer protection item not found in order items`)
        }

        verifiedOrderItems.push({
          name: item.name,
          quantity: Number(item.quantity) || 1,
          image: item.image,
          price: protectionPrice,
          isProtection: true,
          protectionFor: item.protectionFor,
          protectionData: item.protectionData,
        })
        calculatedItemsPrice += protectionPrice * (Number(item.quantity) || 1)
      } else {
        // Regular product item
        const product = await Product.findById(item.product)
        if (!product || !product.isActive) {
          res.status(400)
          throw new Error(`Product not found or inactive: ${item.name}`)
        }

        let dbPrice = 0
        // Check DOS variation
        if (
          item.selectedDosIndex !== null &&
          item.selectedDosIndex !== undefined &&
          product.dosVariations &&
          product.dosVariations[item.selectedDosIndex]
        ) {
          const dosVar = product.dosVariations[item.selectedDosIndex]
          dbPrice = dosVar.offerPrice > 0 ? dosVar.offerPrice : dosVar.price
        }
        // Check Color variation
        else if (
          item.selectedColorIndex !== null &&
          item.selectedColorIndex !== undefined &&
          product.colorVariations &&
          product.colorVariations[item.selectedColorIndex]
        ) {
          const colorVar = product.colorVariations[item.selectedColorIndex]
          dbPrice = colorVar.offerPrice > 0 ? colorVar.offerPrice : colorVar.price
        }
        // Default product price
        else {
          dbPrice = product.offerPrice > 0 ? product.offerPrice : product.price
        }

        const quantity = Number(item.quantity) || 1
        
        const verifiedItem = {
          name: product.name,
          quantity,
          image: product.image,
          price: dbPrice,
          product: product._id,
        }

        if (item.selectedColorIndex !== null && item.selectedColorIndex !== undefined) {
          verifiedItem.selectedColorIndex = item.selectedColorIndex
          const cv = product.colorVariations[item.selectedColorIndex]
          if (cv) {
            verifiedItem.selectedColorData = {
              color: cv.color,
              image: cv.image,
              price: cv.price,
              offerPrice: cv.offerPrice,
              sku: cv.sku,
            }
          }
        }

        if (item.selectedDosIndex !== null && item.selectedDosIndex !== undefined) {
          verifiedItem.selectedDosIndex = item.selectedDosIndex
          const dv = product.dosVariations[item.selectedDosIndex]
          if (dv) {
            verifiedItem.selectedDosData = {
              dosType: dv.dosType,
              image: dv.image,
              price: dv.price,
              offerPrice: dv.offerPrice,
              sku: dv.sku,
            }
          }
        }

        verifiedOrderItems.push(verifiedItem)
        calculatedItemsPrice += dbPrice * quantity
      }
    }

    const normalizedBaseTotal = calculatedItemsPrice + normalizedShippingPrice

    // Server-side App Discount validation
    let appDiscountMeta = null
    let appliedAppDiscountAmount = 0
    if (normalizedOrderSource === "app" && req.user) {
      const appDiscountResult = await resolveAppDiscountForOrder({
        user: req.user,
        orderItems: verifiedOrderItems,
        code: req.body.couponCode,
      })

      if (appDiscountResult?.applied) {
        appDiscountMeta = appDiscountResult.discount
        appliedAppDiscountAmount = Math.min(
          Math.max(0, Number(appDiscountResult.discountAmount || 0)),
          normalizedBaseTotal,
        )
      }
    }

    // Server-side Web Coupon validation
    let couponDiscount = 0
    if (req.body.couponCode && normalizedOrderSource === "web") {
      const searchCode = String(req.body.couponCode).trim().toUpperCase()
      const coupon = await Coupon.findOne({
        code: searchCode,
        isActive: true,
        validFrom: { $lte: new Date() },
        validUntil: { $gte: new Date() },
      })

      if (coupon) {
        let totalEligibleAmount = 0
        if (coupon.appliesTo === "products") {
          const targetProductIds = new Set((coupon.products || []).map((id) => id.toString()))
          for (const item of verifiedOrderItems) {
            if (item.product && targetProductIds.has(item.product.toString())) {
              totalEligibleAmount += item.price * item.quantity
            }
          }
        } else if (coupon.appliesTo === "categories") {
          const targetCategoryIds = new Set((coupon.categories || []).map((id) => id.toString()))
          for (const item of verifiedOrderItems) {
            if (item.product) {
              const product = await Product.findById(item.product).lean()
              if (product && product.parentCategory && targetCategoryIds.has(product.parentCategory.toString())) {
                totalEligibleAmount += item.price * item.quantity
              }
            }
          }
        } else if (coupon.appliesTo === "subcategories") {
          const targetSubcategoryIds = new Set((coupon.subcategories || []).map((id) => id.toString()))
          for (const item of verifiedOrderItems) {
            if (item.product) {
              const product = await Product.findById(item.product).lean()
              const subCatId = product && (product.category || product.subCategory)
              if (product && subCatId && targetSubcategoryIds.has(subCatId.toString())) {
                totalEligibleAmount += item.price * item.quantity
              }
            }
          }
        } else {
          totalEligibleAmount = verifiedOrderItems.reduce(
            (sum, item) => sum + (item.isProtection ? 0 : item.price * item.quantity),
            0
          )
        }

        if (totalEligibleAmount > 0 && (!coupon.minOrderAmount || totalEligibleAmount >= coupon.minOrderAmount)) {
          if (coupon.discountType === "percentage") {
            couponDiscount = (totalEligibleAmount * coupon.discountValue) / 100
            if (coupon.maxDiscountAmount && couponDiscount > coupon.maxDiscountAmount) {
              couponDiscount = coupon.maxDiscountAmount
            }
          } else {
            couponDiscount = Math.min(coupon.discountValue, totalEligibleAmount)
          }
        }
      }
    }

    const finalDiscountAmount = appliedAppDiscountAmount > 0 ? appliedAppDiscountAmount : couponDiscount
    const normalizedTotalPrice = Math.max(0, normalizedBaseTotal - finalDiscountAmount)

    const order = new Order({
      orderItems: verifiedOrderItems,
      user: req.user ? req.user._id : null,
      orderSource: normalizedOrderSource,
      deliveryType,
      shippingAddress: deliveryType === "home" ? shippingAddress : undefined,
      pickupDetails: deliveryType === "pickup" ? pickupDetails : undefined,
      itemsPrice: calculatedItemsPrice,
      shippingPrice: normalizedShippingPrice,
      discountAmount: finalDiscountAmount,
      appDiscountApplied: Boolean(appDiscountMeta && appliedAppDiscountAmount > 0),
      appDiscountId: appDiscountMeta?._id || null,
      appDiscountName: appDiscountMeta?.name || "",
      appDiscountType: appDiscountMeta?.discountType || "",
      appDiscountValue: Number(appDiscountMeta?.discountValue || 0),
      appDiscountAmount: appliedAppDiscountAmount,
      totalPrice: normalizedTotalPrice,
      couponCode: appDiscountMeta ? appDiscountMeta.name : (req.body.couponCode || ""),
      customerNotes,
      paymentMethod: paymentMethod || "cod",
      actualPaymentMethod: actualPaymentMethod || paymentMethod || "cod",
      paymentCharges: req.body.paymentCharges || [],
      status: "New",
    })

    const createdOrder = await order.save()
    
    console.log(`[ORDER CREATED] Order ID: ${createdOrder._id}, User: ${req.user ? req.user._id : 'GUEST'}, Email: ${deliveryType === 'home' ? shippingAddress?.email : pickupDetails?.email}`)

    // Populate the user information for the created order
    await createdOrder.populate("user", "name email")
    await createdOrder.populate("orderItems.product", "name nameAr image")

    // Populate order items for email
    await createdOrder.populate("orderItems.product", "name nameAr image")

    // Send order confirmation email
    try {
      await sendOrderPlacedEmail(createdOrder)
      console.log(`Order confirmation email sent for order ${createdOrder._id}`)
    } catch (emailError) {
      console.error("Failed to send order confirmation email:", emailError)
      // Don't fail the order creation if email fails
    }

    res.status(201).json(createdOrder)
  }),
)

// @desc    Update order status (Admin)
// @route   PUT /api/orders/:id/status
// @access  Private/Admin
router.put(
  "/:id/status",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const { status, trackingId } = req.body

    const order = await Order.findById(req.params.id)
      .populate("user", "name email")
      .populate("orderItems.product", "name nameAr image")

    if (!order) {
      res.status(404)
      throw new Error("Order not found")
    }
    if (order.documentType === "quotation") {
      res.status(400)
      throw new Error("Quotation cannot be updated from order endpoint")
    }

    const oldStatus = order.status

    // Normalize incoming status to match schema enum values (case-insensitive)
    if (typeof status === "string" && status.trim().length > 0) {
      const allowedStatuses = Order.schema.path("status").enumValues || []
      const normalized = allowedStatuses.find(
        (s) => s.toLowerCase() === status.toLowerCase().trim(),
      )

      if (!normalized) {
        res.status(400)
        throw new Error(
          `Invalid status '${status}'. Allowed values: ${allowedStatuses.join(", ")}`,
        )
      }

      order.status = normalized
    }

    if (trackingId) {
      order.trackingId = trackingId
    }

    const updatedOrder = await order.save()

    // Send status update email only when status actually changes
    if (oldStatus !== updatedOrder.status) {
      try {
        await sendOrderStatusUpdateEmail(updatedOrder)
        console.log(`Order status update email sent for order ${updatedOrder._id}`)
      } catch (emailError) {
        console.error("Failed to send order status update email:", emailError)
        // Don't fail the status update if email fails
      }
    }

    // Log activity
    if (req.user) {
      await logActivity({
        user: req.user,
        action: "STATUS_CHANGE",
        module: "ORDERS",
        description: `Changed order #${order._id.toString().slice(-6)} status from "${oldStatus}" to "${updatedOrder.status}"`,
        targetId: order._id.toString(),
        targetName: `Order #${order._id.toString().slice(-6)}`,
        previousData: { status: oldStatus },
        newData: { status: updatedOrder.status, trackingId },
        req,
      })
    }

    res.json(updatedOrder)
  }),
)

// @desc    Get logged in user orders
// @route   GET /api/orders/myorders
// @access  Private
router.get(
  "/myorders",
  protect,
  asyncHandler(async (req, res) => {
    console.log(`[MYORDERS] Fetching orders for user: ${req.user._id}, email: ${req.user.email}`)
    
    // Find orders directly associated with user
    const userOrders = await Order.find({ $and: [ORDER_DOCUMENT_QUERY, { user: req.user._id }] })
      .populate('orderItems.product', 'name image slug')
      .sort({ createdAt: -1 })
    
    console.log(`[MYORDERS] Found ${userOrders.length} orders directly associated with user`)

    // Find orders that might be associated through email (for orphaned orders)
    const emailOrders = await Order.find({
      $and: [
        ORDER_DOCUMENT_QUERY,
        {
          user: null,
          $or: [{ "shippingAddress.email": req.user.email }, { "pickupDetails.email": req.user.email }],
        },
      ],
    })
      .populate('orderItems.product', 'name image slug')
      .sort({ createdAt: -1 })
    
    console.log(`[MYORDERS] Found ${emailOrders.length} orphaned orders with null user`)
    
    // Also check for orders with undefined user field
    const undefinedUserOrders = await Order.find({
      $and: [
        ORDER_DOCUMENT_QUERY,
        {
          user: { $exists: false },
          $or: [{ "shippingAddress.email": req.user.email }, { "pickupDetails.email": req.user.email }],
        },
      ],
    })
      .populate('orderItems.product', 'name image slug')
      .sort({ createdAt: -1 })
    
    console.log(`[MYORDERS] Found ${undefinedUserOrders.length} orders with undefined user field`)

    // Update orphaned orders to associate them with the user
    const ordersToUpdate = [...emailOrders, ...undefinedUserOrders]
    if (ordersToUpdate.length > 0) {
      console.log(`[MYORDERS] Updating ${ordersToUpdate.length} orphaned orders to associate with user ${req.user._id}`)
      
      await Order.updateMany(
        {
          _id: { $in: ordersToUpdate.map(order => order._id) }
        },
        { user: req.user._id }
      )
      
      // Update the user field in the returned orders
      ordersToUpdate.forEach(order => {
        order.user = req.user._id
      })
    }

    // Combine, filter out Deleted orders, and sort all orders
    const allOrders = [...userOrders, ...ordersToUpdate]
      .filter(order => order.status !== "Deleted")
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    
    console.log(`[MYORDERS] Returning total of ${allOrders.length} orders to user`)
    
    res.json(allOrders)
  }),
)

// @desc    Track order by email and order ID
// @route   POST /api/orders/track
// @access  Public
router.post(
  "/track",
  asyncHandler(async (req, res) => {
    const { email, orderId } = req.body

    if (!email || !orderId) {
      res.status(400)
      throw new Error("Email and Order ID are required")
    }

    // Clean the order ID - remove # if present and handle different formats
    const cleanOrderId = orderId.toString().replace(/^#/, "").trim()

    console.log(`Tracking order with email: ${email}, orderId: ${cleanOrderId}`)

    let order = null

    try {
      // First try to find by MongoDB ObjectId if it looks like one
      if (cleanOrderId.match(/^[0-9a-fA-F]{24}$/)) {
        console.log("Searching by MongoDB ObjectId...")

        // Search in multiple ways for the email
        order = await Order.findOne({
          $and: [
            ORDER_DOCUMENT_QUERY,
            {
              _id: cleanOrderId,
              $or: [{ "shippingAddress.email": email }, { "pickupDetails.email": email }],
            },
          ],
        })
          .populate("orderItems.product", "name nameAr image")
          .populate("user", "name email")

        // If not found with address emails, try with user email
        if (!order) {
          const orderWithUser = await Order.findOne({ $and: [ORDER_DOCUMENT_QUERY, { _id: cleanOrderId }] })
            .populate("orderItems.product", "name nameAr image")
            .populate("user", "name email")

          if (orderWithUser && orderWithUser.user && orderWithUser.user.email === email) {
            order = orderWithUser
          }
        }
      }

      // If not found by ObjectId, try other methods
      if (!order) {
        console.log("Searching by other methods...")

        // Get all orders for this email from different sources
        const orders = await Order.find({
          $and: [
            ORDER_DOCUMENT_QUERY,
            { $or: [{ "shippingAddress.email": email }, { "pickupDetails.email": email }] },
          ],
        })
          .populate("orderItems.product", "name nameAr image")
          .populate("user", "name email")

        // Also get orders where user email matches
        const userOrders = await Order.find(ORDER_DOCUMENT_QUERY)
          .populate("orderItems.product", "name nameAr image")
          .populate("user", "name email")

        const userMatchOrders = userOrders.filter((o) => o.user && o.user.email === email)

        // Combine all orders
        const allOrders = [...orders, ...userMatchOrders]

        // Remove duplicates
        const uniqueOrders = allOrders.filter(
          (order, index, self) => index === self.findIndex((o) => o._id.toString() === order._id.toString()),
        )

        console.log(`Found ${uniqueOrders.length} orders for email ${email}`)

        // Find order that matches the ID pattern
        order = uniqueOrders.find((o) => {
          const orderIdStr = o._id.toString()
          return (
            orderIdStr === cleanOrderId ||
            orderIdStr.toLowerCase().includes(cleanOrderId.toLowerCase()) ||
            cleanOrderId.toLowerCase().includes(orderIdStr.toLowerCase()) ||
            (o.trackingId && o.trackingId.includes(cleanOrderId)) ||
            (o.orderNumber && o.orderNumber.includes(cleanOrderId)) ||
            orderIdStr.slice(-6) === cleanOrderId || // Last 6 characters
            orderIdStr.slice(-8) === cleanOrderId // Last 8 characters
          )
        })
      }

      if (!order) {
        console.log("Order not found, trying partial match...")

        // Last resort: try partial matching on all orders
        const allOrders = await Order.find(ORDER_DOCUMENT_QUERY)
          .populate("orderItems.product", "name nameAr image")
          .populate("user", "name email")

        const matchingOrders = allOrders.filter((o) => {
          // Check if email matches in any field
          const emailMatch =
            (o.shippingAddress && o.shippingAddress.email === email) ||
            (o.pickupDetails && o.pickupDetails.email === email) ||
            (o.user && o.user.email === email)

          if (!emailMatch) return false

          // Check if order ID matches in any way
          const orderIdStr = o._id.toString()
          return (
            orderIdStr.includes(cleanOrderId) ||
            cleanOrderId.includes(orderIdStr) ||
            (o.trackingId && (o.trackingId.includes(cleanOrderId) || cleanOrderId.includes(o.trackingId)))
          )
        })

        if (matchingOrders.length > 0) {
          order = matchingOrders[0] // Take the first match
          console.log(`Found order via partial match: ${order._id}`)
        }
      }

      if (!order) {
        console.log("No order found after all attempts")
        res.status(404)
        throw new Error("Order not found with the provided email and order ID. Please check your email and order ID.")
      }

      console.log(`Successfully found order: ${order._id}`)
      res.json(order)
    } catch (error) {
      console.error("Error in order tracking:", error)
      res.status(500)
      throw new Error("Error occurred while tracking order. Please try again.")
    }
  }),
)

// @desc    Get order by ID
// @route   GET /api/orders/:id
// @access  Private
router.get(
  "/:id",
  protect,
  asyncHandler(async (req, res) => {
    const order = await Order.findOne({ $and: [ORDER_DOCUMENT_QUERY, { _id: req.params.id }] })

    if (order) {
      res.json(order)
    } else {
      res.status(404)
      throw new Error("Order not found")
    }
  }),
)

// @desc    Get all orders (Admin)
// @route   GET /api/orders
// @access  Private/Admin
router.get(
  "/",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const orders = await Order.find(ORDER_DOCUMENT_QUERY)
      .populate("user", "name email")
      .populate("orderItems.product", "name nameAr image")
      .sort({ createdAt: -1 })

    res.json(orders)
  }),
)

// @desc    Get order statistics
// @route   GET /api/orders/stats
// @access  Private/Admin
router.get(
  "/stats",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const stats = await Order.aggregate([
      { $match: ORDER_DOCUMENT_QUERY },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          totalValue: { $sum: "$totalPrice" },
        },
      },
    ])

    const totalOrders = await Order.countDocuments(ORDER_DOCUMENT_QUERY)
    const totalRevenue = await Order.aggregate([
      { $match: { ...ORDER_DOCUMENT_QUERY, isPaid: true } },
      { $group: { _id: null, total: { $sum: "$totalPrice" } } },
    ])

    res.json({
      statusStats: stats,
      totalOrders,
      totalRevenue: totalRevenue[0]?.total || 0,
    })
  }),
)

export default router
