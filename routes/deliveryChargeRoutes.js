import express from "express"
import asyncHandler from "express-async-handler"
import DeliveryCharge from "../models/deliveryChargeModel.js"
import { protect, admin } from "../middleware/authMiddleware.js"

const router = express.Router()

/**
 * Clean up the bands an admin submitted.
 *
 * Anything without a usable charge is dropped rather than stored, and a ceiling of 0 or
 * blank is recorded as null ("no ceiling") -- a band capped at zero could never apply, so
 * it is far more likely to mean the field was left empty.
 */
const sanitizeRules = (rules) => {
  if (!Array.isArray(rules)) return []

  return rules
    .map((rule) => {
      const min = Math.max(0, Number(rule?.minOrderAmount) || 0)
      const rawMax = rule?.maxOrderAmount
      const max =
        rawMax === null || rawMax === undefined || rawMax === "" || Number(rawMax) <= 0 ? null : Number(rawMax)
      const charge = Number(rule?.charge)

      return { minOrderAmount: min, maxOrderAmount: max, charge: Number.isFinite(charge) ? Math.max(0, charge) : null }
    })
    .filter((rule) => rule.charge !== null)
    .filter((rule) => rule.maxOrderAmount === null || rule.maxOrderAmount >= rule.minOrderAmount)
    .sort((a, b) => a.minOrderAmount - b.minOrderAmount)
}

// @desc    Get all delivery charges (with optional country filtering)
// @route   GET /api/delivery-charges
// @access  Public
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { country, countryCode } = req.query
    let filter = { isActive: true }

    if (country || countryCode) {
      const countryQuery = []
      if (country) {
        countryQuery.push({ country: { $regex: new RegExp(`^${country}$`, "i") } })
      }
      if (countryCode) {
        countryQuery.push({ countryCode: { $regex: new RegExp(`^${countryCode}$`, "i") } })
      }

      let deliveryCharges = await DeliveryCharge.find({
        isActive: true,
        $or: countryQuery,
      }).sort({ createdAt: -1 })

      // If no country-specific match found, check for international/fallback rules or legacy default rules
      if (deliveryCharges.length === 0) {
        deliveryCharges = await DeliveryCharge.find({
          isActive: true,
          $or: [
            { isInternational: true },
            { country: "International" },
            { country: "All Other Countries" },
            { country: "United Arab Emirates" },
            { country: { $exists: false } },
          ],
        }).sort({ createdAt: -1 })
      }

      res.json(deliveryCharges)
    } else {
      const deliveryCharges = await DeliveryCharge.find({ isActive: true }).sort({ createdAt: -1 })
      res.json(deliveryCharges)
    }
  }),
)

// @desc    Get all delivery charges (Admin)
// @route   GET /api/delivery-charges/admin
// @access  Private/Admin
router.get(
  "/admin",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const deliveryCharges = await DeliveryCharge.find({}).populate("createdBy", "name email").sort({ createdAt: -1 })
    res.json(deliveryCharges)
  }),
)

// @desc    Get single delivery charge
// @route   GET /api/delivery-charges/:id
// @access  Public
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const deliveryCharge = await DeliveryCharge.findById(req.params.id)

    if (deliveryCharge) {
      res.json(deliveryCharge)
    } else {
      res.status(404)
      throw new Error("Delivery charge not found")
    }
  }),
)

// @desc    Create delivery charge
// @route   POST /api/delivery-charges
// @access  Private/Admin
router.post(
  "/",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const {
      name,
      description,
      charge,
      minOrderAmount,
      maxOrderAmount,
      applicableAreas,
      deliveryTime,
      country,
      countryCode,
      isInternational,
      rules,
    } = req.body

    const deliveryChargeData = {
      name,
      description,
      charge: Number(charge),
      minOrderAmount: Number(minOrderAmount) || 0,
      maxOrderAmount: maxOrderAmount ? Number(maxOrderAmount) : null,
      applicableAreas: applicableAreas || [],
      deliveryTime: deliveryTime || "1-2 business days",
      country: country || "United Arab Emirates",
      countryCode: countryCode || "AE",
      isInternational: isInternational !== undefined ? Boolean(isInternational) : false,
      rules: sanitizeRules(rules),
      createdBy: req.user._id,
    }

    const deliveryChargeExists = await DeliveryCharge.findOne({
      name: { $regex: new RegExp(`^${name}$`, "i") },
      country: { $regex: new RegExp(`^${deliveryChargeData.country}$`, "i") },
    })

    if (deliveryChargeExists) {
      res.status(400)
      throw new Error("Delivery charge with this name for this country already exists")
    }

    const deliveryCharge = await DeliveryCharge.create(deliveryChargeData)
    res.status(201).json(deliveryCharge)
  }),
)

