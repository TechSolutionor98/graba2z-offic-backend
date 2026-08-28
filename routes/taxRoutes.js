import express from "express"
import asyncHandler from "express-async-handler"
import Tax from "../models/taxModel.js"
import { protect, admin } from "../middleware/authMiddleware.js"

const router = express.Router()

// "" is the default scope inherited by every country without its own tax.
const normalizeCountryCode = (value) => {
  const code = String(value ?? "").trim().toUpperCase()
  return code === "DEFAULT" || code === "ALL" ? "" : code
}

// @desc    Fetch all taxes (Admin only - includes inactive)
// @route   GET /api/tax/admin
// @access  Private/Admin
router.get(
  "/admin",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const filter = { isDeleted: { $ne: true } }
    if (req.query.countryCode !== undefined) {
      filter.countryCode = normalizeCountryCode(req.query.countryCode)
    }

    const taxes = await Tax.find(filter).sort({ sortOrder: 1, name: 1 })
    res.json(taxes)
  }),
)

// @desc    Fetch all taxes
// @route   GET /api/tax
// @access  Public
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const countryCode = normalizeCountryCode(req.query.countryCode)
    const base = { isActive: true, isDeleted: { $ne: true } }

    // A country with its own tax uses only that; otherwise it inherits the default.
    if (countryCode) {
      const countryTaxes = await Tax.find({ ...base, countryCode }).sort({ sortOrder: 1, name: 1 })
      if (countryTaxes.length > 0) {
        return res.json(countryTaxes)
      }
    }

    const defaultTaxes = await Tax.find({
      ...base,
      $or: [{ countryCode: "" }, { countryCode: { $exists: false } }, { countryCode: null }],
    }).sort({ sortOrder: 1, name: 1 })

    res.json(defaultTaxes)
  }),
)

// @desc    Create a tax
// @route   POST /api/tax
// @access  Private/Admin
router.post(
  "/",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const { name, rate, type, description, isActive } = req.body

    const tax = new Tax({
      name,
      rate,
      type,
      description,
      countryCode: normalizeCountryCode(req.body.countryCode),
      isActive: isActive !== undefined ? isActive : true,
      createdBy: req.user._id,
    })

    const createdTax = await tax.save()
    res.status(201).json(createdTax)
  }),
)

// @desc    Update a tax
// @route   PUT /api/tax/:id
// @access  Private/Admin
router.put(
  "/:id",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const tax = await Tax.findById(req.params.id)

    if (tax) {
      const { name, rate, type, description, isActive } = req.body

      tax.name = name || tax.name
      tax.rate = rate !== undefined ? rate : tax.rate
      tax.type = type || tax.type
      tax.description = description || tax.description
      tax.isActive = isActive !== undefined ? isActive : tax.isActive
      if (req.body.countryCode !== undefined) {
        tax.countryCode = normalizeCountryCode(req.body.countryCode)
      }

      const updatedTax = await tax.save()
      res.json(updatedTax)
    } else {
      res.status(404)
      throw new Error("Tax not found")
    }
  }),
)

// @desc    Delete a tax
// @route   DELETE /api/tax/:id
// @access  Private/Admin
router.delete(
  "/:id",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const tax = await Tax.findById(req.params.id)

    if (tax) {
      await tax.deleteOne()
      res.json({ message: "Tax removed" })
    } else {
      res.status(404)
      throw new Error("Tax not found")
    }
  }),
)

export default router
