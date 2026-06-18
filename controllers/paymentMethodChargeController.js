import asyncHandler from "express-async-handler"
import PaymentMethodCharge from "../models/paymentMethodChargeModel.js"

// @desc    Get all payment method charges
// @route   GET /api/payment-charges
// @access  Public
export const getPaymentCharges = asyncHandler(async (req, res) => {
  const charges = await PaymentMethodCharge.find({})
  res.json(charges)
})

// @desc    Get active payment method charges
// @route   GET /api/payment-charges/active
// @access  Public
export const getActivePaymentCharges = asyncHandler(async (req, res) => {
  const charges = await PaymentMethodCharge.find({ isActive: true })
  res.json(charges)
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

  const chargeExists = await PaymentMethodCharge.findOne({ paymentMethod })

  if (chargeExists) {
    res.status(400)
    throw new Error("Charges for this payment method already exist. Please update instead.")
  }

  const paymentCharge = new PaymentMethodCharge({
    paymentMethod,
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
