import express from "express"
import asyncHandler from "express-async-handler"
import Product from "../models/productModel.js"
import Category from "../models/categoryModel.js"
import Brand from "../models/brandModel.js"
import SubCategory from "../models/subCategoryModel.js"
import { protect, admin } from "../middleware/authMiddleware.js"
import multer from "multer"
import XLSX from "xlsx"
import fs from "fs"
import Tax from "../models/taxModel.js"
import Unit from "../models/unitModel.js"
import Color from "../models/colorModel.js"
import Warranty from "../models/warrantyModel.js"
import Size from "../models/sizeModel.js"
import Volume from "../models/volumeModel.js"
import mongoose from "mongoose"

const router = express.Router()

// Multer setup for Excel parsing (use memory storage for Vercel compatibility)
const excelUpload = multer({ storage: multer.memoryStorage() })

// Helper: map Excel columns to backend keys (supports 4-level categories)
const excelToBackendKey = {
  name: "name",
  slug: "slug",
  SKU: "sku",
  sku: "sku",
  // Category hierarchy
  category: "category", // Level 1
  subcategory: "category", // alias for level 1
  sub_category: "category", // alias for level 1
  category1: "category", // alias for level 1
  category_level_1: "category", // alias for level 1
  parent_category: "parent_category",
  parentCategory: "parent_category",
  // Deeper levels
  category_level_2: "subCategory2",
  category2: "subCategory2",
  sub_category_2: "subCategory2",
  subcategory2: "subCategory2",
  subCategory2: "subCategory2",
  category_level_3: "subCategory3",
  category3: "subCategory3",
  sub_category_3: "subCategory3",
  subcategory3: "subCategory3",
  subCategory3: "subCategory3",
  category_level_4: "subCategory4",
  category4: "subCategory4",
  sub_category_4: "subCategory4",
  subcategory4: "subCategory4",
  subCategory4: "subCategory4",
  barcode: "barcode",
  buying_price: "buyingPrice",
  selling_price: "price",
  offer_price: "offerPrice",
  tax: "tax",
  brand: "brand",
  status: "stockStatus",
  show_stock_out: "showStockOut",
  can_purchasable: "canPurchase",
  refundable: "refundable",
  max_purchase_quantity: "maxPurchaseQty",
  low_stock_warning: "lowStockWarning",
  unit: "unit",
  weight: "weight",
  tags: "tags",
  description: "description",
  discount: "discount",
  specifications: "specifications",
  details: "details",
  short_description: "shortDescription",
  warranty: "warranty",
  size: "size",
  volume: "volume",
}

function remapRow(row) {
  const mapped = {}
  const specifications = []
  for (const key in row) {
    const backendKey = excelToBackendKey[key.trim()] || key.trim()
    if (excelToBackendKey[key.trim()]) {
      mapped[backendKey] = row[key]
    } else {
      // If not a standard field, treat as specification
      if (row[key] !== undefined && row[key] !== "") {
        specifications.push({ key: key.trim(), value: String(row[key]) })
      }
    }
  }
  if (specifications.length > 0) {
    mapped.specifications = specifications
  }
  return mapped
}

// Robust slug generator: lowercases, converts & to 'and', removes quotes, replaces non-alphanumerics with '-',
// collapses multiple dashes, and trims leading/trailing dashes.
function generateSlug(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/&/g, "-and-")
    .replace(/["'’`]+/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

const sanitizeSlug = (slug) => generateSlug(slug)

// Helper to escape regex special characters
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// @desc    Fetch all products (Admin only - includes inactive)
// @route   GET /api/products/admin
// @access  Private/Admin
router.get("/admin", protect, admin, async (req, res) => {
  try {
    const { search, category, subcategory, parentCategory, brand, isActive, limit = 20, page = 1 } = req.query
    const query = {}
    const orConditions = []

    if (category) query.category = category
    if (subcategory) query.subCategory = subcategory
    if (parentCategory) query.parentCategory = parentCategory
    if (brand) query.brand = brand

    // Add isActive filter if provided
    if (isActive !== undefined && isActive !== null && isActive !== "") {
      query.isActive = isActive === "true" || isActive === true
    }

    if (typeof search === "string" && search.trim() !== "") {
      const safeSearch = escapeRegex(search)
      const regex = new RegExp(safeSearch, "i")
      // Find matching brands by name
      const matchingBrands = await Brand.find({ name: regex }).select("_id")
      const brandIds = matchingBrands.map((b) => b._id)
      orConditions.push(
        { name: regex },
        { description: regex },
        { sku: regex },
        { barcode: regex },
        { tags: regex },
        { brand: { $in: brandIds } },
      )
    }
    if (orConditions.length > 0) {
      query.$or = orConditions
    }

    // Get total count for pagination
    const totalCount = await Product.countDocuments(query)

    let productsQuery = Product.find(query)
      .populate("brand category subCategory parentCategory")
      .sort({ createdAt: -1 })

    // Pagination
    const skip = (page - 1) * limit
    productsQuery = productsQuery.skip(skip).limit(Number.parseInt(limit))

    const products = await productsQuery
    res.json({ products, totalCount })
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: "Server error" })
  }
})

// @desc    Get product count only (Admin only - for efficient select all)
// @route   GET /api/products/admin/count
// @access  Private/Admin
router.get("/admin/count", protect, admin, async (req, res) => {
  try {
    const { search, category, subcategory, parentCategory, brand } = req.query
    const query = {}
    const orConditions = []

    if (category) query.category = category
    if (subcategory) query.subCategory = subcategory
    if (parentCategory) query.parentCategory = parentCategory
    if (brand) query.brand = brand

    if (typeof search === "string" && search.trim() !== "") {
      const safeSearch = escapeRegex(search)
      const regex = new RegExp(safeSearch, "i")
      // Find matching brands by name
      const matchingBrands = await Brand.find({ name: regex }).select("_id")
      const brandIds = matchingBrands.map((b) => b._id)
      orConditions.push(
        { name: regex },
        { description: regex },
        { sku: regex },
        { barcode: regex },
        { tags: regex },
        { brand: { $in: brandIds } },
      )
    }
    if (orConditions.length > 0) {
      query.$or = orConditions
    }

    // Get only the count - much faster than fetching products
    const totalCount = await Product.countDocuments(query)
    res.json({ totalCount })
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: "Server error" })
  }
})