// @desc    Update delivery charge
// @route   PUT /api/delivery-charges/:id
// @access  Private/Admin
router.put(
  "/:id",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const {
      name,
      description,
      charge,
      minOrderAmount,
      maxOrderAmount,
      applicableAreas,
      deliveryTime,
      isActive,
      country,
      countryCode,
      isInternational,
      rules,
    } = req.body

    const deliveryCharge = await DeliveryCharge.findById(req.params.id)

    if (deliveryCharge) {
      const targetCountry = country || deliveryCharge.country || "United Arab Emirates"

      // Check if name & country already exists (excluding current record)
      if (name && (name !== deliveryCharge.name || targetCountry !== deliveryCharge.country)) {
        const nameExists = await DeliveryCharge.findOne({
          name: { $regex: new RegExp(`^${name}$`, "i") },
          country: { $regex: new RegExp(`^${targetCountry}$`, "i") },
          _id: { $ne: req.params.id },
        })

        if (nameExists) {
          res.status(400)
          throw new Error("Delivery charge with this name for this country already exists")
        }
      }

      deliveryCharge.name = name || deliveryCharge.name
      deliveryCharge.description = description !== undefined ? description : deliveryCharge.description
      deliveryCharge.charge = charge !== undefined ? Number(charge) : deliveryCharge.charge
      deliveryCharge.minOrderAmount =
        minOrderAmount !== undefined ? Number(minOrderAmount) : deliveryCharge.minOrderAmount
      deliveryCharge.maxOrderAmount =
        maxOrderAmount !== undefined ? (maxOrderAmount ? Number(maxOrderAmount) : null) : deliveryCharge.maxOrderAmount
      deliveryCharge.applicableAreas = applicableAreas || deliveryCharge.applicableAreas
      deliveryCharge.deliveryTime = deliveryTime || deliveryCharge.deliveryTime
      deliveryCharge.isActive = isActive !== undefined ? isActive : deliveryCharge.isActive
      deliveryCharge.country = country !== undefined ? country : deliveryCharge.country
      deliveryCharge.countryCode = countryCode !== undefined ? countryCode : deliveryCharge.countryCode
      deliveryCharge.isInternational = isInternational !== undefined ? Boolean(isInternational) : deliveryCharge.isInternational
      // An explicit empty array is how an admin removes the bands and goes back to the
      // single charge, so it has to be distinguishable from the field being absent.
      if (rules !== undefined) {
        deliveryCharge.rules = sanitizeRules(rules)
      }

      const updatedDeliveryCharge = await deliveryCharge.save()
      res.json(updatedDeliveryCharge)
    } else {
      res.status(404)
      throw new Error("Delivery charge not found")
    }
  }),
)

// @desc    Delete delivery charge
// @route   DELETE /api/delivery-charges/:id
// @access  Private/Admin
router.delete(
  "/:id",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const deliveryCharge = await DeliveryCharge.findById(req.params.id)

    if (deliveryCharge) {
      await deliveryCharge.deleteOne()
      res.json({ message: "Delivery charge removed successfully" })
    } else {
      res.status(404)
      throw new Error("Delivery charge not found")
    }
  }),
)

// @desc    Toggle delivery charge status
// @route   PATCH /api/delivery-charges/:id/toggle
// @access  Private/Admin
router.patch(
  "/:id/toggle",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const deliveryCharge = await DeliveryCharge.findById(req.params.id)

    if (deliveryCharge) {
      deliveryCharge.isActive = !deliveryCharge.isActive
      const updatedDeliveryCharge = await deliveryCharge.save()
      res.json(updatedDeliveryCharge)
    } else {
      res.status(404)
      throw new Error("Delivery charge not found")
    }
  }),
)

export default router
