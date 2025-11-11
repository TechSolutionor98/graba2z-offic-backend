import express from "express"
import asyncHandler from "express-async-handler"
import Category from "../models/categoryModel.js"
import SubCategory from "../models/subCategoryModel.js"
import { protect, admin } from "../middleware/authMiddleware.js"

const router = express.Router()

// @desc    Fetch all categories (Admin only - includes inactive)
// @route   GET /api/categories/admin
// @access  Private/Admin
router.get(
  "/admin",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const categories = await Category.find({ isDeleted: { $ne: true } }).sort({ sortOrder: 1, name: 1 })
    res.json(categories)
  }),
)

// @desc    Fetch all categories
// @route   GET /api/categories
// @access  Public
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const categories = await Category.find({ isActive: true, isDeleted: { $ne: true } }).sort({ sortOrder: 1, name: 1 })
    res.json(categories)
  }),
)

// @desc    Fetch categories with nested subcategories up to 4 levels
// @route   GET /api/categories/tree
// @access  Public
router.get(
  "/tree",
  asyncHandler(async (req, res) => {
    try {
      // Load active, non-deleted categories and subcategories
      const [cats, subs] = await Promise.all([
        Category.find({ isActive: true, isDeleted: { $ne: true } })
          .select("_id name slug sortOrder")
          .sort({ sortOrder: 1, name: 1 })
          .lean(),
        SubCategory.find({ isActive: true, isDeleted: { $ne: true } })
          .select("_id name slug category parentSubCategory level sortOrder")
          .sort({ sortOrder: 1, name: 1 })
          .lean(),
      ])

      // Prepare category nodes
      const catMap = new Map()
      for (const c of cats) {
        catMap.set(String(c._id), { _id: c._id, name: c.name, slug: c.slug, children: [] })
      }

      // Prepare subcategory nodes
      const subMap = new Map()
      for (const s of subs) {
        const level = s.level || 1
        subMap.set(String(s._id), {
          _id: s._id,
          name: s.name,
          slug: s.slug,
          level,
          category: s.category ? String(s.category) : null,
          parentSubCategory: s.parentSubCategory ? String(s.parentSubCategory) : null,
          children: [],
        })
      }

      // Link subcategories to parents with basic cycle safety
      for (const node of subMap.values()) {
        const parentSubId = node.parentSubCategory
        if (parentSubId && subMap.has(parentSubId)) {
          // Avoid self-reference cycles
          if (String(parentSubId) !== String(node._id)) {
            subMap.get(parentSubId).children.push(node)
          }
        } else {
          // Treat as level 1 (or missing parent) -> attach to category root
          const catId = node.category
          if (catId && catMap.has(catId)) {
            catMap.get(catId).children.push(node)
          }
        }
      }

      // Sort children arrays by name for stability with cycle protection
      const sortChildren = (arr, seen = new Set(), depth = 0) => {
        if (!Array.isArray(arr) || arr.length === 0) return
        // Guard against unreasonable depth (corrupt data)
        if (depth > 10) return
        arr.sort((a, b) => a.name.localeCompare(b.name))
        for (const n of arr) {
          const idStr = String(n._id)
          if (seen.has(idStr)) continue
          seen.add(idStr)
          if (Array.isArray(n.children) && n.children.length > 0) {
            sortChildren(n.children, seen, depth + 1)
          }
          seen.delete(idStr)
        }
      }

      for (const cat of catMap.values()) {
        if (Array.isArray(cat.children)) sortChildren(cat.children)
      }

      return res.json(Array.from(catMap.values()))
    } catch (err) {
      console.error('Error building category tree:', {
        message: err.message,
        stack: err.stack,
      })
      // Fail soft with empty array to avoid breaking pages
      return res.json([])
    }
  }),
)

// @desc    Get all trashed (soft-deleted) categories
// @route   GET /api/categories/trash
// @access  Private/Admin
router.get(
  "/trash",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const trashedCategories = await Category.find({ isDeleted: true }).sort({ deletedAt: -1 })
    res.json(trashedCategories)
  })
)

// @desc    Fetch single category
// @route   GET /api/categories/:id
// @access  Public
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const category = await Category.findById(req.params.id)

    if (category && category.isActive !== false) {
      res.json(category)
    } else {
      res.status(404)
      throw new Error("Category not found")
    }
  }),
)