// @desc    Fetch all products
// @route   GET /api/products
// @access  Public
router.get(
  "/",
  asyncHandler(async (req, res) => {
  const { category, subcategory, parentCategory, featured, search, brand, limit } = req.query

    const andConditions = [{ isActive: true }]

    // Category filter
    if (category && category !== "all" && category.match(/^[0-9a-fA-F]{24}$/)) {
      andConditions.push({ category })
    }

    // Parent category filter (only if subcategory is not present)
    if (!subcategory && parentCategory && parentCategory.match(/^[0-9a-fA-F]{24}$/)) {
      andConditions.push({ parentCategory })
    }

    // Subcategory filter
    if (subcategory && subcategory.match(/^[0-9a-fA-F]{24}$/)) {
      andConditions.push({
        $or: [
          { category: subcategory },
          { subCategory: subcategory },
          { subCategory2: subcategory },
          { subCategory3: subcategory },
          { subCategory4: subcategory },
        ],
      })
    }

    // Search filter
    if (typeof search === "string" && search.trim()) {
      const safeSearch = escapeRegex(search.trim())
      const regex = new RegExp(safeSearch, "i")

      // Find matching brands by name for search
      const matchingBrands = await Brand.find({ name: regex }).select("_id").lean()
      const brandIds = matchingBrands.map((b) => b._id)

      andConditions.push({
        $or: [
          { name: regex },
          { description: regex },
          { sku: regex },
          { barcode: regex },
          { tags: regex },
          { brand: { $in: brandIds } },
        ],
      })
    }

    // Brand filter
    if (brand) {
      if (Array.isArray(brand)) {
        andConditions.push({ brand: { $in: brand } })
      } else if (typeof brand === "string" && brand.match(/^[0-9a-fA-F]{24}$/)) {
        andConditions.push({ brand })
      }
    }

    // Featured filter
    if (featured === "true") {
      andConditions.push({ featured: true })
    }

    const query = andConditions.length > 1 ? { $and: andConditions } : andConditions[0]

    let productsQuery = Product.find(query)
      .select(
  "name slug sku price offerPrice discount image countInStock stockStatus brand category parentCategory subCategory2 subCategory3 subCategory4 featured tags createdAt rating numReviews",
      )
      .populate("brand", "name slug")
      .populate("category", "name slug")
      .populate("parentCategory", "name slug")
      .populate("subCategory2", "name slug") // Populate Level 2 subcategories
      .populate("subCategory3", "name slug") // Populate Level 3 subcategories
      .populate("subCategory4", "name slug") // Populate Level 4 subcategories
      .lean() // Use lean() for better performance
      .sort({ createdAt: -1 })

    // Apply limit only if specified (for specific use cases)
    if (limit && !isNaN(limit)) {
      productsQuery = productsQuery.limit(Number.parseInt(limit))
    }

    const products = await productsQuery

    res.json(products)
  }),
)

// @desc    Fetch products with pagination (for specific use cases)
// @route   GET /api/products/paginated
// @access  Public
router.get(
  "/paginated",
  asyncHandler(async (req, res) => {
  const { category, subcategory, parentCategory, featured, search, page = 1, limit = 20, brand } = req.query

    const andConditions = [{ isActive: true }]

    if (category && category !== "all" && category.match(/^[0-9a-fA-F]{24}$/)) {
      andConditions.push({ category })
    }
    if (!subcategory && parentCategory && parentCategory.match(/^[0-9a-fA-F]{24}$/)) {
      andConditions.push({ parentCategory })
    }
    if (subcategory && subcategory.match(/^[0-9a-fA-F]{24}$/)) {
      andConditions.push({
        $or: [
          { category: subcategory },
          { subCategory: subcategory },
          { subCategory2: subcategory },
          { subCategory3: subcategory },
          { subCategory4: subcategory },
        ],
      })
    }

    if (typeof search === "string" && search.trim()) {
      const safeSearch = escapeRegex(search.trim())
      const regex = new RegExp(safeSearch, "i")
      const matchingBrands = await Brand.find({ name: regex }).select("_id").lean()
      const brandIds = matchingBrands.map((b) => b._id)

      andConditions.push({
        $or: [
          { name: regex },
          { description: regex },
          { sku: regex },
          { barcode: regex },
          { tags: regex },
          { brand: { $in: brandIds } },
        ],
      })
    }

    if (brand) {
      if (Array.isArray(brand)) {
        andConditions.push({ brand: { $in: brand } })
      } else if (typeof brand === "string" && brand.match(/^[0-9a-fA-F]{24}$/)) {
        andConditions.push({ brand })
      }
    }

    if (featured === "true") {
      andConditions.push({ featured: true })
    }

    const query = andConditions.length > 1 ? { $and: andConditions } : andConditions[0]

    // Get total count for pagination info
    const totalCount = await Product.countDocuments(query)

    const products = await Product.find(query)
      .select(
        "name slug sku price offerPrice discount image countInStock stockStatus brand category parentCategory featured tags createdAt rating numReviews",
      )
      .populate("brand", "name slug")
      .populate("category", "name slug")
      .populate("parentCategory", "name slug")
      .lean()
      .skip((page - 1) * Number.parseInt(limit))
      .limit(Number.parseInt(limit))
      .sort({ createdAt: -1 })

    res.json({
      products,
      totalCount,
      currentPage: Number.parseInt(page),
      totalPages: Math.ceil(totalCount / Number.parseInt(limit)),
      hasMore: Number.parseInt(page) * Number.parseInt(limit) < totalCount,
    })
  }),
)

// @desc    Fetch products by SKU array
// @route   POST /api/products/by-skus
// @access  Public
router.post(
  "/by-skus",
  asyncHandler(async (req, res) => {
    const { skus } = req.body

    if (!skus || !Array.isArray(skus)) {
      return res.status(400).json({ message: "SKUs array is required" })
    }

    const products = await Product.find({
      sku: { $in: skus },
      isActive: true,
    })
      .populate("category", "name slug")
      .populate("subCategory", "name slug")
      .populate("brand", "name slug")
      .populate("parentCategory", "name slug")

    res.json(products)
  }),
)

// @desc    Fetch single product by ID
// @route   GET /api/products/:id
// @access  Public
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const product = await Product.findById(req.params.id).populate("category", "name slug").populate("brand", "name")

    if (product && product.isActive) {
      res.json(product)
    } else {
      res.status(404)
      throw new Error("Product not found")
    }
  }),
)

// @desc    Fetch single product by slug
// @route   GET /api/products/slug/:slug
// @access  Public
router.get(
  "/slug/:slug",
  asyncHandler(async (req, res) => {
    const product = await Product.findOne({ slug: req.params.slug, isActive: true })
      .populate("category", "name slug")
      .populate("brand", "name")

    if (product) {
      res.json(product)
    } else {
      res.status(404)
      throw new Error("Product not found")
    }
  }),
)

// @desc    Create a product review
// @route   POST /api/products/:id/reviews
// @access  Private
router.post(
  "/:id/reviews",
  protect,
  asyncHandler(async (req, res) => {
    const { rating, comment, name } = req.body

    const product = await Product.findById(req.params.id)

    if (product) {
      const alreadyReviewed = product.reviews.find((r) => r.user.toString() === req.user._id.toString())

      if (alreadyReviewed) {
        res.status(400)
        throw new Error("Product already reviewed")
      }

      const review = {
        name: name || req.user.name,
        rating: Number(rating),
        comment,
        user: req.user._id,
        createdAt: new Date(),
      }

      product.reviews.push(review)

      // Properly calculate numReviews and rating
      product.numReviews = product.reviews.length
      product.rating = product.reviews.reduce((acc, item) => Number(item.rating) + acc, 0) / product.reviews.length

      await product.save()

      // Log the updated values for debugging
      console.log(
        "Review added - Product:",
        product.name,
        "New Rating:",
        product.rating,
        "NumReviews:",
        product.numReviews,
      )

      res.status(201).json({ message: "Review added", rating: product.rating, numReviews: product.numReviews })
    } else {
      res.status(404)
      throw new Error("Product not found")
    }
  }),
)

