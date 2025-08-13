// import express from "express"
// import asyncHandler from "express-async-handler"
// import User from "../models/userModel.js"
// import Order from "../models/orderModel.js"
// import Product from "../models/productModel.js"
// import generateToken from "../utils/generateToken.js"
// import { protect, admin } from "../middleware/authMiddleware.js"
// import { sendOrderNotification } from "../utils/emailService.js"
// import { sendTrackingUpdateEmail } from "../utils/emailService.js"

// const router = express.Router()

// // @desc    Auth admin & get token
// // @route   POST /api/admin/login
// // @access  Public
// router.post(
//   "/login",
//   asyncHandler(async (req, res) => {
//     const { email, password } = req.body

//     const user = await User.findOne({ email })

//     if (user && (await user.matchPassword(password)) && user.isAdmin) {
//       res.json({
//         _id: user._id,
//         name: user.name,
//         email: user.email,
//         isAdmin: user.isAdmin,
//         token: generateToken(user._id),
//       })
//     } else {
//       res.status(401)
//       throw new Error("Invalid admin credentials")
//     }
//   }),
// )

// // @desc    Get admin profile
// // @route   GET /api/admin/profile
// // @access  Private/Admin
// router.get(
//   "/profile",
//   protect,
//   admin,
//   asyncHandler(async (req, res) => {
//     const user = await User.findById(req.user._id)

//     if (user) {
//       res.json({
//         _id: user._id,
//         name: user.name,
//         email: user.email,
//         isAdmin: user.isAdmin,
//       })
//     } else {
//       res.status(404)
//       throw new Error("User not found")
//     }
//   }),
// )

// // @desc    Get dashboard stats
// // @route   GET /api/admin/stats
// // @access  Private/Admin
// router.get(
//   "/stats",
//   protect,
//   admin,
//   asyncHandler(async (req, res) => {
//     const totalOrders = await Order.countDocuments()
//     const totalProducts = await Product.countDocuments()
//     const totalUsers = await User.countDocuments({ isAdmin: false })

//     // Calculate total revenue
//     const orders = await Order.find()
//     const totalRevenue = orders.reduce((acc, order) => acc + order.totalPrice, 0)

//     res.json({
//       totalOrders,
//       totalProducts,
//       totalUsers,
//       totalRevenue,
//     })
//   }),
// )

// // @desc    Get all users
// // @route   GET /api/admin/users
// // @access  Private/Admin
// router.get(
//   "/users",
//   protect,
//   admin,
//   asyncHandler(async (req, res) => {
//     const users = await User.find({ isAdmin: false }).select("-password").sort({ createdAt: -1 })
//     res.json(users)
//   }),
// )

// // @desc    Get all orders
// // @route   GET /api/admin/orders
// // @access  Private/Admin
// router.get(
//   "/orders",
//   protect,
//   admin,
//   asyncHandler(async (req, res) => {
//     const orders = await Order.find({}).populate("user", "name email").sort({ createdAt: -1 })
//     res.json(orders)
//   }),
// )

// // @desc    Get recent orders
// // @route   GET /api/admin/orders/recent
// // @access  Private/Admin
// router.get(
//   "/orders/recent",
//   protect,
//   admin,
//   asyncHandler(async (req, res) => {
//     const orders = await Order.find({}).populate("user", "name email").sort({ createdAt: -1 }).limit(5)
//     res.json(orders)
//   }),
// )

// // @desc    Update order status
// // @route   PUT /api/admin/orders/:id/status
// // @access  Private/Admin
// router.put(
//   "/orders/:id/status",
//   protect,
//   admin,
//   asyncHandler(async (req, res) => {
//     const order = await Order.findById(req.params.id)

//     if (order) {
//       const previousStatus = order.status
//       order.status = req.body.status

//       // Update delivered date if status is Delivered
//       if (req.body.status === "Delivered" && previousStatus !== "Delivered") {
//         order.deliveredAt = new Date()
//       }

//       const updatedOrder = await order.save()

