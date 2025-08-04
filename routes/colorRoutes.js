import express from "express"
import asyncHandler from "express-async-handler"
import Color from "../models/colorModel.js"
import { protect, admin } from "../middleware/authMiddleware.js"

const router = express.Router()

// @desc    Fetch all colors (Admin only - includes inactive)
// @route   GET /api/colors/admin
// @access  Private/Admin
router.get(
  "/admin",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const colors = await Color.find({ isDeleted: { $ne: true } }).sort({ sortOrder: 1, name: 1 })
    res.json(colors)
  }),
)

// @desc    Fetch all colors
// @route   GET /api/colors
// @access  Public
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const colors = await Color.find({ isActive: true, isDeleted: { $ne: true } }).sort({ sortOrder: 1, name: 1 })
    res.json(colors)
  }),
)

// @desc    Create a color
// @route   POST /api/colors
// @access  Private/Admin
router.post(
  "/",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const { name, hexCode } = req.body

    const color = new Color({
      name,
      hexCode,
      createdBy: req.user._id,
    })

    const createdColor = await color.save()
    res.status(201).json(createdColor)
  }),
)

// @desc    Update a color
// @route   PUT /api/colors/:id
// @access  Private/Admin
router.put(
  "/:id",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const color = await Color.findById(req.params.id)

    if (color) {
      const { name, hexCode, isActive } = req.body

      color.name = name || color.name
      color.hexCode = hexCode || color.hexCode
      color.isActive = isActive !== undefined ? isActive : color.isActive

      const updatedColor = await color.save()
      res.json(updatedColor)
    } else {
      res.status(404)
      throw new Error("Color not found")
    }
  }),
)

// @desc    Delete a color
// @route   DELETE /api/colors/:id
// @access  Private/Admin
router.delete(
  "/:id",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const color = await Color.findById(req.params.id)

    if (color) {
      await color.deleteOne()
      res.json({ message: "Color removed" })
    } else {
      res.status(404)
      throw new Error("Color not found")
    }
  }),
)

export default router