// @desc    Create a product
// @route   POST /api/products
// @access  Private/Admin
router.post(
  "/",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const { parentCategory, category, subCategory2, subCategory3, subCategory4, ...productData } = req.body

    // Verify parentCategory exists
    if (parentCategory) {
      const parentCategoryExists = await Category.findById(parentCategory)
      if (!parentCategoryExists) {
        res.status(400)
        throw new Error("Invalid parent category")
      }
    } else {
      res.status(400)
      throw new Error("Parent category is required")
    }

    // Verify subcategory exists if provided
    if (category) {
      const subCategoryExists = await SubCategory.findById(category)
      if (!subCategoryExists) {
        res.status(400)
        throw new Error("Invalid subcategory")
      }
    }

    // Verify subCategory2 exists if provided
    if (subCategory2) {
      const subCategory2Exists = await SubCategory.findById(subCategory2)
      if (!subCategory2Exists) {
        res.status(400)
        throw new Error("Invalid subcategory level 2")
      }
    }

    // Verify subCategory3 exists if provided
    if (subCategory3) {
      const subCategory3Exists = await SubCategory.findById(subCategory3)
      if (!subCategory3Exists) {
        res.status(400)
        throw new Error("Invalid subcategory level 3")
      }
    }

    // Verify subCategory4 exists if provided
    if (subCategory4) {
      const subCategory4Exists = await SubCategory.findById(subCategory4)
      if (!subCategory4Exists) {
        res.status(400)
        throw new Error("Invalid subcategory level 4")
      }
    }

    // Sanitize slug if provided and check uniqueness
    if (productData.slug) {
      productData.slug = sanitizeSlug(productData.slug)
      const existingProduct = await Product.findOne({ slug: productData.slug })
      if (existingProduct) {
        res.status(400)
        throw new Error("Product slug already exists")
      }
    }

    // Ensure slug exists
    if (!productData.slug && productData.name) {
      productData.slug = generateSlug(productData.name)
    }

    const product = new Product({
      ...productData,
      parentCategory,
      category,
      subCategory: category || undefined, // for backward compatibility
      subCategory2: subCategory2 || undefined,
      subCategory3: subCategory3 || undefined,
      subCategory4: subCategory4 || undefined,
      createdBy: req.user._id,
    })

    const createdProduct = await product.save()
    const populatedProduct = await Product.findById(createdProduct._id)
      .populate("parentCategory", "name slug")
      .populate("category", "name slug")
      .populate("subCategory2", "name slug")
      .populate("subCategory3", "name slug")
      .populate("subCategory4", "name slug")
      .populate("brand", "name")
    res.status(201).json(populatedProduct)
  }),
)

// @desc    Update a product
// @route   PUT /api/products/:id
// @access  Private/Admin
router.put(
  "/:id",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const product = await Product.findById(req.params.id)

    if (product) {
      const { parentCategory, category, subCategory2, subCategory3, subCategory4, slug, ...updateData } = req.body

      // Verify parentCategory exists if provided
      if (parentCategory) {
        const parentCategoryExists = await Category.findById(parentCategory)
        if (!parentCategoryExists) {
          res.status(400)
          throw new Error("Invalid parent category")
        }
      }

      // Verify subcategory exists if provided
      if (category) {
        const subCategoryExists = await SubCategory.findById(category)
        if (!subCategoryExists) {
          res.status(400)
          throw new Error("Invalid subcategory")
        }
      }

      // Verify subCategory2 exists if provided
      if (subCategory2) {
        const subCategory2Exists = await SubCategory.findById(subCategory2)
        if (!subCategory2Exists) {
          res.status(400)
          throw new Error("Invalid subcategory level 2")
        }
      }

      // Verify subCategory3 exists if provided
      if (subCategory3) {
        const subCategory3Exists = await SubCategory.findById(subCategory3)
        if (!subCategory3Exists) {
          res.status(400)
          throw new Error("Invalid subcategory level 3")
        }
      }

      // Verify subCategory4 exists if provided
      if (subCategory4) {
        const subCategory4Exists = await SubCategory.findById(subCategory4)
        if (!subCategory4Exists) {
          res.status(400)
          throw new Error("Invalid subcategory level 4")
        }
      }

      // Check if slug is unique (excluding current product)
      if (slug && slug !== product.slug) {
        const cleanSlug = sanitizeSlug(slug)
        const existingProduct = await Product.findOne({ slug: cleanSlug, _id: { $ne: req.params.id } })
        if (existingProduct) {
          res.status(400)
          throw new Error("Product slug already exists")
        }
        product.slug = cleanSlug
      }

      // Update product fields
      Object.keys(updateData).forEach((key) => {
        product[key] = updateData[key]
      })

      if (parentCategory) product.parentCategory = parentCategory
      if (category) {
        product.category = category
        product.subCategory = category // for backward compatibility
      }
      if (subCategory2 !== undefined) product.subCategory2 = subCategory2
      if (subCategory3 !== undefined) product.subCategory3 = subCategory3
      if (subCategory4 !== undefined) product.subCategory4 = subCategory4
  // product.slug already set above if slug was provided

      const updatedProduct = await product.save()
      const populatedProduct = await Product.findById(updatedProduct._id)
        .populate("parentCategory", "name slug")
        .populate("category", "name slug")
        .populate("subCategory2", "name slug")
        .populate("subCategory3", "name slug")
        .populate("subCategory4", "name slug")
        .populate("brand", "name")
      res.json(populatedProduct)
    } else {
      res.status(404)
      throw new Error("Product not found")
    }
  }),
)

// @desc    Delete a product
// @route   DELETE /api/products/:id
// @access  Private/Admin
router.delete(
  "/:id",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const product = await Product.findById(req.params.id)

    if (product) {
      await product.deleteOne()
      res.json({ message: "Product removed" })
    } else {
      res.status(404)
      throw new Error("Product not found")
    }
  }),
)

// @desc    Get products by category
// @route   GET /api/products/category/:categoryId
// @access  Public
router.get(
  "/category/:categoryId",
  asyncHandler(async (req, res) => {
    const products = await Product.find({
      isActive: true,
      $or: [
        { category: req.params.categoryId },
        { subCategory: req.params.categoryId },
        { subCategory2: req.params.categoryId },
        { subCategory3: req.params.categoryId },
        { subCategory4: req.params.categoryId },
      ],
    })
      .populate("category", "name slug")
      .populate("brand", "name")
      .sort({ createdAt: -1 })

    res.json(products)
  }),
)

