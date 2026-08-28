import asyncHandler from "express-async-handler"
import PaymentMethodCharge from "../models/paymentMethodChargeModel.js"

// "" is the default rule inherited by every country without its own.
const normalizeCountryCode = (value) => {
  const code = String(value ?? "").trim().toUpperCase()
  return code === "DEFAULT" || code === "ALL" ? "" : code
}

// @desc    Get all payment method charges (every country scope)
// @route   GET /api/payment-charges
// @access  Public
export const getPaymentCharges = asyncHandler(async (req, res) => {
  const filter = {}

  // Optional scoping, e.g. ?countryCode=KW or ?countryCode=DEFAULT
  if (req.query.countryCode !== undefined) {
    filter.countryCode = normalizeCountryCode(req.query.countryCode)
  }

  const charges = await PaymentMethodCharge.find(filter)
  res.json(charges)
})

/**
 * Resolve the charges a shopper in a country actually pays.
 *
 * A country-specific rule wins; otherwise the default rule applies. Only active
 * rules are considered, and an active country rule with no charges deliberately
 * suppresses the default one - that is how a country opts out of a fee.
 */
// @desc    Get active payment method charges for a country
// @route   GET /api/payment-charges/active?countryCode=AE
// @access  Public
export const getActivePaymentCharges = asyncHandler(async (req, res) => {
  const countryCode = normalizeCountryCode(req.query.countryCode)

  const scopes = countryCode ? ["", countryCode] : [""]
  const charges = await PaymentMethodCharge.find({
    isActive: true,
    countryCode: { $in: scopes },
  }).lean()

  const byMethod = new Map()
  for (const charge of charges) {
    const existing = byMethod.get(charge.paymentMethod)
    const isCountrySpecific = (charge.countryCode || "") !== ""

    // Country rules override the default; otherwise first one wins.
    if (!existing || isCountrySpecific) {
      byMethod.set(charge.paymentMethod, charge)
    }
  }

  res.json([...byMethod.values()])
})

// @desc    Get payment method charge by ID
// @route   GET /api/payment-charges/:id
// @access  Private/Admin
export const getPaymentChargeById = asyncHandler(async (req, res) => {
  const charge = await PaymentMethodCharge.findById(req.params.id)

  if (charge) {
    res.json(charge)
  } else {
    res.status(404)
    throw new Error("Payment method charge not found")
  }
})

// @desc    Create a new payment method charge
// @route   POST /api/payment-charges
// @access  Private/Admin
export const createPaymentCharge = asyncHandler(async (req, res) => {
  const { paymentMethod, description, charges, isActive } = req.body
  const countryCode = normalizeCountryCode(req.body.countryCode)

  const chargeExists = await PaymentMethodCharge.findOne({ paymentMethod, countryCode })

  if (chargeExists) {
    res.status(400)
    throw new Error(
      countryCode
        ? `Charges for this payment method already exist for ${countryCode}. Please update instead.`
        : "Default charges for this payment method already exist. Please update instead.",
    )
  }

  const paymentCharge = new PaymentMethodCharge({
    paymentMethod,
    countryCode,
    description,
    charges,
    isActive,
    updatedBy: req.user._id,
  })

  const createdCharge = await paymentCharge.save()
  res.status(201).json(createdCharge)
})

// @desc    Update a payment method charge
// @route   PUT /api/payment-charges/:id
// @access  Private/Admin
export const updatePaymentCharge = asyncHandler(async (req, res) => {
  const { description, charges, isActive } = req.body

  const paymentCharge = await PaymentMethodCharge.findById(req.params.id)

  if (paymentCharge) {
    paymentCharge.description = description !== undefined ? description : paymentCharge.description
    paymentCharge.charges = charges !== undefined ? charges : paymentCharge.charges
    paymentCharge.isActive = isActive !== undefined ? isActive : paymentCharge.isActive
    // countryCode is the identity of the row and is never reassigned on update.
    paymentCharge.updatedBy = req.user._id

    const updatedCharge = await paymentCharge.save()
    res.json(updatedCharge)
  } else {
    res.status(404)
    throw new Error("Payment method charge not found")
  }
})

// @desc    Delete a payment method charge
// @route   DELETE /api/payment-charges/:id
// @access  Private/Admin
export const deletePaymentCharge = asyncHandler(async (req, res) => {
  const paymentCharge = await PaymentMethodCharge.findById(req.params.id)

  if (paymentCharge) {
    await PaymentMethodCharge.deleteOne({ _id: paymentCharge._id })
    res.json({ message: "Payment method charge removed" })
  } else {
    res.status(404)
    throw new Error("Payment method charge not found")
  }
})
