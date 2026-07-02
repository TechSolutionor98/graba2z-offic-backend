import express from "express"
import asyncHandler from "express-async-handler"
import Product from "../models/productModel.js"
import Category from "../models/categoryModel.js"
import SubCategory from "../models/subCategoryModel.js"
import Brand from "../models/brandModel.js"
import { protect, admin } from "../middleware/authMiddleware.js"

const router = express.Router()

// Helper to resolve payment methods for a single product
const resolveProductPaymentMethods = async (productId) => {
  const product = await Product.findById(productId)
    .populate("parentCategory")
    .populate("category")
    .populate("subCategory2")
    .populate("subCategory3")
    .populate("subCategory4")
    .populate("brand")

  if (!product) {
    return ["card", "cod"]
  }

  // 1. Product specific
  if (product.paymentMethods && product.paymentMethods.length > 0) {
    return product.paymentMethods
  }

  // 2. Subcategory Level 4
  if (product.subCategory4 && product.subCategory4.paymentMethods && product.subCategory4.paymentMethods.length > 0) {
    return product.subCategory4.paymentMethods
  }

  // 3. Subcategory Level 3
  if (product.subCategory3 && product.subCategory3.paymentMethods && product.subCategory3.paymentMethods.length > 0) {
    return product.subCategory3.paymentMethods
  }

  // 4. Subcategory Level 2
  if (product.subCategory2 && product.subCategory2.paymentMethods && product.subCategory2.paymentMethods.length > 0) {
    return product.subCategory2.paymentMethods
  }

  // 5. Subcategory Level 1 (category)
  if (product.category && product.category.paymentMethods && product.category.paymentMethods.length > 0) {
    return product.category.paymentMethods
  }

  // 6. Parent Category
  if (product.parentCategory && product.parentCategory.paymentMethods && product.parentCategory.paymentMethods.length > 0) {
    return product.parentCategory.paymentMethods
  }

  // 7. Brand
  if (product.brand && product.brand.paymentMethods && product.brand.paymentMethods.length > 0) {
    return product.brand.paymentMethods
  }

  // Default fallback
  return ["card", "cod"]
}

// @desc    Resolve payment methods for a list of product IDs (takes intersection)
// @route   POST /api/product-payment-methods/resolve
// @access  Public
router.post(
  "/resolve",
  asyncHandler(async (req, res) => {
    const { productIds } = req.body

    if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
      return res.json({ paymentMethods: ["card", "cod"] })
    }

    try {
      const resolvedList = []
      for (const id of productIds) {
        if (id) {
          const methods = await resolveProductPaymentMethods(id)
          resolvedList.push(methods)
        }
      }

      if (resolvedList.length === 0) {
        return res.json({ paymentMethods: ["card", "cod"] })
      }

      // Compute intersection
      let intersection = [...resolvedList[0]]
      for (let i = 1; i < resolvedList.length; i++) {
        intersection = intersection.filter((method) => resolvedList[i].includes(method))
      }

      res.json({ paymentMethods: intersection })
    } catch (error) {
      console.error("Error resolving payment methods:", error)
      res.status(500).json({ message: "Failed to resolve payment methods", error: error.message })
    }
  }),
)

// @desc    Get all custom payment configurations for the admin page
// @route   GET /api/product-payment-methods/config
// @access  Private/Admin
router.get(
  "/config",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    try {
      // Find all entities with custom payment methods configured
      const products = await Product.find({ paymentMethods: { $exists: true, $ne: [] } }, "name paymentMethods")
      const categories = await Category.find({ paymentMethods: { $exists: true, $ne: [] } }, "name paymentMethods")
      const subCategories = await SubCategory.find({ paymentMethods: { $exists: true, $ne: [] } }, "name level paymentMethods")
      const brands = await Brand.find({ paymentMethods: { $exists: true, $ne: [] } }, "name paymentMethods")

      res.json({
        products,
        categories,
        subCategories,
        brands,
      })
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch configurations", error: error.message })
    }
  }),
)

