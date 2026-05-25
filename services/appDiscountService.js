import AppDiscount from "../models/appDiscountModel.js"
import Order from "../models/orderModel.js"

const ACTIVE_ORDER_QUERY = {
  status: { $nin: ["Cancelled", "Deleted"] },
  documentType: { $ne: "quotation" },
}

const sanitizeOrderItems = (orderItems = []) => {
  return (Array.isArray(orderItems) ? orderItems : [])
    .filter((item) => item && !item.isProtection)
    .map((item) => {
      const quantityRaw = Number(item.quantity ?? item.qty ?? 0)
      const priceRaw = Number(item.price ?? 0)
      const quantity = Number.isFinite(quantityRaw) ? Math.max(0, quantityRaw) : 0
      const price = Number.isFinite(priceRaw) ? Math.max(0, priceRaw) : 0
      const productId = item.product ? String(item.product) : null
      return {
        productId,
        quantity,
        price,
      }
    })
    .filter((item) => item.quantity > 0 && item.price >= 0)
}

const calculateEligibleSubtotal = (items = []) => {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0)
}

const calculateDiscountAmount = ({ discountType, discountValue, maxDiscountAmount, eligibleSubtotal }) => {
  if (!Number.isFinite(eligibleSubtotal) || eligibleSubtotal <= 0) return 0

  let amount = 0
  if (discountType === "percentage") {
    amount = (eligibleSubtotal * Number(discountValue || 0)) / 100
  } else {
    amount = Number(discountValue || 0)
  }

  if (Number.isFinite(Number(maxDiscountAmount)) && Number(maxDiscountAmount) > 0) {
    amount = Math.min(amount, Number(maxDiscountAmount))
  }

  return Math.max(0, Math.min(amount, eligibleSubtotal))
}

export const resolveAppDiscountForOrder = async ({ user, orderItems }) => {
  if (!user?._id) {
    return { applied: false, reason: "auth_required" }
  }

  if (user.registrationSource !== "app") {
    return { applied: false, reason: "not_app_registered_user" }
  }

  const now = new Date()
  const activeDiscounts = await AppDiscount.find({
    isActive: true,
    startsAt: { $lte: now },
    endsAt: { $gte: now },
  })
    .sort({ priority: -1, createdAt: -1 })
    .lean()

  if (!activeDiscounts.length) {
    return { applied: false, reason: "no_active_discount" }
  }

  const normalizedItems = sanitizeOrderItems(orderItems)
  if (!normalizedItems.length) {
    return { applied: false, reason: "no_eligible_items" }
  }

  const userOrderCount = await Order.countDocuments({ user: user._id, ...ACTIVE_ORDER_QUERY })
  const hasAnyOrder = userOrderCount > 0

  for (const discount of activeDiscounts) {
    if (discount.onlyNewAppUsers && hasAnyOrder) {
      continue
    }

    if (discount.singleUsePerUser) {
      const usedBefore = await Order.exists({
        user: user._id,
        appDiscountApplied: true,
        appDiscountId: discount._id,
      })
      if (usedBefore) {
        continue
      }
    }

    let eligibleItems = normalizedItems
    if (discount.appliesTo === "products") {
      const productIds = new Set((discount.products || []).map((id) => String(id)))
      eligibleItems = normalizedItems.filter((item) => item.productId && productIds.has(item.productId))
    }

    const eligibleSubtotal = calculateEligibleSubtotal(eligibleItems)
    if (eligibleSubtotal <= 0) {
      continue
    }

    const minOrderAmount = Number(discount.minOrderAmount || 0)
    if (minOrderAmount > 0 && eligibleSubtotal < minOrderAmount) {
      continue
    }

    const discountAmount = calculateDiscountAmount({
      discountType: discount.discountType,
      discountValue: discount.discountValue,
      maxDiscountAmount: discount.maxDiscountAmount,
      eligibleSubtotal,
    })

    if (discountAmount <= 0) {
      continue
    }

    return {
      applied: true,
      discountAmount,
      eligibleSubtotal,
      discount: {
        _id: discount._id,
        name: discount.name,
        appliesTo: discount.appliesTo,
        discountType: discount.discountType,
        discountValue: discount.discountValue,
        maxDiscountAmount: discount.maxDiscountAmount,
        onlyNewAppUsers: discount.onlyNewAppUsers,
        singleUsePerUser: discount.singleUsePerUser,
      },
    }
  }

  return { applied: false, reason: "no_matching_discount" }
}
