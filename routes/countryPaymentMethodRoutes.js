import express from "express"
import asyncHandler from "express-async-handler"
import Country from "../models/countryModel.js"
import { protect, admin } from "../middleware/authMiddleware.js"
import { logActivity } from "../middleware/permissionMiddleware.js"

const router = express.Router()

// The complete set of payment methods the platform supports.
// Kept in sync with productModel.paymentMethods / countryModel.paymentMethods enums.
export const ALL_PAYMENT_METHODS = ["card", "cod", "tamara", "tabby"]

const sanitizeMethods = (methods) => {
  if (!Array.isArray(methods)) return null
  const cleaned = [...new Set(methods.map((m) => String(m || "").trim().toLowerCase()))].filter((m) =>
    ALL_PAYMENT_METHODS.includes(m),
  )
  // Preserve the canonical ordering so the UI and stored data always agree.
  return ALL_PAYMENT_METHODS.filter((m) => cleaned.includes(m))
}

/**
 * Resolve the payment methods enabled for a country.
 *
 * A country with no configuration (missing or empty `paymentMethods`) is
 * unrestricted, so every supported method is returned. This keeps existing
 * countries working untouched until an admin actually disables something.
 *
 * @param {string} countryCode ISO-2 country code, e.g. "AE"
 * @returns {Promise<string[]>}
 */
export const resolveCountryPaymentMethods = async (countryCode) => {
  const code = String(countryCode || "").trim().toUpperCase()
  if (!code) return [...ALL_PAYMENT_METHODS]

  try {
    const country = await Country.findOne({ code }, "code name paymentMethods").lean()
    if (!country) return [...ALL_PAYMENT_METHODS]

    const configured = sanitizeMethods(country.paymentMethods)
    if (!configured || configured.length === 0) return [...ALL_PAYMENT_METHODS]

    return configured
  } catch (error) {
    console.error("Failed to resolve country payment methods:", error.message)
    return [...ALL_PAYMENT_METHODS]
  }
}

/**
 * Combine a product-level allow list with a country-level allow list.
 *
 * A method must be permitted by both. A country disable is a hard gate, so when
 * the two lists have nothing in common the country list wins - that keeps the
 * customer with something payable instead of an empty checkout.
 *
 * @param {string[]} productMethods
 * @param {string[]} countryMethods
 * @returns {string[]}
 */
export const combinePaymentMethods = (productMethods, countryMethods) => {
  const product = sanitizeMethods(productMethods) || []
  const country = sanitizeMethods(countryMethods) || [...ALL_PAYMENT_METHODS]

  if (product.length === 0) return country

  const intersection = product.filter((method) => country.includes(method))
  return intersection.length > 0 ? intersection : country
}

// @desc    Resolve allowed payment methods for a country (storefront + mobile app)
// @route   GET /api/country-payment-methods/resolve?countryCode=AE
// @access  Public
router.get(
  "/resolve",
  asyncHandler(async (req, res) => {
    const countryCode = req.query.countryCode || req.query.country || ""
    const paymentMethods = await resolveCountryPaymentMethods(countryCode)

    res.json({
      countryCode: String(countryCode || "").trim().toUpperCase(),
      paymentMethods,
    })
  }),
)

// @desc    Every country plus its payment method configuration (admin matrix)
// @route   GET /api/country-payment-methods/config
// @access  Private/Admin
router.get(
  "/config",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const countries = await Country.find({}, "code name nameAr currencyCode currencySymbol flagSvg isActive isDefault sortOrder paymentMethods")
      .sort({ sortOrder: 1, name: 1 })
      .lean()

    const result = countries.map((country) => {
      const configured = sanitizeMethods(country.paymentMethods)
      const isConfigured = Boolean(configured && configured.length > 0)

      return {
        _id: country._id,
        code: country.code,
        name: country.name,
        nameAr: country.nameAr,
        currencyCode: country.currencyCode,
        currencySymbol: country.currencySymbol,
        flagSvg: country.flagSvg,
        isActive: country.isActive,
        isDefault: country.isDefault,
        sortOrder: country.sortOrder,
        // What checkout will actually offer for this country.
        paymentMethods: isConfigured ? configured : [...ALL_PAYMENT_METHODS],
        // False means the country has never been customised (all methods on).
        isConfigured,
      }
    })

    res.json({
      availableMethods: ALL_PAYMENT_METHODS,
      countries: result,
    })
  }),
)