//       // Send notification email only if status has changed
//       if (previousStatus !== req.body.status) {
//         try {
//           await sendOrderNotification(updatedOrder)
//           console.log(`Order status update email sent for order ${updatedOrder._id}`)
//         } catch (emailError) {
//           console.error("Failed to send order status update email:", emailError)
//           // Don't fail the order update if email fails
//         }
//       }

//       res.json(updatedOrder)
//     } else {
//       res.status(404)
//       throw new Error("Order not found")
//     }
//   }),
// )

// // @desc    Update order tracking ID
// // @route   PUT /api/admin/orders/:id/tracking
// // @access  Private/Admin
// router.put(
//   "/orders/:id/tracking",
//   protect,
//   admin,
//   asyncHandler(async (req, res) => {
//     const order = await Order.findById(req.params.id)

//     if (order) {
//       const previousTrackingId = order.trackingId
//       order.trackingId = req.body.trackingId
//       const updatedOrder = await order.save()

//       // Send tracking update email only if tracking ID has changed
//       if (previousTrackingId !== req.body.trackingId && req.body.trackingId) {
//         try {
//           await sendTrackingUpdateEmail(updatedOrder)
//           console.log(`Tracking update email sent for order ${updatedOrder._id}`)
//         } catch (emailError) {
//           console.error("Failed to send tracking update email:", emailError)
//           // Don't fail the order update if email fails
//         }
//       }

//       res.json(updatedOrder)
//     } else {
//       res.status(404)
//       throw new Error("Order not found")
//     }
//   }),
// )

// // @desc    Update order details (payment method, notes, etc.)
// // @route   PUT /api/admin/orders/:id
// // @access  Private/Admin
// router.put(
//   "/orders/:id",
//   protect,
//   admin,
//   asyncHandler(async (req, res) => {
//     const order = await Order.findById(req.params.id)

//     if (order) {
//       const { paymentMethod, isPaid, notes, estimatedDelivery, cancelReason } = req.body

//       if (paymentMethod) order.paymentMethod = paymentMethod
//       if (isPaid !== undefined) {
//         order.isPaid = isPaid
//         if (isPaid && !order.paidAt) {
//           order.paidAt = new Date()
//         }
//       }
//       if (notes !== undefined) order.notes = notes
//       if (estimatedDelivery) order.estimatedDelivery = new Date(estimatedDelivery)
//       if (cancelReason !== undefined) order.cancelReason = cancelReason

//       const updatedOrder = await order.save()
//       res.json(updatedOrder)
//     } else {
//       res.status(404)
//       throw new Error("Order not found")
//     }
//   }),
// )

// // @desc    Send order notification email
// // @route   POST /api/admin/orders/:id/notify
// // @access  Private/Admin
// router.post(
//   "/orders/:id/notify",
//   protect,
//   admin,
//   asyncHandler(async (req, res) => {
//     const order = await Order.findById(req.params.id)

//     if (!order) {
//       res.status(404)
//       throw new Error("Order not found")
//     }

//     const result = await sendOrderNotification(order)

//     if (result.success) {
//       res.json({
//         message: "Notification sent successfully",
//         messageId: result.messageId,
//       })
//     } else {
//       res.status(500)
//       throw new Error(`Failed to send notification: ${result.error}`)
//     }
//   }),
// )

// export default router


//========================================================


import express from "express"
import asyncHandler from "express-async-handler"
import User from "../models/userModel.js"
import Order from "../models/orderModel.js"
import Product from "../models/productModel.js"
import generateToken from "../utils/generateToken.js"
import { protect, admin } from "../middleware/authMiddleware.js"
import { sendOrderNotification, sendTrackingUpdateEmail } from "../utils/emailService.js"

const router = express.Router()

// @desc    Auth admin & get token
// @route   POST /api/admin/login
// @access  Public
router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password } = req.body

    const user = await User.findOne({ email })

    if (user && (await user.matchPassword(password)) && user.isAdmin) {
      res.json({
        _id: user._id,
        name: user.name,
        email: user.email,
        isAdmin: user.isAdmin,
        token: generateToken(user._id),
      })
    } else {
      res.status(401)
      throw new Error("Invalid admin credentials")
    }
  }),
)

