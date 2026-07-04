import AppDiscount from "../models/appDiscountModel.js"
import Order from "../models/orderModel.js"
import Product from "../models/productModel.js"

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

const getActiveAppDiscounts = async () => {
  const now = new Date()
  return AppDiscount.find({
    isActive: true,
    startsAt: { $lte: now },
    endsAt: { $gte: now },
  })
    .sort({ priority: -1, createdAt: -1 })
    .lean()
}

const checkUserLevelEligibility = async ({ user, discount, hasAnyOrder }) => {
  const isOnlyNewUsers = discount.userEligibility 
    ? discount.userEligibility === "new" 
    : discount.onlyNewAppUsers

  if (isOnlyNewUsers && hasAnyOrder) {
    return { eligible: false, reason: "not_first_order_anymore" }
  }

  const isSingleUse = discount.usageLimitType 
    ? discount.usageLimitType === "one-time" 
    : discount.singleUsePerUser

  if (isSingleUse) {
    const usedBefore = await Order.exists({
      user: user._id,
      appDiscountApplied: true,
      appDiscountId: discount._id,
    })
    if (usedBefore) {
      return { eligible: false, reason: "already_used_this_discount" }
    }
  }

  return { eligible: true, reason: "eligible" }
}

export const getFirstUserAppDiscountStatus = async ({ user }) => {
  if (!user?._id) {
    return { eligible: false, reason: "auth_required" }
  }

  if (user.registrationSource !== "app") {
    return { eligible: false, reason: "not_app_registered_user" }
  }

  const activeDiscounts = await getActiveAppDiscounts()
  if (!activeDiscounts.length) {
    return { eligible: false, reason: "no_active_discount" }
  }

  const userOrderCount = await Order.countDocuments({ user: user._id, ...ACTIVE_ORDER_QUERY })
  const hasAnyOrder = userOrderCount > 0

  for (const discount of activeDiscounts) {
    const userEligibility = await checkUserLevelEligibility({ user, discount, hasAnyOrder })
    if (!userEligibility.eligible) continue

    return {
      eligible: true,
      reason: "eligible",
      hasAnyOrder,
      discount: {
        _id: discount._id,
        name: discount.name,
        description: discount.description || "",
        appliesTo: discount.appliesTo,
        products: discount.products || [],
        discountType: discount.discountType,
        discountValue: discount.discountValue,
        minOrderAmount: discount.minOrderAmount || 0,
        maxDiscountAmount: discount.maxDiscountAmount ?? null,
        onlyNewAppUsers: discount.onlyNewAppUsers,
        singleUsePerUser: discount.singleUsePerUser,
        userEligibility: discount.userEligibility || (discount.onlyNewAppUsers ? "new" : "all"),
        usageLimitType: discount.usageLimitType || (discount.singleUsePerUser ? "one-time" : "unlimited"),
        rules: discount.rules || [],
        startsAt: discount.startsAt,
        endsAt: discount.endsAt,
      },
    }
  }

  return {
    eligible: false,
    reason: hasAnyOrder ? "not_first_order_anymore" : "no_matching_discount",
    hasAnyOrder,
  }
}

export const resolveAppDiscountForOrder = async ({ user, orderItems, code }) => {
  if (!user?._id) {
    return { applied: false, reason: "auth_required" }
  }

  if (user.registrationSource !== "app") {
    return { applied: false, reason: "not_app_registered_user" }
  }

  const activeDiscounts = await getActiveAppDiscounts()

  if (!activeDiscounts.length) {
    return { applied: false, reason: "no_active_discount" }
  }

  // App discount name is the coupon code and must match
  if (!code) {
    return { applied: false, reason: "coupon_code_required" }
  }

  const searchCode = String(code).trim().toUpperCase()
  const matchingDiscounts = activeDiscounts.filter((d) => d.name.toUpperCase() === searchCode)

  if (!matchingDiscounts.length) {
    return { applied: false, reason: "invalid_or_expired_coupon" }
  }

  const normalizedItems = sanitizeOrderItems(orderItems)
  if (!normalizedItems.length) {
    return { applied: false, reason: "no_eligible_items" }
  }

  const userOrderCount = await Order.countDocuments({ user: user._id, ...ACTIVE_ORDER_QUERY })
  const hasAnyOrder = userOrderCount > 0

  for (const discount of matchingDiscounts) {
    const userEligibility = await checkUserLevelEligibility({ user, discount, hasAnyOrder })
    if (!userEligibility.eligible) continue

    let eligibleItems = normalizedItems
    if (["products", "categories", "subcategories"].includes(discount.appliesTo)) {
      const productIdsInCart = normalizedItems.map((item) => item.productId).filter(Boolean)
      const productsDetails = await Product.find({ _id: { $in: productIdsInCart } }).lean()
      const productDetailsMap = new Map(productsDetails.map((p) => [String(p._id), p]))

      if (discount.appliesTo === "products") {
        const targetProductIds = new Set((discount.products || []).map((id) => String(id)))
        eligibleItems = normalizedItems.filter((item) => item.productId && targetProductIds.has(String(item.productId)))
      } else if (discount.appliesTo === "categories") {
        const targetCategoryIds = new Set((discount.categories || []).map((id) => String(id)))
        eligibleItems = normalizedItems.filter((item) => {
          const details = productDetailsMap.get(String(item.productId))
          return details && details.parentCategory && targetCategoryIds.has(String(details.parentCategory))
        })
      } else if (discount.appliesTo === "subcategories") {
        const targetSubcategoryIds = new Set((discount.subcategories || []).map((id) => String(id)))
        eligibleItems = normalizedItems.filter((item) => {
          const details = productDetailsMap.get(String(item.productId))
          const subCatId = details && (details.category || details.subCategory)
          return details && subCatId && targetSubcategoryIds.has(String(subCatId))
        })
      }
    }

    const eligibleSubtotal = calculateEligibleSubtotal(eligibleItems)
    if (eligibleSubtotal <= 0) {
      continue
    }

    let discountType = discount.discountType
    let discountValue = discount.discountValue
    let maxDiscountAmount = discount.maxDiscountAmount

    if (Array.isArray(discount.rules) && discount.rules.length > 0) {
      const matchingRule = discount.rules.find(
        (r) => eligibleSubtotal >= r.minCartAmount && eligibleSubtotal <= r.maxCartAmount
      )
      if (!matchingRule) {
        continue
      }
      discountType = matchingRule.discountType
      discountValue = matchingRule.discountValue
      maxDiscountAmount = null
    } else {
      const minOrderAmount = Number(discount.minOrderAmount || 0)
      if (minOrderAmount > 0 && eligibleSubtotal < minOrderAmount) {
        continue
      }
    }

    const discountAmount = calculateDiscountAmount({
      discountType,
      discountValue,
      maxDiscountAmount,
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
        discountType,
        discountValue,
        maxDiscountAmount,
        userEligibility: discount.userEligibility || (discount.onlyNewAppUsers ? "new" : "all"),
        usageLimitType: discount.usageLimitType || (discount.singleUsePerUser ? "one-time" : "unlimited"),
        rules: discount.rules || [],
      },
    }
  }

  return { applied: false, reason: "no_matching_discount" }
}