// @desc    Save custom payment methods for an entity
// @route   POST /api/product-payment-methods/save
// @access  Private/Admin
router.post(
  "/save",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const { entityType, entityId, paymentMethods } = req.body

    if (!entityType || !entityId || !paymentMethods || !Array.isArray(paymentMethods)) {
      return res.status(400).json({ message: "Missing required fields" })
    }

    try {
      let updatedEntity = null

      if (entityType === "product") {
        if (entityId === "all") {
          updatedEntity = await Product.updateMany({}, { paymentMethods })
          return res.json({ message: "Configurations saved successfully for all products", updatedCount: updatedEntity.modifiedCount })
        } else if (Array.isArray(entityId)) {
          updatedEntity = await Product.updateMany({ _id: { $in: entityId } }, { paymentMethods })
          return res.json({ message: "Configurations saved successfully", updatedCount: updatedEntity.modifiedCount })
        } else {
          updatedEntity = await Product.findByIdAndUpdate(entityId, { paymentMethods }, { new: true })
        }
      } else if (entityType === "category") {
        updatedEntity = await Category.findByIdAndUpdate(entityId, { paymentMethods }, { new: true })
      } else if (entityType === "subcategory") {
        updatedEntity = await SubCategory.findByIdAndUpdate(entityId, { paymentMethods }, { new: true })
      } else if (entityType === "brand") {
        updatedEntity = await Brand.findByIdAndUpdate(entityId, { paymentMethods }, { new: true })
      } else {
        return res.status(400).json({ message: "Invalid entity type" })
      }

      if (!updatedEntity) {
        return res.status(404).json({ message: `${entityType} not found` })
      }

      res.json({ message: "Configuration saved successfully", entity: updatedEntity })
    } catch (error) {
      res.status(500).json({ message: "Failed to save configuration", error: error.message })
    }
  }),
)

// @desc    Reset/Delete custom payment methods for an entity
// @route   POST /api/product-payment-methods/reset
// @access  Private/Admin
router.post(
  "/reset",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const { entityType, entityId } = req.body

    if (!entityType || !entityId) {
      return res.status(400).json({ message: "Missing required fields" })
    }

    try {
      let updatedEntity = null

      if (entityType === "product") {
        updatedEntity = await Product.findByIdAndUpdate(entityId, { $unset: { paymentMethods: "" } }, { new: true })
      } else if (entityType === "category") {
        updatedEntity = await Category.findByIdAndUpdate(entityId, { $unset: { paymentMethods: "" } }, { new: true })
      } else if (entityType === "subcategory") {
        updatedEntity = await SubCategory.findByIdAndUpdate(entityId, { $unset: { paymentMethods: "" } }, { new: true })
      } else if (entityType === "brand") {
        updatedEntity = await Brand.findByIdAndUpdate(entityId, { $unset: { paymentMethods: "" } }, { new: true })
      } else {
        return res.status(400).json({ message: "Invalid entity type" })
      }

      if (!updatedEntity) {
        return res.status(404).json({ message: `${entityType} not found` })
      }

      res.json({ message: "Configuration reset successfully" })
    } catch (error) {
      res.status(500).json({ message: "Failed to reset configuration", error: error.message })
    }
  }),
)

// @desc    Bulk Reset custom payment methods for an array of entities
// @route   POST /api/product-payment-methods/bulk-reset
// @access  Private/Admin
router.post(
  "/bulk-reset",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const { items } = req.body // Array of { entityType, entityId }

    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ message: "Items array is required" })
    }

    try {
      const productIds = items.filter((i) => i.entityType === "product").map((i) => i.entityId)
      const categoryIds = items.filter((i) => i.entityType === "category").map((i) => i.entityId)
      const subCategoryIds = items.filter((i) => i.entityType === "subcategory").map((i) => i.entityId)
      const brandIds = items.filter((i) => i.entityType === "brand").map((i) => i.entityId)

      if (productIds.length > 0) {
        await Product.updateMany({ _id: { $in: productIds } }, { $unset: { paymentMethods: "" } })
      }
      if (categoryIds.length > 0) {
        await Category.updateMany({ _id: { $in: categoryIds } }, { $unset: { paymentMethods: "" } })
      }
      if (subCategoryIds.length > 0) {
        await SubCategory.updateMany({ _id: { $in: subCategoryIds } }, { $unset: { paymentMethods: "" } })
      }
      if (brandIds.length > 0) {
        await Brand.updateMany({ _id: { $in: brandIds } }, { $unset: { paymentMethods: "" } })
      }

      res.json({ message: "Bulk reset completed successfully" })
    } catch (error) {
      res.status(500).json({ message: "Failed to bulk reset configuration", error: error.message })
    }
  }),
)

export default router
