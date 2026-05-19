import express from "express"
import asyncHandler from "express-async-handler"
import ProductSystemOption from "../models/productSystemOptionModel.js"
import { protect, admin } from "../middleware/authMiddleware.js"

const router = express.Router()

const ROUTE_TYPE_TO_MODEL_TYPE = {
  series: "series",
  model: "model",
  make: "make",
  manufacturer: "manufacturer",
  "sold-by": "soldBy",
}

const escapeRegex = (value = "") => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const getOptionType = (routeType = "") => ROUTE_TYPE_TO_MODEL_TYPE[String(routeType).trim().toLowerCase()] || null

const validateTypeOrThrow = (req, res) => {
  const optionType = getOptionType(req.params.type)
  if (!optionType) {
    res.status(400)
    throw new Error("Invalid product option type")
  }
  return optionType
}

// @desc    Fetch product options by type (admin)
// @route   GET /api/product-system-options/admin/:type
// @access  Private/Admin
router.get(
  "/admin/:type",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const optionType = validateTypeOrThrow(req, res)
    const options = await ProductSystemOption.find({ optionType }).sort({ name: 1 })
    res.json(options)
  }),
)

// @desc    Fetch active product options by type (public)
// @route   GET /api/product-system-options/:type
// @access  Public
router.get(
  "/:type",
  asyncHandler(async (req, res) => {
    const optionType = validateTypeOrThrow(req, res)
    const options = await ProductSystemOption.find({ optionType, isActive: true }).sort({ name: 1 })
    res.json(options)
  }),
)

// @desc    Create product option
// @route   POST /api/product-system-options/:type
// @access  Private/Admin
router.post(
  "/:type",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const optionType = validateTypeOrThrow(req, res)
    const name = String(req.body?.name || "").trim()

    if (!name) {
      res.status(400)
      throw new Error("Name is required")
    }

    const duplicate = await ProductSystemOption.findOne({
      optionType,
      name: { $regex: `^${escapeRegex(name)}$`, $options: "i" },
    })
    if (duplicate) {
      res.status(400)
      throw new Error("This value already exists")
    }

    const createdOption = await ProductSystemOption.create({
      name,
      optionType,
      isActive: req.body?.isActive !== undefined ? Boolean(req.body.isActive) : true,
      createdBy: req.user._id,
    })

    res.status(201).json(createdOption)
  }),
)

// @desc    Update product option
// @route   PUT /api/product-system-options/:type/:id
// @access  Private/Admin
router.put(
  "/:type/:id",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const optionType = validateTypeOrThrow(req, res)
    const option = await ProductSystemOption.findById(req.params.id)

    if (!option || option.optionType !== optionType) {
      res.status(404)
      throw new Error("Item not found")
    }

    const nextName = req.body?.name !== undefined ? String(req.body.name).trim() : option.name
    if (!nextName) {
      res.status(400)
      throw new Error("Name is required")
    }

    const duplicate = await ProductSystemOption.findOne({
      _id: { $ne: option._id },
      optionType,
      name: { $regex: `^${escapeRegex(nextName)}$`, $options: "i" },
    })
    if (duplicate) {
      res.status(400)
      throw new Error("This value already exists")
    }

    option.name = nextName
    option.isActive = req.body?.isActive !== undefined ? Boolean(req.body.isActive) : option.isActive

    const updatedOption = await option.save()
    res.json(updatedOption)
  }),
)

// @desc    Delete product option
// @route   DELETE /api/product-system-options/:type/:id
// @access  Private/Admin
router.delete(
  "/:type/:id",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const optionType = validateTypeOrThrow(req, res)
    const option = await ProductSystemOption.findById(req.params.id)

    if (!option || option.optionType !== optionType) {
      res.status(404)
      throw new Error("Item not found")
    }

    await option.deleteOne()
    res.json({ message: "Item removed" })
  }),
)

export default router
