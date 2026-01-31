import express from "express"
import asyncHandler from "express-async-handler"
import Brand from "../models/brandModel.js"
import { protect, admin } from "../middleware/authMiddleware.js"
import { deleteLocalFile, isCloudinaryUrl } from "../config/multer.js"
import { logActivity } from "../middleware/permissionMiddleware.js"
import { cacheMiddleware, invalidateCache } from "../middleware/cacheMiddleware.js"

const router = express.Router()

// @desc    Fetch all brands (Admin only - includes inactive)
// @route   GET /api/brands/admin
// @access  Private/Admin
router.get(
  "/admin",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const brands = await Brand.find({ isDeleted: { $ne: true } }).sort({ sortOrder: 1, name: 1 })
    res.json(brands)
  }),
)

// @desc    Fetch all brands
// @route   GET /api/brands
// @access  Public
router.get(
  "/",
  cacheMiddleware('brands'),
  asyncHandler(async (req, res) => {
    const brands = await Brand.find({ isActive: true, isDeleted: { $ne: true } }).sort({ sortOrder: 1, name: 1 })
    res.json(brands)
  }),
)

// @desc    Create a brand
// @route   POST /api/brands
// @access  Private/Admin
router.post(
  "/",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const { name, description, logo, website, sortOrder } = req.body

    // Generate slug from name
    const slug = name
      .toLowerCase()
      .replace(/[^a-zA-Z0-9]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")

    const brand = new Brand({
      name,
      slug,
      description,
      logo,
      website,
      sortOrder,
      createdBy: req.user._id,
    })

    const createdBrand = await brand.save()

    // Log activity
    await logActivity(req, "CREATE", "BRANDS", `Created brand: ${createdBrand.name}`, createdBrand._id, createdBrand.name)

    // Invalidate brand cache
    await invalidateCache(['brands', 'products'])

    res.status(201).json(createdBrand)
  }),
)

// @desc    Update a brand
// @route   PUT /api/brands/:id
// @access  Private/Admin
router.put(
  "/:id",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const brand = await Brand.findById(req.params.id)

    if (brand) {
      const { name, description, logo, website, isActive, sortOrder } = req.body

      brand.name = name || brand.name
      brand.description = description || brand.description
      brand.logo = logo || brand.logo
      brand.website = website || brand.website
      brand.isActive = isActive !== undefined ? isActive : brand.isActive
      brand.sortOrder = sortOrder !== undefined ? sortOrder : brand.sortOrder

      // Update slug if name changed
      if (name && name !== brand.name) {
        brand.slug = name
          .toLowerCase()
          .replace(/[^a-zA-Z0-9]/g, "-")
          .replace(/-+/g, "-")
          .replace(/^-|-$/g, "")
      }

      const updatedBrand = await brand.save()

      // Log activity
      await logActivity(req, "UPDATE", "BRANDS", `Updated brand: ${updatedBrand.name}`, updatedBrand._id, updatedBrand.name)

      // Invalidate brand cache
      await invalidateCache(['brands', 'products'])

      res.json(updatedBrand)
    } else {
      res.status(404)
      throw new Error("Brand not found")
    }
  }),
)

// @desc    Delete a brand
// @route   DELETE /api/brands/:id
// @access  Private/Admin
router.delete(
  "/:id",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const brand = await Brand.findById(req.params.id)

    if (brand) {
      const brandName = brand.name
      const brandId = brand._id

      // Delete brand logo
      if (brand.logo && !isCloudinaryUrl(brand.logo)) {
        try {
          await deleteLocalFile(brand.logo)
        } catch (err) {
          console.error("Error deleting brand logo:", err)
        }
      }

      await brand.deleteOne()

      // Log activity
      await logActivity(req, "DELETE", "BRANDS", `Deleted brand: ${brandName}`, brandId, brandName)

      // Invalidate brand cache
      await invalidateCache(['brands', 'products'])

      res.json({ message: "Brand removed" })
    } else {
      res.status(404)
      throw new Error("Brand not found")
    }
  }),
)

// @desc    Get a single brand by ID
// @route   GET /api/brands/:id
// @access  Private/Admin
router.get(
  "/:id",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const brand = await Brand.findById(req.params.id)
    if (brand) {
      res.json(brand)
    } else {
      res.status(404)
      throw new Error("Brand not found")
    }
  })
)

export default router