// @desc    Save payment methods for one or more countries
// @route   PUT /api/country-payment-methods
// @access  Private/Admin
router.put(
  "/",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    // Accepts either a single { countryId, paymentMethods } or { updates: [...] }
    const updates = Array.isArray(req.body?.updates)
      ? req.body.updates
      : [{ countryId: req.body?.countryId, paymentMethods: req.body?.paymentMethods }]

    if (updates.length === 0) {
      res.status(400)
      throw new Error("No changes were supplied")
    }

    const saved = []

    for (const update of updates) {
      const { countryId, paymentMethods } = update || {}

      if (!countryId) {
        res.status(400)
        throw new Error("A country is required for every change")
      }

      const methods = sanitizeMethods(paymentMethods)
      if (!methods) {
        res.status(400)
        throw new Error("Payment methods must be supplied as a list")
      }

      // A country with zero payment methods would leave checkout unusable there.
      // Deactivate the country instead of emptying it.
      if (methods.length === 0) {
        res.status(400)
        throw new Error(
          "At least one payment method must stay enabled. To stop selling in a country, deactivate it in Country Manager instead.",
        )
      }

      const country = await Country.findById(countryId)
      if (!country) {
        res.status(404)
        throw new Error("Country not found")
      }

      const previousMethods = sanitizeMethods(country.paymentMethods) || [...ALL_PAYMENT_METHODS]

      country.paymentMethods = methods
      country.updatedBy = req.user._id
      const updated = await country.save()

      const disabled = ALL_PAYMENT_METHODS.filter((m) => !methods.includes(m))

      await logActivity({
        user: req.user,
        action: "UPDATE",
        module: "COUNTRY_PAYMENT_METHODS",
        description: disabled.length
          ? `Disabled ${disabled.join(", ")} for ${updated.name} (${updated.code})`
          : `Enabled all payment methods for ${updated.name} (${updated.code})`,
        targetId: updated._id,
        targetName: updated.name,
        previousData: { paymentMethods: previousMethods },
        newData: { paymentMethods: methods },
        req,
      })

      saved.push({
        _id: updated._id,
        code: updated.code,
        name: updated.name,
        paymentMethods: methods,
        isConfigured: true,
      })
    }

    res.json({
      message:
        saved.length === 1
          ? `Payment methods updated for ${saved[0].name}`
          : `Payment methods updated for ${saved.length} countries`,
      countries: saved,
    })
  }),
)

// @desc    Clear a country's rule so every payment method is offered again
// @route   POST /api/country-payment-methods/reset
// @access  Private/Admin
router.post(
  "/reset",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const countryIds = Array.isArray(req.body?.countryIds)
      ? req.body.countryIds
      : [req.body?.countryId].filter(Boolean)

    if (countryIds.length === 0) {
      res.status(400)
      throw new Error("Select at least one country to reset")
    }

    const countries = await Country.find({ _id: { $in: countryIds } }, "code name")
    if (countries.length === 0) {
      res.status(404)
      throw new Error("Country not found")
    }

    await Country.updateMany(
      { _id: { $in: countries.map((c) => c._id) } },
      { $unset: { paymentMethods: "" }, $set: { updatedBy: req.user._id } },
    )

    await logActivity({
      user: req.user,
      action: "UPDATE",
      module: "COUNTRY_PAYMENT_METHODS",
      description: `Reset payment method rules for ${countries.map((c) => `${c.name} (${c.code})`).join(", ")}`,
      newData: { countryIds: countries.map((c) => String(c._id)) },
      req,
    })

    res.json({
      message:
        countries.length === 1
          ? `${countries[0].name} now offers every payment method`
          : `${countries.length} countries now offer every payment method`,
      countryIds: countries.map((c) => String(c._id)),
    })
  }),
)

export default router