// @desc    Bulk preview products from Excel (supports 4 category levels)
// @route   POST /api/products/bulk-preview
// @access  Private/Admin
router.post(
  "/bulk-preview",
  protect,
  admin,
  excelUpload.single("file"),
  asyncHandler(async (req, res) => {
    console.log("--- EXCEL BULK PREVIEW START ---")
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" })
    }
    try {
      // Read Excel from memory buffer (works on serverless too)
      const workbook = XLSX.read(req.file.buffer, { type: "buffer" })
      const sheetName = workbook.SheetNames[0]
      const sheet = workbook.Sheets[sheetName]
      const rows = XLSX.utils.sheet_to_json(sheet)
      console.log("Excel rows loaded:", rows.length)

      // Map headers to backend keys (includes 4-level category aliases)
      const mappedRows = rows.map(remapRow)

      // Helper for flexible retrieval from mapped rows
      const getField = (row, keys) => {
        for (const k of keys) {
          if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== "") return String(row[k]).trim()
        }
        return undefined
      }

      // Collect unique top-levels for upfront creation
      const uniqueParentCategoryNames = new Set()
      const uniqueLevel1Names = new Set()
      const uniqueBrandNames = new Set()
      const uniqueTaxNames = new Set()
      const uniqueUnitNames = new Set()
      const uniqueColorNames = new Set()
      const uniqueWarrantyNames = new Set()
      const uniqueSizeNames = new Set()
      const uniqueVolumeNames = new Set()

      mappedRows.forEach((row) => {
        const parentName = getField(row, ["parent_category"]) // already normalized
        const level1Name = getField(row, ["category"]) // normalized to level 1
        if (parentName) uniqueParentCategoryNames.add(parentName)
        if (level1Name) uniqueLevel1Names.add(level1Name)
        if (row.brand) uniqueBrandNames.add(String(row.brand).trim())
        if (row.tax) uniqueTaxNames.add(String(row.tax).trim())
        if (row.unit) uniqueUnitNames.add(String(row.unit).trim())
        if (row.color) uniqueColorNames.add(String(row.color).trim())
        if (row.warranty) uniqueWarrantyNames.add(String(row.warranty).trim())
        if (row.size) uniqueSizeNames.add(String(row.size).trim())
        if (row.volume) uniqueVolumeNames.add(String(row.volume).trim())
      })

      // Fetch existing records
      const existingParents = await Category.find({ name: { $in: Array.from(uniqueParentCategoryNames) } })
      const existingLevel1Subs = await SubCategory.find({ name: { $in: Array.from(uniqueLevel1Names) }, level: 1 })
      const existingBrands = await Brand.find({ name: { $in: Array.from(uniqueBrandNames) } })
      const existingTaxes = await Tax.find({ name: { $in: Array.from(uniqueTaxNames) } })
      const existingUnits = await Unit.find({ name: { $in: Array.from(uniqueUnitNames) } })
      const existingColors = await Color.find({ name: { $in: Array.from(uniqueColorNames) } })
      const existingWarranties = await Warranty.find({ name: { $in: Array.from(uniqueWarrantyNames) } })
      const existingSizes = await Size.find({ name: { $in: Array.from(uniqueSizeNames) } })
      const existingVolumes = await Volume.find({ name: { $in: Array.from(uniqueVolumeNames) } })

      // Build maps
      const parentCategoryMap = new Map()
      existingParents.forEach((c) => parentCategoryMap.set(c.name.trim().toLowerCase(), c._id))
      const level1Map = new Map()
      existingLevel1Subs.forEach((s) => level1Map.set(s.name.trim().toLowerCase(), s._id))
      const brandMap = new Map()
      existingBrands.forEach((b) => brandMap.set(b.name.trim().toLowerCase(), b._id))
      const taxMap = new Map()
      existingTaxes.forEach((t) => taxMap.set(t.name.trim().toLowerCase(), t._id))
      const unitMap = new Map()
      existingUnits.forEach((u) => unitMap.set(u.name.trim().toLowerCase(), u._id))
      const colorMap = new Map()
      existingColors.forEach((c) => colorMap.set(c.name.trim().toLowerCase(), c._id))
      const warrantyMap = new Map()
      existingWarranties.forEach((w) => warrantyMap.set(w.name.trim().toLowerCase(), w._id))
      const sizeMap = new Map()
      existingSizes.forEach((s) => sizeMap.set(s.name.trim().toLowerCase(), s._id))
      const volumeMap = new Map()
      existingVolumes.forEach((v) => volumeMap.set(v.name.trim().toLowerCase(), v._id))

      // Create missing parent categories
      for (const name of uniqueParentCategoryNames) {
        const key = name.trim().toLowerCase()
        if (!parentCategoryMap.has(key)) {
          const slug = generateSlug(name)
          const bySlug = await Category.findOne({ slug })
          if (bySlug) parentCategoryMap.set(key, bySlug._id)
          else {
            const created = await Category.create({ name: name.trim(), slug, createdBy: req.user?._id })
            parentCategoryMap.set(key, created._id)
          }
        }
      }

      // Create missing level1 subcategories
      for (const name of uniqueLevel1Names) {
        const key = name.trim().toLowerCase()
        if (!level1Map.has(key)) {
          // find a row that pairs level1 with a parent
          const rowWithParent = mappedRows.find((r) => r.category && r.category.trim().toLowerCase() === key && r.parent_category)
          let parentCategoryId
          if (rowWithParent) {
            parentCategoryId = parentCategoryMap.get(rowWithParent.parent_category.trim().toLowerCase())
          }
          const slug = generateSlug(name)
          const bySlug = await SubCategory.findOne({ slug })
          if (bySlug) level1Map.set(key, bySlug._id)
          else {
            const created = await SubCategory.create({
              name: name.trim(),
              slug,
              category: parentCategoryId,
              parentSubCategory: null,
              level: 1,
              createdBy: req.user?._id,
            })
            level1Map.set(key, created._id)
          }
        }
      }

      // Caches for deeper levels
      const level2Cache = new Map()
      const level3Cache = new Map()
      const level4Cache = new Map()

      // Helper to ensure deeper subcategories (levels 2-4)
      const ensureSubCategory = async (name, parentCategoryId, parentSubId, level) => {
        if (!name) return undefined
        const key = `${parentCategoryId || ''}:${parentSubId || ''}:${level}:${name.trim().toLowerCase()}`
        const cache = level === 2 ? level2Cache : level === 3 ? level3Cache : level4Cache
        if (cache.has(key)) return cache.get(key)
        const slug = generateSlug(name)
        let existing = await SubCategory.findOne({ slug, category: parentCategoryId })
        if (!existing) {
          existing = await SubCategory.create({
            name: name.trim(),
            slug,
            category: parentCategoryId,
            parentSubCategory: parentSubId || null,
            level,
            createdBy: req.user?._id,
          })
        }
        cache.set(key, existing._id)
        return existing._id
      }

      // Prepare duplicates check
      const names = mappedRows.map((r) => r.name).filter(Boolean)
      const slugs = mappedRows.map((r) => r.slug).filter(Boolean)
      const existingProducts = await Product.find({ $or: [{ name: { $in: names } }, { slug: { $in: slugs } }] }).select(
        "name slug",
      )
      const existingNames = new Set(existingProducts.map((p) => p.name))
      const existingSlugs = new Set(existingProducts.map((p) => p.slug))

      // Build preview
      const previewProducts = []
      const invalidRows = []
      const allowedStockStatus = ["Available Product", "Out of Stock", "PreOrder"]

      for (const [i, row] of mappedRows.entries()) {
        if (Object.values(row).every((v) => !v)) {
          invalidRows.push({ row: i + 2, reason: "Empty row", data: row })
          continue
        }

        const parentName = getField(row, ["parent_category"]) || ""
        if (!row.name || !parentName) {
          invalidRows.push({ row: i + 2, reason: "Missing required fields (name, parent_category)", data: row })
          continue
        }

        if ((row.name && existingNames.has(row.name)) || (row.slug && existingSlugs.has(row.slug))) {
          invalidRows.push({ row: i + 2, reason: "Duplicate product name or slug", data: row })
          continue
        }

        const parentCategoryId = parentCategoryMap.get(parentName.trim().toLowerCase())
        const level1Name = getField(row, ["category"]) // normalized
        const level2Name = getField(row, ["subCategory2"]) // normalized via excelToBackendKey
        const level3Name = getField(row, ["subCategory3"]) // normalized
        const level4Name = getField(row, ["subCategory4"]) // normalized
        const level1Id = level1Name ? level1Map.get(level1Name.trim().toLowerCase()) : undefined
        const level2Id = await ensureSubCategory(level2Name, parentCategoryId, level1Id, 2)
        const level3Id = await ensureSubCategory(level3Name, parentCategoryId, level2Id || level1Id, 3)
        const level4Id = await ensureSubCategory(level4Name, parentCategoryId, level3Id || level2Id || level1Id, 4)

        let stockStatus = row.stockStatus || "Available Product"
        if (!allowedStockStatus.includes(stockStatus)) stockStatus = "Available Product"
        const brandId = row.brand ? brandMap.get(String(row.brand).trim().toLowerCase()) : undefined
        const taxId = row.tax ? taxMap.get(String(row.tax).trim().toLowerCase()) : undefined
        const unitId = row.unit ? unitMap.get(String(row.unit).trim().toLowerCase()) : undefined

        previewProducts.push({
          name: row.name || "",
          slug: row.slug || generateSlug(row.name || ""),
          sku: row.sku || "",
          barcode: row.barcode || "",
          parentCategory: parentCategoryId,
          category: level1Id,
          subCategory2: level2Id,
          subCategory3: level3Id,
          subCategory4: level4Id,
          brand: brandId,
          buyingPrice: Number.parseFloat(row.buyingPrice) || 0,
          price: Number.parseFloat(row.price) || 0,
          offerPrice: Number.parseFloat(row.offerPrice) || 0,
          discount: Number.parseFloat(row.discount) || 0,
          tax: taxId,
          stockStatus,
          showStockOut: row.showStockOut === "true" || row.showStockOut === true,
          canPurchase: row.canPurchase === "true" || row.canPurchase === true,
          refundable: row.refundable === "true" || row.refundable === true,
          maxPurchaseQty: Number.parseInt(row.maxPurchaseQty) || 10,
          lowStockWarning: Number.parseInt(row.lowStockWarning) || 5,
          unit: unitId,
          weight: Number.parseFloat(row.weight) || 0,
          tags: row.tags ? String(row.tags).split(",").map((t) => t.trim()) : [],
          description: row.description || "",
          shortDescription: row.shortDescription || "",
          specifications: row.specifications ? [{ key: "Specifications", value: row.specifications }] : [],
          details: row.details || "",
          countInStock: Number.parseInt(row.countInStock) || 0,
          isActive: true,
          featured: false,
        })
      }

      // Populate for preview display
      const populatedPreviewProducts = await Promise.all(
        previewProducts.map(async (prod) => {
          const populated = { ...prod }
          if (prod.parentCategory) {
            const cat = await Category.findById(prod.parentCategory).select("name slug")
            if (cat) populated.parentCategory = { _id: cat._id, name: cat.name, slug: cat.slug }
          }
          const populateSub = async (id) => (id ? await SubCategory.findById(id).select("name slug") : null)
          if (prod.category) {
            const s1 = await populateSub(prod.category)
            if (s1) populated.category = { _id: s1._id, name: s1.name, slug: s1.slug }
          }
          if (prod.subCategory2) {
            const s2 = await populateSub(prod.subCategory2)
            if (s2) populated.subCategory2 = { _id: s2._id, name: s2.name, slug: s2.slug }
          }
          if (prod.subCategory3) {
            const s3 = await populateSub(prod.subCategory3)
            if (s3) populated.subCategory3 = { _id: s3._id, name: s3.name, slug: s3.slug }
          }
          if (prod.subCategory4) {
            const s4 = await populateSub(prod.subCategory4)
            if (s4) populated.subCategory4 = { _id: s4._id, name: s4.name, slug: s4.slug }
          }
          if (prod.brand) {
            const b = await Brand.findById(prod.brand).select("name slug")
            if (b) populated.brand = { _id: b._id, name: b.name, slug: b.slug }
          }
          return populated
        }),
      )

      res.json({
        previewProducts: populatedPreviewProducts,
        invalidRows,
        total: rows.length,
        valid: previewProducts.length,
        invalid: invalidRows.length,
      })
    } catch (error) {
      console.error("Bulk preview error:", error)
      res.status(500).json({ message: "Bulk preview failed", error: error.message })
    }
  }),
)