// @desc    Get admin profile
// @route   GET /api/admin/profile
// @access  Private/Admin
router.get(
  "/profile",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id)

    if (user) {
      res.json({
        _id: user._id,
        name: user.name,
        email: user.email,
        isAdmin: user.isAdmin,
      })
    } else {
      res.status(404)
      throw new Error("User not found")
    }
  }),
)

// @desc    Get dashboard stats
// @route   GET /api/admin/stats
// @access  Private/Admin
router.get(
  "/stats",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const totalOrders = await Order.countDocuments()
    const totalProducts = await Product.countDocuments()
    const totalUsers = await User.countDocuments({ isAdmin: false })

    // Calculate total revenue
    const orders = await Order.find()
    const totalRevenue = orders.reduce((acc, order) => acc + order.totalPrice, 0)

    res.json({
      totalOrders,
      totalProducts,
      totalUsers,
      totalRevenue,
    })
  }),
)

// @desc    Get all users
// @route   GET /api/admin/users
// @access  Private/Admin
router.get(
  "/users",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const users = await User.find({ isAdmin: false }).select("-password").sort({ createdAt: -1 })
    res.json(users)
  }),
)

// @desc    Get all orders
// @route   GET /api/admin/orders
// @access  Private/Admin
router.get(
  "/orders",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const { page = 1, limit = 50, status, search } = req.query

    const query = {}

    if (status && status !== "all") {
      query.status = status
    }

    if (search) {
      query.$or = [
        { "shippingAddress.name": { $regex: search, $options: "i" } },
        { "shippingAddress.email": { $regex: search, $options: "i" } },
        { trackingId: { $regex: search, $options: "i" } },
      ]
    }

    const orders = await Order.find(query)
      .populate({ path: "user", select: "name email" })
      .populate({ path: "orderItems.product", select: "name image sku" })
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)

    // TEMP DEBUG: log first order item product keys to ensure sku is present
    if (process.env.NODE_ENV !== 'production' && orders[0]?.orderItems?.[0]?.product) {
      const prod = orders[0].orderItems[0].product
      console.log('DEBUG orderItems.product keys:', Object.keys(prod._doc || prod))
      console.log('DEBUG sample product.sku:', prod.sku)
    }

    res.json(orders)
  }),
)

// @desc    Get recent orders
// @route   GET /api/admin/orders/recent
// @access  Private/Admin
router.get(
  "/orders/recent",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const orders = await Order.find({})
      .populate({ path: "user", select: "name email" })
      .populate({ path: "orderItems.product", select: "name image sku" })
      .sort({ createdAt: -1 })
      .limit(5)
    res.json(orders)
  }),
)

// @desc    Update order status
// @route   PUT /api/admin/orders/:id/status
// @access  Private/Admin
router.put(
  "/orders/:id/status",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const order = await Order.findById(req.params.id)

    if (order) {
      const previousStatus = order.status
      order.status = req.body.status

      // Update delivered date if status is Delivered
      if (req.body.status === "Delivered" && previousStatus !== "Delivered") {
        order.deliveredAt = new Date()
      }

      const updatedOrder = await order.save()

      // Send notification email only if status has changed
      if (previousStatus !== req.body.status) {
        try {
          await sendOrderNotification(updatedOrder)
          console.log(`Order status update email sent for order ${updatedOrder._id}`)
        } catch (emailError) {
          console.error("Failed to send order status update email:", emailError)
          // Don't fail the order update if email fails
        }
      }

      res.json(updatedOrder)
    } else {
      res.status(404)
      throw new Error("Order not found")
    }
  }),
)

// @desc    Update order tracking ID
// @route   PUT /api/admin/orders/:id/tracking
// @access  Private/Admin
router.put(
  "/orders/:id/tracking",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const order = await Order.findById(req.params.id)

    if (order) {
      const previousTrackingId = order.trackingId
      order.trackingId = req.body.trackingId
      const updatedOrder = await order.save()

      // Send tracking update email only if tracking ID has changed
      if (previousTrackingId !== req.body.trackingId && req.body.trackingId) {
        try {
          await sendTrackingUpdateEmail(updatedOrder)
          console.log(`Tracking update email sent for order ${updatedOrder._id}`)
        } catch (emailError) {
          console.error("Failed to send tracking update email:", emailError)
          // Don't fail the order update if email fails
        }
      }

      res.json(updatedOrder)
    } else {
      res.status(404)
      throw new Error("Order not found")
    }
  }),
)