// @desc    Create a category
// @route   POST /api/categories
// @access  Private/Admin
router.post(
  "/",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const { name, description, seoContent, metaTitle, metaDescription, redirectUrl, image, slug } = req.body

    if (!name || name.trim() === "") {
      res.status(400)
      throw new Error("Category name is required")
    }

    // Check if category with same name already exists
    const existingCategory = await Category.findOne({
      name: { $regex: new RegExp(`^${name.trim()}$`, "i") },
    })

    if (existingCategory) {
      res.status(400)
      throw new Error("Category with this name already exists")
    }

    // Generate slug if not provided
    const categorySlug = slug || name.trim().toLowerCase().replace(/\s+/g, "-")

    const category = new Category({
      name: name.trim(),
      description: description || "",
      seoContent: seoContent || "",
      metaTitle: metaTitle || "",
      metaDescription: metaDescription || "",
      redirectUrl: redirectUrl || "",
      image: image || "",
      slug: categorySlug,
      isActive: true,
      createdBy: req.user._id,
    })

    const createdCategory = await category.save()
    res.status(201).json(createdCategory)
  }),
)

// @desc    Update a category
// @route   PUT /api/categories/:id
// @access  Private/Admin
router.put(
  "/:id",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const { name, description, seoContent, metaTitle, metaDescription, redirectUrl, image, slug, isActive } = req.body

    const category = await Category.findById(req.params.id)

    if (category) {
      // Check if another category with same name exists (excluding current)
      if (name && name.trim() !== category.name) {
        const existingCategory = await Category.findOne({
          name: { $regex: new RegExp(`^${name.trim()}$`, "i") },
          _id: { $ne: req.params.id },
        })

        if (existingCategory) {
          res.status(400)
          throw new Error("Category with this name already exists")
        }
      }

      category.name = name?.trim() || category.name
      category.description = description !== undefined ? description : category.description
      category.seoContent = seoContent !== undefined ? seoContent : category.seoContent
      category.metaTitle = metaTitle !== undefined ? metaTitle : category.metaTitle
      category.metaDescription = metaDescription !== undefined ? metaDescription : category.metaDescription
      category.redirectUrl = redirectUrl !== undefined ? redirectUrl : category.redirectUrl
      category.image = image !== undefined ? image : category.image
      category.slug = slug || category.slug
      category.isActive = isActive !== undefined ? isActive : category.isActive

      const updatedCategory = await category.save()
      res.json(updatedCategory)
    } else {
      res.status(404)
      throw new Error("Category not found")
    }
  }),
)

// @desc    Delete a category
// @route   DELETE /api/categories/:id
// @access  Private/Admin
router.delete(
  "/:id",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const category = await Category.findById(req.params.id)

    if (category) {
      // Soft delete - mark as deleted instead of removing
      category.isDeleted = true
      category.isActive = false
      await category.save()

      res.json({ message: "Category deleted successfully" })
    } else {
      res.status(404)
      throw new Error("Category not found")
    }
  }),
)

// @desc    Restore a category from trash
// @route   PUT /api/categories/:id/restore
// @access  Private/Admin
router.put(
  "/:id/restore",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const category = await Category.findById(req.params.id)

    if (category) {
      category.isDeleted = false
      category.deletedAt = null
      await category.save()

      res.json({ message: "Category restored successfully", category })
    } else {
      res.status(404)
      throw new Error("Category not found")
    }
  }),
)

// @desc    Permanently delete a category
// @route   DELETE /api/categories/:id/permanent
// @access  Private/Admin
router.delete(
  "/:id/permanent",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const category = await Category.findById(req.params.id)

    if (category) {
      // Permanently delete from database
      await Category.findByIdAndDelete(req.params.id)
      res.json({ message: "Category permanently deleted" })
    } else {
      res.status(404)
      throw new Error("Category not found")
    }
  }),
)

// @desc    Get categories with product count
// @route   GET /api/categories/with-count
// @access  Public
router.get(
  "/with-count",
  asyncHandler(async (req, res) => {
    const categories = await Category.aggregate([
      {
        $match: {
          isActive: { $ne: false },
          isDeleted: { $ne: true },
        },
      },
      {
        $lookup: {
          from: "products",
          localField: "_id",
          foreignField: "category",
          as: "products",
        },
      },
      {
        $addFields: {
          productCount: { $size: "$products" },
        },
      },
      {
        $project: {
          products: 0,
        },
      },
      {
        $sort: { createdAt: -1 },
      },
    ])

    res.json(categories)
  }),
)

export default router