// @desc    Bulk preview products from CSV (supports 4 category levels)
// @route   POST /api/products/bulk-preview-csv
// @access  Private/Admin
router.post(
  "/bulk-preview-csv",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    console.log("--- CSV BULK PREVIEW START ---")
    const { csvData } = req.body
    if (!csvData || !Array.isArray(csvData)) {
      return res.status(400).json({ message: "No CSV data provided" })
    }

    // Helper for flexible column names
    const getField = (row, keys) => {
      for (const k of keys) {
        if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== "") return String(row[k]).trim()
      }
      return undefined
    }

    // Collect unique names (parent + level1 + brand/tax/unit) for upfront creation
    const uniqueParentCategoryNames = new Set()
    const uniqueLevel1Names = new Set()
    const uniqueBrandNames = new Set()
    const uniqueTaxNames = new Set()
    const uniqueUnitNames = new Set()

    csvData.forEach((row) => {
      const parentName = getField(row, ["parent_category", "parentCategory"])
      const level1Name = getField(row, ["category", "subcategory", "sub_category", "category1", "category_level_1"])
      if (parentName) uniqueParentCategoryNames.add(parentName)
      if (level1Name) uniqueLevel1Names.add(level1Name)
      const b = getField(row, ["brand"]) ; if (b) uniqueBrandNames.add(b)
      const t = getField(row, ["tax"]) ; if (t) uniqueTaxNames.add(t)
      const u = getField(row, ["unit"]) ; if (u) uniqueUnitNames.add(u)
    })

    // Fetch existing
    const existingParents = await Category.find({ name: { $in: Array.from(uniqueParentCategoryNames) } })
    const existingLevel1Subs = await SubCategory.find({ name: { $in: Array.from(uniqueLevel1Names) }, level: 1 })
    const existingBrands = await Brand.find({ name: { $in: Array.from(uniqueBrandNames) } })
    const existingTaxes = await Tax.find({ name: { $in: Array.from(uniqueTaxNames) } })
    const existingUnits = await Unit.find({ name: { $in: Array.from(uniqueUnitNames) } })

    // Maps
    const parentCategoryMap = new Map()
    existingParents.forEach((c) => parentCategoryMap.set(c.name.trim().toLowerCase(), c._id))
    const level1Map = new Map()
    existingLevel1Subs.forEach((s) => level1Map.set(s.name.trim().toLowerCase(), s._id))
    const brandMap = new Map()
    existingBrands.forEach((b) => brandMap.set(b.name.trim().toLowerCase(), b._id))
    const taxMap = new Map()
    existingTaxes.forEach((t) => taxMap.set(t.name.trim().toLowerCase(), t._id))
    const unitMap = new Map()
    existingUnits.forEach((u) => unitMap.set(u.name.trim().toLowerCase(), u._id))

    // Create missing parent categories
    for (const name of uniqueParentCategoryNames) {
      const key = name.trim().toLowerCase()
      if (!parentCategoryMap.has(key)) {
        const slug = generateSlug(name)
        const existingBySlug = await Category.findOne({ slug })
        if (existingBySlug) {
          parentCategoryMap.set(key, existingBySlug._id)
        } else {
          const created = await Category.create({ name: name.trim(), slug, createdBy: req.user?._id })
          parentCategoryMap.set(key, created._id)
        }
      }
    }

    // Create missing level1 subcategories
    for (const name of uniqueLevel1Names) {
      const key = name.trim().toLowerCase()
      if (!level1Map.has(key)) {
        // attempt find parent from any row referencing this level1 + parent
        const rowWithParent = csvData.find((r) => {
          const l1 = getField(r, ["category", "subcategory", "sub_category", "category1", "category_level_1"])
          return l1 && l1.trim().toLowerCase() === key && getField(r, ["parent_category", "parentCategory"]) // parent exists
        })
        let parentCategoryId = undefined
        if (rowWithParent) {
          const parentName = getField(rowWithParent, ["parent_category", "parentCategory"])?.trim().toLowerCase()
          if (parentName) parentCategoryId = parentCategoryMap.get(parentName)
        }
        const slug = generateSlug(name)
        const existingBySlug = await SubCategory.findOne({ slug })
        if (existingBySlug) {
          level1Map.set(key, existingBySlug._id)
        } else {
          const created = await SubCategory.create({
            name: name.trim(),
            slug,
            category: parentCategoryId,
            parentSubCategory: null,
            level: 1,
            createdBy: req.user?._id,
          })
          level1Map.set(key, created._id)
        }
      }
    }

    // Caches for deeper levels
    const level2Cache = new Map()
    const level3Cache = new Map()
    const level4Cache = new Map()

    // Existing product name/slug to avoid duplicates
    const names = csvData.map((r) => r.name).filter(Boolean)
    const slugs = csvData.map((r) => r.slug).filter(Boolean)
    const existingProducts = await Product.find({ $or: [{ name: { $in: names } }, { slug: { $in: slugs } }] }).select(
      "name slug",
    )
    const existingNames = new Set(existingProducts.map((p) => p.name))
    const existingSlugs = new Set(existingProducts.map((p) => p.slug))

    const allowedStockStatus = ["Available Product", "Out of Stock", "PreOrder"]
    const previewProducts = []
    const invalidRows = []

    // Helper to ensure a subcategory level (2-4)
    const ensureSubCategory = async (name, parentCategoryId, parentSubId, level) => {
      if (!name) return undefined
      const key = `${parentCategoryId || ''}:${parentSubId || ''}:${level}:${name.trim().toLowerCase()}`
      const cache = level === 2 ? level2Cache : level === 3 ? level3Cache : level4Cache
      if (cache.has(key)) return cache.get(key)
      const slug = generateSlug(name)
      let existing = await SubCategory.findOne({ slug, category: parentCategoryId })
      if (!existing) {
        existing = await SubCategory.create({
          name: name.trim(),
          slug,
          category: parentCategoryId,
          parentSubCategory: parentSubId || null,
          level,
          createdBy: req.user?._id,
        })
      }
      cache.set(key, existing._id)
      return existing._id
    }

    for (const [i, row] of csvData.entries()) {
      if (Object.values(row).every((v) => !v)) {
        invalidRows.push({ row: i + 2, reason: "Empty row", data: row })
        continue
      }
      const parentName = getField(row, ["parent_category", "parentCategory"]) || ""
      if (!row.name || !parentName) {
        invalidRows.push({ row: i + 2, reason: "Missing required fields (name, parent_category)", data: row })
        continue
      }
      if ((row.name && existingNames.has(row.name)) || (row.slug && existingSlugs.has(row.slug))) {
        invalidRows.push({ row: i + 2, reason: "Duplicate product name or slug", data: row })
        continue
      }
      const parentCategoryId = parentCategoryMap.get(parentName.trim().toLowerCase())
      const level1Name = getField(row, ["category", "subcategory", "sub_category", "category1", "category_level_1"])
      const level2Name = getField(row, ["sub_category_2", "subcategory2", "subCategory2", "category2", "category_level_2"])
      const level3Name = getField(row, ["sub_category_3", "subcategory3", "subCategory3", "category3", "category_level_3"])
      const level4Name = getField(row, ["sub_category_4", "subcategory4", "subCategory4", "category4", "category_level_4"])
      const level1Id = level1Name ? level1Map.get(level1Name.trim().toLowerCase()) : undefined
      const level2Id = await ensureSubCategory(level2Name, parentCategoryId, level1Id, 2)
      const level3Id = await ensureSubCategory(level3Name, parentCategoryId, level2Id || level1Id, 3)
      const level4Id = await ensureSubCategory(level4Name, parentCategoryId, level3Id || level2Id || level1Id, 4)

      let stockStatus = row.stockStatus || "Available Product"
      if (!allowedStockStatus.includes(stockStatus)) stockStatus = "Available Product"
      const brandId = row.brand ? brandMap.get(String(row.brand).trim().toLowerCase()) : undefined
      const taxId = row.tax ? taxMap.get(String(row.tax).trim().toLowerCase()) : undefined
      const unitId = row.unit ? unitMap.get(String(row.unit).trim().toLowerCase()) : undefined

      previewProducts.push({
        name: row.name || "",
        slug: row.slug || generateSlug(row.name || ""),
        sku: row.sku || "",
        barcode: row.barcode || "",
        parentCategory: parentCategoryId,
        category: level1Id,
        subCategory2: level2Id,
        subCategory3: level3Id,
        subCategory4: level4Id,
        brand: brandId,
        buyingPrice: Number.parseFloat(row.buyingPrice) || 0,
        price: Number.parseFloat(row.price) || 0,
        offerPrice: Number.parseFloat(row.offerPrice) || 0,
        discount: Number.parseFloat(row.discount) || 0,
        tax: taxId,
        stockStatus,
        showStockOut: row.showStockOut === "true" || row.showStockOut === true,
        canPurchase: row.canPurchase === "true" || row.canPurchase === true,
        refundable: row.refundable === "true" || row.refundable === true,
        maxPurchaseQty: Number.parseInt(row.maxPurchaseQty) || 10,
        lowStockWarning: Number.parseInt(row.lowStockWarning) || 5,
        unit: unitId,
        weight: Number.parseFloat(row.weight) || 0,
        tags: row.tags
          ? String(row.tags)
              .split(",")
              .map((t) => t.trim())
          : [],
        description: row.description || "",
        shortDescription: row.shortDescription || "",
        specifications: row.specifications ? [{ key: "Specifications", value: row.specifications }] : [],
        details: row.details || "",
        countInStock: Number.parseInt(row.countInStock) || 0,
        isActive: true,
        featured: false,
      })
    }

    // Populate for preview
    const populatedPreviewProducts = await Promise.all(
      previewProducts.map(async (prod) => {
        const populated = { ...prod }
        if (prod.parentCategory) {
          const cat = await Category.findById(prod.parentCategory).select("name slug")
          if (cat) populated.parentCategory = { _id: cat._id, name: cat.name, slug: cat.slug }
        }
        const populateSub = async (id) => (id ? await SubCategory.findById(id).select("name slug") : null)
        if (prod.category) {
          const s1 = await populateSub(prod.category)
          if (s1) populated.category = { _id: s1._id, name: s1.name, slug: s1.slug }
        }
        if (prod.subCategory2) {
          const s2 = await populateSub(prod.subCategory2)
          if (s2) populated.subCategory2 = { _id: s2._id, name: s2.name, slug: s2.slug }
        }
        if (prod.subCategory3) {
          const s3 = await populateSub(prod.subCategory3)
          if (s3) populated.subCategory3 = { _id: s3._id, name: s3.name, slug: s3.slug }
        }
        if (prod.subCategory4) {
          const s4 = await populateSub(prod.subCategory4)
          if (s4) populated.subCategory4 = { _id: s4._id, name: s4.name, slug: s4.slug }
        }
        if (prod.brand) {
          const b = await Brand.findById(prod.brand).select("name slug")
          if (b) populated.brand = { _id: b._id, name: b.name, slug: b.slug }
        }
        return populated
      }),
    )

    res.json({
      previewProducts: populatedPreviewProducts,
      invalidRows,
      total: csvData.length,
      valid: previewProducts.length,
      invalid: invalidRows.length,
    })
  }),
)