// @desc    Update order details (payment method, notes, etc.)
// @route   PUT /api/admin/orders/:id
// @access  Private/Admin
router.put(
  "/orders/:id",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const order = await Order.findById(req.params.id)

    if (order) {
      const { paymentMethod, isPaid, notes, estimatedDelivery, cancelReason } = req.body

      if (paymentMethod) order.paymentMethod = paymentMethod
      if (isPaid !== undefined) {
        order.isPaid = isPaid
        if (isPaid && !order.paidAt) {
          order.paidAt = new Date()
        } else if (!isPaid) {
          order.paidAt = null
        }
      }
      if (notes !== undefined) order.notes = notes
      if (estimatedDelivery) order.estimatedDelivery = new Date(estimatedDelivery)
      if (cancelReason !== undefined) order.cancelReason = cancelReason

      const updatedOrder = await order.save()
      res.json(updatedOrder)
    } else {
      res.status(404)
      throw new Error("Order not found")
    }
  }),
)

// @desc    Send order notification email
// @route   POST /api/admin/orders/:id/notify
// @access  Private/Admin
router.post(
  "/orders/:id/notify",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const order = await Order.findById(req.params.id)

    if (!order) {
      res.status(404)
      throw new Error("Order not found")
    }

    const result = await sendOrderNotification(order)

    if (result.success) {
      res.json({
        message: "Notification sent successfully",
        messageId: result.messageId,
      })
    } else {
      res.status(500)
      throw new Error(`Failed to send notification: ${result.error}`)
    }
  }),
)

// @desc    Get order statistics
// @route   GET /api/admin/orders/stats
// @access  Private/Admin
router.get(
  "/orders/stats",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const totalOrders = await Order.countDocuments()
    const pendingOrders = await Order.countDocuments({ status: "Processing" })
    const deliveredOrders = await Order.countDocuments({ status: "Delivered" })
    const cancelledOrders = await Order.countDocuments({ status: "Cancelled" })

    const totalRevenue = await Order.aggregate([
      { $match: { isPaid: true } },
      { $group: { _id: null, total: { $sum: "$totalPrice" } } },
    ])

    const monthlyRevenue = await Order.aggregate([
      {
        $match: {
          isPaid: true,
          createdAt: { $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
        },
      },
      { $group: { _id: null, total: { $sum: "$totalPrice" } } },
    ])

    res.json({
      totalOrders,
      pendingOrders,
      deliveredOrders,
      cancelledOrders,
      totalRevenue: totalRevenue[0]?.total || 0,
      monthlyRevenue: monthlyRevenue[0]?.total || 0,
    })
  }),
)

// @desc    Delete user (Admin)
// @route   DELETE /api/admin/users/:id
// @access  Private/Admin
router.delete(
  "/users/:id",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id)

    if (user) {
      if (user.isAdmin) {
        res.status(400)
        throw new Error("Cannot delete admin user")
      }
      await User.findByIdAndDelete(req.params.id)
      res.json({ message: "User removed" })
    } else {
      res.status(404)
      throw new Error("User not found")
    }
  }),
)

// @desc    Get user by ID (Admin)
// @route   GET /api/admin/users/:id
// @access  Private/Admin
router.get(
  "/users/:id",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id).select("-password")

    if (user) {
      res.json(user)
    } else {
      res.status(404)
      throw new Error("User not found")
    }
  }),
)

// @desc    Update user (Admin)
// @route   PUT /api/admin/users/:id
// @access  Private/Admin
router.put(
  "/users/:id",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id)

    if (user) {
      user.name = req.body.name || user.name
      user.email = req.body.email || user.email
      user.isAdmin = Boolean(req.body.isAdmin)

      const updatedUser = await user.save()

      res.json({
        _id: updatedUser._id,
        name: updatedUser.name,
        email: updatedUser.email,
        isAdmin: updatedUser.isAdmin,
      })
    } else {
      res.status(404)
      throw new Error("User not found")
    }
  }),
)

export default router
