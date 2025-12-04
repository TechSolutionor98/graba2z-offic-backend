import express from "express"
import asyncHandler from "express-async-handler"
import Banner from "../models/bannerModel.js"
import Category from "../models/categoryModel.js"
import { protect, admin } from "../middleware/authMiddleware.js"
import { uploadBanner, deleteLocalFile, isCloudinaryUrl } from "../config/multer.js"

const router = express.Router()

// @desc    Get all banners (public)
// @route   GET /api/banners
// @access  Public
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { position, category, active } = req.query

    const query = {}

    if (position) {
      query.position = position
    }

    if (category) {
      query.category = category
    }

    if (active !== undefined) {
      query.isActive = active === "true"
    }

    const banners = await Banner.find(query).populate("category", "name slug").sort({ sortOrder: 1, createdAt: -1 })

    res.json(banners)
  }),
)

// @desc    Get all banners (admin)
// @route   GET /api/banners/admin
// @access  Private/Admin
router.get(
  "/admin",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const banners = await Banner.find({})
      .populate("category", "name slug")
      .populate("createdBy", "name email")
      .sort({ createdAt: -1 })

    res.json(banners)
  }),
)

// @desc    Get single banner
// @route   GET /api/banners/:id
// @access  Public
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const banner = await Banner.findById(req.params.id)
      .populate("category", "name slug")
      .populate("createdBy", "name email")

    if (banner) {
      res.json(banner)
    } else {
      res.status(404)
      throw new Error("Banner not found")
    }
  }),
)

// @desc    Create banner
// @route   POST /api/banners
// @access  Private/Admin
router.post(
  "/",
  protect,
  admin,
  uploadBanner.single("image"),
  asyncHandler(async (req, res) => {
    const { category, ...bannerData } = req.body

    // Verify category exists if provided and position is category
    if (bannerData.position === "category" && category) {
      const categoryExists = await Category.findById(category)
      if (!categoryExists) {
        res.status(400)
        throw new Error("Invalid category")
      }
    }

    const banner = new Banner({
      ...bannerData,
      category: bannerData.position === "category" ? category : null,
      createdBy: req.user._id,
    })

    const createdBanner = await banner.save()
    const populatedBanner = await Banner.findById(createdBanner._id)
      .populate("category", "name slug")
      .populate("createdBy", "name email")

    res.status(201).json(populatedBanner)
  }),
)

// @desc    Update banner
// @route   PUT /api/banners/:id
// @access  Private/Admin
router.put(
  "/:id",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const banner = await Banner.findById(req.params.id)

    if (banner) {
      const { category, ...updateData } = req.body

      // Verify category exists if provided and position is category
      if (updateData.position === "category" && category) {
        const categoryExists = await Category.findById(category)
        if (!categoryExists) {
          res.status(400)
          throw new Error("Invalid category")
        }
      }

      // Update banner fields
      Object.keys(updateData).forEach((key) => {
        banner[key] = updateData[key]
      })

      banner.category = updateData.position === "category" ? category : null

      const updatedBanner = await banner.save()
      const populatedBanner = await Banner.findById(updatedBanner._id)
        .populate("category", "name slug")
        .populate("createdBy", "name email")

      res.json(populatedBanner)
    } else {
      res.status(404)
      throw new Error("Banner not found")
    }
  }),
)

// @desc    Delete banner
// @route   DELETE /api/banners/:id
// @access  Private/Admin
router.delete(
  "/:id",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const banner = await Banner.findById(req.params.id)

    if (banner) {
      // Delete banner image from server
      if (banner.image && !isCloudinaryUrl(banner.image)) {
        try {
          await deleteLocalFile(banner.image)
        } catch (err) {
          console.error("Error deleting banner image:", err)
        }
      }

      await banner.deleteOne()
      res.json({ message: "Banner removed" })
    } else {
      res.status(404)
      throw new Error("Banner not found")
    }
  }),
)

export default router