// @desc    Bulk save products to database
// @route   POST /api/products/bulk-save
// @access  Private/Admin
router.post(
  "/bulk-save",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const products = req.body.products
    if (!Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ message: "No products to save" })
    }

    const results = []
    let success = 0
    let failed = 0
    const allowedStockStatus = ["Available Product", "Out of Stock", "PreOrder"]

    for (const [i, prod] of products.entries()) {
      try {
        // Skip row if all fields are empty/falsy
        if (Object.values(prod).every((v) => !v)) {
          console.log(`Product ${i}: Skipped - Empty row`)
          results.push({ index: i, status: "failed", reason: "Empty row", product: prod })
          failed++
          continue
        }

        // Check for duplicate by name or slug
        const existing = await Product.findOne({
          $or: [{ name: prod.name }, { slug: prod.slug }],
        })

        if (existing) {
          console.log(`Product ${i} (${prod.name}): Failed - Duplicate product`)
          results.push({ index: i, status: "failed", reason: "Duplicate product name or slug", product: prod })
          failed++
          continue
        }

        // Validate required fields
        if (!prod.name || !prod.parentCategory) {
          console.log(`Product ${i}: Failed - Missing required fields (name: ${prod.name}, parentCategory: ${prod.parentCategory})`)
          results.push({ index: i, status: "failed", reason: "Missing required fields (name, parentCategory)", product: prod })
          failed++
          continue
        }

        // Use defaults for missing fields
        let stockStatus = prod.stockStatus || "Available Product"
        if (!allowedStockStatus.includes(stockStatus)) stockStatus = "Available Product"

        // Extract IDs from populated objects or use direct IDs
        const parentCategoryId = prod.parentCategory?._id || prod.parentCategory
  const categoryId = prod.category?._id || prod.category // level 1
  const subCategory2Id = prod.subCategory2?._id || prod.subCategory2
  const subCategory3Id = prod.subCategory3?._id || prod.subCategory3
  const subCategory4Id = prod.subCategory4?._id || prod.subCategory4
        const brandId = prod.brand?._id || prod.brand
        const taxId = prod.tax?._id || prod.tax
        const unitId = prod.unit?._id || prod.unit

        const product = new Product({
          name: prod.name || "",
          slug: prod.slug || generateSlug(prod.name || ""),
          sku: prod.sku || "",
          barcode: prod.barcode || "",
          parentCategory: parentCategoryId, // Main category
          category: categoryId, // Level 1
          subCategory: categoryId, // Backward compatibility
          subCategory2: subCategory2Id,
          subCategory3: subCategory3Id,
          subCategory4: subCategory4Id,
          brand: brandId,
          buyingPrice: prod.buyingPrice || 0,
          price: prod.price || 0,
          offerPrice: prod.offerPrice || 0,
          discount: prod.discount || 0,
          tax: taxId,
          stockStatus,
          showStockOut: prod.showStockOut !== undefined ? Boolean(prod.showStockOut) : true,
          canPurchase: prod.canPurchase !== undefined ? Boolean(prod.canPurchase) : true,
          refundable: prod.refundable !== undefined ? Boolean(prod.refundable) : true,
          maxPurchaseQty: prod.maxPurchaseQty || 10,
          lowStockWarning: prod.lowStockWarning || 5,
          unit: unitId,
          weight: prod.weight || 0,
          tags: prod.tags || [],
          description: prod.description || "",
          shortDescription: prod.shortDescription || "",
          specifications: prod.specifications || [],
          countInStock: prod.countInStock || 0,
          isActive: prod.isActive !== undefined ? Boolean(prod.isActive) : true,
          featured: prod.featured !== undefined ? Boolean(prod.featured) : false,
          createdBy: req.user._id,
        })

        await product.save()
        console.log(`Product ${i} (${prod.name}): SUCCESS`)
        results.push({ index: i, status: "success", product: product })
        success++
      } catch (error) {
        console.log(`Product ${i} (${prod.name}): FAILED - ${error.message}`)
        results.push({ index: i, status: "failed", reason: error.message, product: prod })
        failed++
      }
    }

    console.log(`\n=== BULK SAVE SUMMARY ===`)
    console.log(`Total: ${products.length}, Success: ${success}, Failed: ${failed}`)
    console.log(`========================\n`)

    // Populate category, subcategory, and brand in the results
    const populatedResults = await Promise.all(
      results.map(async (result) => {
        if (!result.product || result.status === "failed") return result

        const prod = { ...result.product.toObject() }

        if (prod.parentCategory) {
          const cat = await Category.findById(prod.parentCategory).select("name slug")
          if (cat) prod.parentCategory = { _id: cat._id, name: cat.name, slug: cat.slug }
        }

        if (prod.category) {
          const sub = await SubCategory.findById(prod.category).select("name slug")
          if (sub) prod.category = { _id: sub._id, name: sub.name, slug: sub.slug }
        }

        if (prod.brand) {
          const brand = await Brand.findById(prod.brand).select("name slug")
          if (brand) prod.brand = { _id: brand._id, name: brand.name, slug: brand.slug }
        }

        return { ...result, product: prod }
      }),
    )

    res.json({
      message: `Bulk save complete`,
      total: products.length,
      success,
      failed,
      results: populatedResults,
      cacheHint: { productsUpdated: true, timestamp: Date.now() },
    })
  }),
)

