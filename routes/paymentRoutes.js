import express from "express"
import axios from "axios"
import Order from "../models/orderModel.js"
import { protect } from "../middleware/authMiddleware.js"

const router = express.Router()

// Tamara Payment Routes
router.post("/tamara/checkout", protect, async (req, res) => {
  try {
    const tamaraConfig = {
      headers: {
        Authorization: `Bearer ${process.env.TAMARA_API_KEY}`,
        "Content-Type": "application/json",
      },
    }

    const tamaraResponse = await axios.post(`${process.env.TAMARA_API_URL}/checkout`, req.body, tamaraConfig)

    res.json(tamaraResponse.data)
  } catch (error) {
    console.error("Tamara payment error:", error.response?.data || error.message)
    res.status(500).json({
      message: "Tamara payment failed",
      error: error.response?.data || error.message,
    })
  }
})

router.post("/tamara/webhook", async (req, res) => {
  try {
    const { order_id, order_status, payment_status, order_reference_id } = req.body

    // Find and update order (support both old and new reference)
    let order = await Order.findOne({ "paymentResult.tamara_order_id": order_id })
    if (!order && order_reference_id) {
      order = await Order.findById(order_reference_id)
    }
    if (order) {
      order.paymentResult = {
        ...order.paymentResult,
        status: payment_status,
        update_time: new Date().toISOString(),
      }
      order.isPaid = payment_status === "approved"
      order.paidAt = payment_status === "approved" ? new Date() : null
      await order.save()
    }

    res.status(200).json({ received: true })
  } catch (error) {
    console.error("Tamara webhook error:", error)
    res.status(500).json({ error: "Webhook processing failed" })
  }
})

// Tabby Payment Routes
router.post("/tabby/sessions", protect, async (req, res) => {
  try {
    const tabbyConfig = {
      headers: {
        Authorization: `Bearer ${process.env.TABBY_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
    }

    const tabbyResponse = await axios.post(`${process.env.TABBY_API_URL}/api/v2/checkout`, req.body, tabbyConfig)

    res.json(tabbyResponse.data)
  } catch (error) {
    console.error("Tabby payment error:", error.response?.data || error.message)
    res.status(500).json({
      message: "Tabby payment failed",
      error: error.response?.data || error.message,
    })
  }
})

router.post("/tabby/webhook", async (req, res) => {
  try {
    const { id, status, order } = req.body
    // Try to get reference_id from order or meta
    const referenceId = order?.reference_id || order?.meta?.order_id

    // Find and update order (support both old and new reference)
    let dbOrder = await Order.findOne({ "paymentResult.tabby_payment_id": id })
    if (!dbOrder && referenceId) {
      dbOrder = await Order.findById(referenceId)
    }
    if (dbOrder) {
      dbOrder.paymentResult = {
        ...dbOrder.paymentResult,
        status: status,
        update_time: new Date().toISOString(),
      }
      dbOrder.isPaid = status === "AUTHORIZED"
      dbOrder.paidAt = status === "AUTHORIZED" ? new Date() : null
      await dbOrder.save()
    }

    res.status(200).json({ received: true })
  } catch (error) {
    console.error("Tabby webhook error:", error)
    res.status(500).json({ error: "Webhook processing failed" })
  }
})

// N-Genius Payment Routes
router.post("/ngenius/card", async (req, res) => {
  const { amount, currencyCode = "AED" } = req.body

  if (!amount) {
    return res.status(400).json({ error: "Amount is required" })
  }

  try {
    const basicToken =
      "Njk1NWExNDItMjA3ZC00MWZiLTk5NjQtZTM5OWY5MmVjMjRmOjhmZGM1NThhLTM0ZWYtNDFjMC05M2NjLTk5OWNhZjM5ZTA2OQ=="

    // Step 1: Get access token
    const tokenRes = await axios.post(
      `${process.env.NGENIUS_API_URL}/identity/auth/access-token`,
      {}, // required: empty object, not null
      {
        headers: {
          Authorization: `Basic ${basicToken}`,
          "Content-Type": "application/vnd.ni-identity.v1+json",
        },
      },
    )

    const accessToken = tokenRes.data.access_token
    if (!accessToken) {
      return res.status(500).json({ error: "Access token not received" })
    }

    console.log("Access token:", accessToken.slice(0, 12) + "...")

    // Step 2: Create order
    const orderPayload = {
      action: "PURCHASE",
      amount: {
        currencyCode,
        value: Math.round(amount * 100), // AED 10 → 1000 fils
      },
      merchantAttributes: {
        redirectUrl: "https://graba2z.ae/payment/success", // ✅ required
        cancelUrl: "https://graba2z.ae/payment/cancel", // optional
      },
    }

    const orderRes = await axios.post(
      `${process.env.NGENIUS_API_URL}/transactions/outlets/${process.env.NG_OUTLET_ID}/orders`,
      orderPayload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/vnd.ni-payment.v2+json",
          Accept: "application/vnd.ni-payment.v2+json",
        },
      },
    )

    const { _links } = orderRes.data
    const redirectUrl = _links?.payment?.href

    if (!redirectUrl) {
      return res.status(500).json({ error: "No redirect URL found in response" })
    }

    res.status(200).json({
      paymentUrl: redirectUrl,
      orderData: orderRes.data,
    })
  } catch (err) {
    console.error("Hosted Payment Flow Error:", err.response?.data || err.message)
    res.status(500).json({
      error: "Hosted payment flow failed",
      details: err.response?.data || err.message,
    })
  }
})

// Keep the existing N-Genius webhook
router.post("/ngenius/webhook", async (req, res) => {
  try {
    const { orderReference, state, amount, orderId } = req.body

    // Find and update order (support both old and new reference)
    let order = await Order.findOne({ "paymentResult.ngenius_order_ref": orderReference })
    if (!order && orderId) {
      order = await Order.findById(orderId)
    }
    if (order) {
      order.paymentResult = {
        ...order.paymentResult,
        status: state,
        update_time: new Date().toISOString(),
      }
      order.isPaid = state === "PURCHASED"
      order.paidAt = state === "PURCHASED" ? new Date() : null
      await order.save()
    }

    res.status(200).json({ received: true })
  } catch (error) {
    console.error("N-Genius webhook error:", error)
    res.status(500).json({ error: "Webhook processing failed" })
  }
})

export default router