// @desc    Bulk create products
// @route   POST /api/products/bulk
// @access  Private/Admin
router.post(
  "/bulk",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const { products } = req.body

    if (!products || !Array.isArray(products) || products.length === 0) {
      res.status(400)
      throw new Error("No products provided")
    }

    const results = []
    let successCount = 0
    let failedCount = 0

    for (let i = 0; i < products.length; i++) {
      const productData = products[i]

      try {
        // Find or create parent category
        let parentCategory = null
        if (productData.parentCategory) {
          const parentCategoryStr = String(productData.parentCategory).trim()

          if (mongoose.Types.ObjectId.isValid(parentCategoryStr)) {
            parentCategory = await Category.findById(parentCategoryStr)
          } else {
            parentCategory = await Category.findOne({
              name: parentCategoryStr,
              isDeleted: { $ne: true },
            })

            if (!parentCategory) {
              const slug = parentCategoryStr
                .toLowerCase()
                .replace(/[^a-z0-9\s-]/g, "")
                .replace(/\s+/g, "-")
                .replace(/-+/g, "-")
                .trim()

              parentCategory = new Category({
                name: parentCategoryStr,
                slug: slug,
                isActive: true,
                createdBy: req.user._id,
              })
              await parentCategory.save()
            }
          }
        }

        // Find or create subcategory
        let subCategory = null
        if (productData.category) {
          const categoryStr = String(productData.category).trim()

          if (mongoose.Types.ObjectId.isValid(categoryStr)) {
            subCategory = await SubCategory.findById(categoryStr)
          } else if (parentCategory) {
            subCategory = await SubCategory.findOne({
              name: categoryStr,
              category: parentCategory._id,
              isDeleted: { $ne: true },
            })

            if (!subCategory) {
              const slug = categoryStr
                .toLowerCase()
                .replace(/[^a-z0-9\s-]/g, "")
                .replace(/\s+/g, "-")
                .replace(/-+/g, "-")
                .trim()

              subCategory = new SubCategory({
                name: categoryStr,
                slug: slug,
                category: parentCategory._id,
                isActive: true,
                createdBy: req.user._id,
              })
              await subCategory.save()
            }
          }
        }

        // Find or create brand
        let brand = null
        if (productData.brand) {
          const brandStr = String(productData.brand).trim()

          if (mongoose.Types.ObjectId.isValid(brandStr)) {
            brand = await Brand.findById(brandStr)
          } else {
            brand = await Brand.findOne({
              name: brandStr,
              isDeleted: { $ne: true },
            })

            if (!brand) {
              const slug = brandStr
                .toLowerCase()
                .replace(/[^a-z0-9\s-]/g, "")
                .replace(/\s+/g, "-")
                .replace(/-+/g, "-")
                .trim()

              brand = new Brand({
                name: brandStr,
                slug: slug,
                isActive: true,
                createdBy: req.user._id,
              })
              await brand.save()
            }
          }
        }

        // Handle tax - Find or create tax record
        let tax = null
        if (productData.tax) {
          const taxStr = String(productData.tax).trim()

          if (mongoose.Types.ObjectId.isValid(taxStr)) {
            tax = await Tax.findById(taxStr)
          } else {
            // Try to find existing tax by name
            tax = await Tax.findOne({
              name: taxStr,
              isDeleted: { $ne: true },
            })

            if (!tax) {
              // Create new tax record
              tax = new Tax({
                name: taxStr,
                percentage: taxStr.includes("5") ? 5 : 0, // Extract percentage if possible
                isActive: true,
                createdBy: req.user._id,
              })
              await tax.save()
            }
          }
        }

        // Handle unit - Find or create unit record
        let unit = null
        if (productData.unit) {
          const unitStr = String(productData.unit).trim()

          if (mongoose.Types.ObjectId.isValid(unitStr)) {
            unit = await Unit.findById(unitStr)
          } else {
            unit = await Unit.findOne({
              name: unitStr,
              isDeleted: { $ne: true },
            })

            if (!unit) {
              unit = new Unit({
                name: unitStr,
                isActive: true,
                createdBy: req.user._id,
              })
              await unit.save()
            }
          }
        }

        // Generate unique slug
        const productName = String(productData.name || "").trim()
        const baseSlug =
          productData.slug ||
          productName
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, "")
            .replace(/\s+/g, "-")
            .replace(/-+/g, "-")
            .trim()

        // Ensure slug is unique
        let productSlug = baseSlug
        let counter = 1
        while (await Product.findOne({ slug: productSlug })) {
          productSlug = `${baseSlug}-${counter}`
          counter++
        }

        // Check if product with same SKU already exists
        const existingProduct = await Product.findOne({ sku: productData.sku })
        if (existingProduct) {
          results.push({
            status: "error",
            product: productData,
            message: `Product with SKU '${productData.sku}' already exists`,
            originalIndex: i,
          })
          failedCount++
          continue
        }

        // Create the product with proper ObjectId references
        const product = new Product({
          name: productName,
          slug: productSlug,
          sku: String(productData.sku || "").trim(),
          parentCategory: parentCategory?._id,
          category: subCategory?._id,
          brand: brand?._id,
          tax: tax?._id, // Use ObjectId reference
          unit: unit?._id, // Use ObjectId reference
          buyingPrice: Number(productData.buyingPrice) || 0,
          price: Number(productData.price) || 0,
          offerPrice: Number(productData.offerPrice) || 0,
          stockStatus: String(productData.stockStatus || "Available Product").trim(),
          showStockOut: productData.showStockOut !== undefined ? Boolean(productData.showStockOut) : true,
          canPurchase: productData.canPurchase !== undefined ? Boolean(productData.canPurchase) : true,
          refundable: productData.refundable !== undefined ? Boolean(productData.refundable) : true,
          maxPurchaseQty: Number(productData.maxPurchaseQty) || 10,
          lowStockWarning: Number(productData.lowStockWarning) || 5,
          weight: Number(productData.weight) || 0,
          tags: productData.tags
            ? String(productData.tags)
                .split(",")
                .map((tag) => tag.trim())
                .filter((tag) => tag)
            : [],
          description: String(productData.description || "").trim(),
          discount: Number(productData.discount) || 0,
          specifications: productData.specifications
            ? [
                {
                  key: "Specifications",
                  value: String(productData.specifications).trim(),
                },
              ]
            : [],
          details: String(productData.details || "").trim(),
          shortDescription: String(productData.shortDescription || "").trim(),
          barcode: String(productData.barcode || "").trim(),
          isActive: true,
          countInStock: Number(productData.countInStock) || 0,
          createdBy: req.user._id,
        })

        await product.save()

        results.push({
          status: "success",
          product: {
            _id: product._id,
            name: product.name,
            sku: product.sku,
          },
          originalIndex: i,
        })
        successCount++
      } catch (error) {
        console.error(`Error creating product ${i + 1}:`, error)
        results.push({
          status: "error",
          product: productData,
          message: error.message || "Failed to create product",
          details: error.stack,
          originalIndex: i,
        })
        failedCount++
      }
    }

    res.json({
      success: true,
      message: `Bulk import completed. ${successCount} products created, ${failedCount} failed.`,
      successCount,
      failedCount,
      results,
      summary: {
        total: products.length,
        success: successCount,
        failed: failedCount,
      },
    })
  }),
)

export default router
