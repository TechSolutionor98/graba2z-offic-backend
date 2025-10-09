// import express from "express"
// import asyncHandler from "express-async-handler"
// import Product from "../models/productModel.js"
// import Category from "../models/categoryModel.js"
// import Brand from "../models/brandModel.js"
// import SubCategory from "../models/subCategoryModel.js"
// import { protect, admin } from "../middleware/authMiddleware.js"
// import multer from "multer"
// import XLSX from "xlsx"
// import fs from "fs"
// import Tax from "../models/taxModel.js"
// import Unit from "../models/unitModel.js"
// import Color from "../models/colorModel.js"
// import Warranty from "../models/warrantyModel.js"
// import Size from "../models/sizeModel.js"
// import Volume from "../models/volumeModel.js"
// import mongoose from "mongoose"

// const router = express.Router()

// // Multer setup for Excel parsing (use memory storage for Vercel compatibility)
// const excelUpload = multer({ storage: multer.memoryStorage() })

// // Helper: map Excel columns to backend keys
// const excelToBackendKey = {
//   name: "name",
//   slug: "slug",
//   SKU: "sku",
//   sku: "sku",
//   category: "category",
//   parent_category: "parent_category",
//   barcode: "barcode",
//   buying_price: "buyingPrice",
//   selling_price: "price",
//   offer_price: "offerPrice",
//   tax: "tax",
//   brand: "brand",
//   status: "stockStatus",
//   show_stock_out: "showStockOut",
//   can_purchasable: "canPurchase",
//   refundable: "refundable",
//   max_purchase_quantity: "maxPurchaseQty",
//   low_stock_warning: "lowStockWarning",
//   unit: "unit",
//   weight: "weight",
//   tags: "tags",
//   description: "description",
//   discount: "discount",
//   specifications: "specifications",
//   details: "details",
//   short_description: "shortDescription",
//   subCategory: "subCategory",
//   warranty: "warranty",
//   size: "size",
//   volume: "volume",
// }

// function remapRow(row) {
//   const mapped = {}
//   const specifications = []
//   for (const key in row) {
//     const backendKey = excelToBackendKey[key.trim()] || key.trim()
//     if (excelToBackendKey[key.trim()]) {
//       mapped[backendKey] = row[key]
//     } else {
//       // If not a standard field, treat as specification
//       if (row[key] !== undefined && row[key] !== "") {
//         specifications.push({ key: key.trim(), value: String(row[key]) })
//       }
//     }
//   }
//   if (specifications.length > 0) {
//     mapped.specifications = specifications
//   }
//   return mapped
// }

// function generateSlug(name) {
//   return name.trim().toLowerCase().replace(/\s+/g, "-")
// }

// // Helper to escape regex special characters
// function escapeRegex(string) {
//   return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
// }

// // @desc    Fetch all products (Admin only - includes inactive)
// // @route   GET /api/products/admin
// // @access  Private/Admin
// router.get("/admin", protect, admin, async (req, res) => {
//   try {
//     const { search, category, subcategory, parentCategory, limit = 20, page = 1 } = req.query
//     const query = {}
//     const orConditions = []

//     if (category) query.category = category
//     if (subcategory) query.subCategory = subcategory
//     if (parentCategory) query.parentCategory = parentCategory

//     if (typeof search === "string" && search.trim() !== "") {
//       const safeSearch = escapeRegex(search)
//       const regex = new RegExp(safeSearch, "i")
//       // Find matching brands by name
//       const matchingBrands = await Brand.find({ name: regex }).select("_id")
//       const brandIds = matchingBrands.map((b) => b._id)
//       orConditions.push(
//         { name: regex },
//         { description: regex },
//         { sku: regex },
//         { barcode: regex },
//         { tags: regex },
//         { brand: { $in: brandIds } },
//       )
//     }
//     if (orConditions.length > 0) {
//       query.$or = orConditions
//     }

//     // Get total count for pagination
//     const totalCount = await Product.countDocuments(query)

//     let productsQuery = Product.find(query)
//       .populate("brand category subCategory parentCategory")
//       .sort({ createdAt: -1 })

//     // Pagination
//     const skip = (page - 1) * limit
//     productsQuery = productsQuery.skip(skip).limit(Number.parseInt(limit))

//     const products = await productsQuery
//     res.json({ products, totalCount })
//   } catch (error) {
//     console.error(error)
//     res.status(500).json({ message: "Server error" })
//   }
// })

// // @desc    Fetch all products
// // @route   GET /api/products
// // @access  Public
// router.get(
//   "/",
//   asyncHandler(async (req, res) => {
//     const { category, subcategory, parentCategory, featured, search, brand, limit } = req.query

//     const andConditions = [{ isActive: true }]

//     // Category filter
//     if (category && category !== "all" && category.match(/^[0-9a-fA-F]{24}$/)) {
//       andConditions.push({ category })
//     }

//     // Parent category filter (only if subcategory is not present)
//     if (!subcategory && parentCategory && parentCategory.match(/^[0-9a-fA-F]{24}$/)) {
//       andConditions.push({ parentCategory })
//     }

//     // Subcategory filter
//     if (subcategory && subcategory.match(/^[0-9a-fA-F]{24}$/)) {
//       andConditions.push({ $or: [{ category: subcategory }, { subCategory: subcategory }] })
//     }

//     // Search filter
//     if (typeof search === "string" && search.trim()) {
//       const safeSearch = escapeRegex(search.trim())
//       const regex = new RegExp(safeSearch, "i")

//       // Find matching brands by name for search
//       const matchingBrands = await Brand.find({ name: regex }).select("_id").lean()
//       const brandIds = matchingBrands.map((b) => b._id)

//       andConditions.push({
//         $or: [
//           { name: regex },
//           { description: regex },
//           { sku: regex },
//           { barcode: regex },
//           { tags: regex },
//           { brand: { $in: brandIds } },
//         ],
//       })
//     }

//     // Brand filter
//     if (brand) {
//       if (Array.isArray(brand)) {
//         andConditions.push({ brand: { $in: brand } })
//       } else if (typeof brand === "string" && brand.match(/^[0-9a-fA-F]{24}$/)) {
//         andConditions.push({ brand })
//       }
//     }

//     // Featured filter
//     if (featured === "true") {
//       andConditions.push({ featured: true })
//     }

//     const query = andConditions.length > 1 ? { $and: andConditions } : andConditions[0]

//     // Optimize query by selecting only necessary fields and using lean()
//     let productsQuery = Product.find(query)
//       .select(
//         "name slug sku price offerPrice discount image countInStock stockStatus brand category parentCategory featured tags createdAt rating numReviews",
//       )
//       .populate("brand", "name slug")
//       .populate("category", "name slug")
//       .populate("parentCategory", "name slug")
//       .lean() // Use lean() for better performance
//       .sort({ createdAt: -1 })

//     // Apply limit only if specified (for specific use cases)
//     if (limit && !isNaN(limit)) {
//       productsQuery = productsQuery.limit(Number.parseInt(limit))
//     }

//     const products = await productsQuery

//     res.json(products)
//   }),
// )

// // @desc    Fetch products with pagination (for specific use cases)
// // @route   GET /api/products/paginated
// // @access  Public
// router.get(
//   "/paginated",
//   asyncHandler(async (req, res) => {
//     const { category, subcategory, parentCategory, featured, search, page = 1, limit = 20, brand } = req.query

//     const andConditions = [{ isActive: true }]

//     if (category && category !== "all" && category.match(/^[0-9a-fA-F]{24}$/)) {
//       andConditions.push({ category })
//     }
//     if (!subcategory && parentCategory && parentCategory.match(/^[0-9a-fA-F]{24}$/)) {
//       andConditions.push({ parentCategory })
//     }
//     if (subcategory && subcategory.match(/^[0-9a-fA-F]{24}$/)) {
//       andConditions.push({ $or: [{ category: subcategory }, { subCategory: subcategory }] })
//     }

//     if (typeof search === "string" && search.trim()) {
//       const safeSearch = escapeRegex(search.trim())
//       const regex = new RegExp(safeSearch, "i")
//       const matchingBrands = await Brand.find({ name: regex }).select("_id").lean()
//       const brandIds = matchingBrands.map((b) => b._id)

//       andConditions.push({
//         $or: [
//           { name: regex },
//           { description: regex },
//           { sku: regex },
//           { barcode: regex },
//           { tags: regex },
//           { brand: { $in: brandIds } },
//         ],
//       })
//     }

//     if (brand) {
//       if (Array.isArray(brand)) {
//         andConditions.push({ brand: { $in: brand } })
//       } else if (typeof brand === "string" && brand.match(/^[0-9a-fA-F]{24}$/)) {
//         andConditions.push({ brand })
//       }
//     }

//     if (featured === "true") {
//       andConditions.push({ featured: true })
//     }

//     const query = andConditions.length > 1 ? { $and: andConditions } : andConditions[0]

//     // Get total count for pagination info
//     const totalCount = await Product.countDocuments(query)

//     const products = await Product.find(query)
//       .select(
//         "name slug sku price offerPrice discount image countInStock stockStatus brand category parentCategory featured tags createdAt rating numReviews",
//       )
//       .populate("brand", "name slug")
//       .populate("category", "name slug")
//       .populate("parentCategory", "name slug")
//       .lean()
//       .skip((page - 1) * Number.parseInt(limit))
//       .limit(Number.parseInt(limit))
//       .sort({ createdAt: -1 })

//     res.json({
//       products,
//       totalCount,
//       currentPage: Number.parseInt(page),
//       totalPages: Math.ceil(totalCount / Number.parseInt(limit)),
//       hasMore: Number.parseInt(page) * Number.parseInt(limit) < totalCount,
//     })
//   }),
// )

// // @desc    Fetch products by SKU array
// // @route   POST /api/products/by-skus
// // @access  Public
// router.post(
//   "/by-skus",
//   asyncHandler(async (req, res) => {
//     const { skus } = req.body

//     if (!skus || !Array.isArray(skus)) {
//       return res.status(400).json({ message: "SKUs array is required" })
//     }

//     const products = await Product.find({
//       sku: { $in: skus },
//       isActive: true,
//     })
//       .populate("category", "name slug")
//       .populate("subCategory", "name slug")
//       .populate("brand", "name slug")
//       .populate("parentCategory", "name slug")

//     res.json(products)
//   }),
// )

// // @desc    Fetch single product by ID
// // @route   GET /api/products/:id
// // @access  Public
// router.get(
//   "/:id",
//   asyncHandler(async (req, res) => {
//     const product = await Product.findById(req.params.id).populate("category", "name slug").populate("brand", "name")

//     if (product && product.isActive) {
//       res.json(product)
//     } else {
//       res.status(404)
//       throw new Error("Product not found")
//     }
//   }),
// )

// // @desc    Fetch single product by slug
// // @route   GET /api/products/slug/:slug
// // @access  Public
// router.get(
//   "/slug/:slug",
//   asyncHandler(async (req, res) => {
//     const product = await Product.findOne({ slug: req.params.slug, isActive: true })
//       .populate("category", "name slug")
//       .populate("brand", "name")

//     if (product) {
//       res.json(product)
//     } else {
//       res.status(404)
//       throw new Error("Product not found")
//     }
//   }),
// )

// // @desc    Create a product review
// // @route   POST /api/products/:id/reviews
// // @access  Private
// router.post(
//   "/:id/reviews",
//   protect,
//   asyncHandler(async (req, res) => {
//     const { rating, comment, name } = req.body

//     const product = await Product.findById(req.params.id)

//     if (product) {
//       const alreadyReviewed = product.reviews.find((r) => r.user.toString() === req.user._id.toString())

//       if (alreadyReviewed) {
//         res.status(400)
//         throw new Error("Product already reviewed")
//       }

//       const review = {
//         name: name || req.user.name,
//         rating: Number(rating),
//         comment,
//         user: req.user._id,
//         createdAt: new Date(),
//       }

//       product.reviews.push(review)

//       // Properly calculate numReviews and rating
//       product.numReviews = product.reviews.length
//       product.rating = product.reviews.reduce((acc, item) => Number(item.rating) + acc, 0) / product.reviews.length

//       await product.save()

//       // Log the updated values for debugging
//       console.log(
//         "Review added - Product:",
//         product.name,
//         "New Rating:",
//         product.rating,
//         "NumReviews:",
//         product.numReviews,
//       )

//       res.status(201).json({ message: "Review added", rating: product.rating, numReviews: product.numReviews })
//     } else {
//       res.status(404)
//       throw new Error("Product not found")
//     }
//   }),
// )

// // @desc    Create a product
// // @route   POST /api/products
// // @access  Private/Admin
// router.post(
//   "/",
//   protect,
//   admin,
//   asyncHandler(async (req, res) => {
//     const { parentCategory, category, ...productData } = req.body

//     // Verify parentCategory exists
//     if (parentCategory) {
//       const parentCategoryExists = await Category.findById(parentCategory)
//       if (!parentCategoryExists) {
//         res.status(400)
//         throw new Error("Invalid parent category")
//       }
//     } else {
//       res.status(400)
//       throw new Error("Parent category is required")
//     }

//     // Verify subcategory exists if provided
//     if (category) {
//       const subCategoryExists = await SubCategory.findById(category)
//       if (!subCategoryExists) {
//         res.status(400)
//         throw new Error("Invalid subcategory")
//       }
//     }

//     // Check if slug is unique
//     if (productData.slug) {
//       const existingProduct = await Product.findOne({ slug: productData.slug })
//       if (existingProduct) {
//         res.status(400)
//         throw new Error("Product slug already exists")
//       }
//     }

//     const product = new Product({
//       ...productData,
//       parentCategory,
//       category,
//       subCategory: category || undefined, // for backward compatibility
//       createdBy: req.user._id,
//     })

//     const createdProduct = await product.save()
//     const populatedProduct = await Product.findById(createdProduct._id)
//       .populate("parentCategory", "name slug")
//       .populate("category", "name slug")
//       .populate("brand", "name")
//     res.status(201).json(populatedProduct)
//   }),
// )

// // @desc    Update a product
// // @route   PUT /api/products/:id
// // @access  Private/Admin
// router.put(
//   "/:id",
//   protect,
//   admin,
//   asyncHandler(async (req, res) => {
//     const product = await Product.findById(req.params.id)

//     if (product) {
//       const { parentCategory, category, slug, ...updateData } = req.body

//       // Verify parentCategory exists if provided
//       if (parentCategory) {
//         const parentCategoryExists = await Category.findById(parentCategory)
//         if (!parentCategoryExists) {
//           res.status(400)
//           throw new Error("Invalid parent category")
//         }
//       }

//       // Verify subcategory exists if provided
//       if (category) {
//         const subCategoryExists = await SubCategory.findById(category)
//         if (!subCategoryExists) {
//           res.status(400)
//           throw new Error("Invalid subcategory")
//         }
//       }

//       // Check if slug is unique (excluding current product)
//       if (slug && slug !== product.slug) {
//         const existingProduct = await Product.findOne({ slug, _id: { $ne: req.params.id } })
//         if (existingProduct) {
//           res.status(400)
//           throw new Error("Product slug already exists")
//         }
//       }

//       // Update product fields
//       Object.keys(updateData).forEach((key) => {
//         product[key] = updateData[key]
//       })

//       if (parentCategory) product.parentCategory = parentCategory
//       if (category) {
//         product.category = category
//         product.subCategory = category // for backward compatibility
//       }
//       if (slug) product.slug = slug

//       const updatedProduct = await product.save()
//       const populatedProduct = await Product.findById(updatedProduct._id)
//         .populate("parentCategory", "name slug")
//         .populate("category", "name slug")
//         .populate("brand", "name")
//       res.json(populatedProduct)
//     } else {
//       res.status(404)
//       throw new Error("Product not found")
//     }
//   }),
// )

// // @desc    Delete a product
// // @route   DELETE /api/products/:id
// // @access  Private/Admin
// router.delete(
//   "/:id",
//   protect,
//   admin,
//   asyncHandler(async (req, res) => {
//     const product = await Product.findById(req.params.id)

//     if (product) {
//       await product.deleteOne()
//       res.json({ message: "Product removed" })
//     } else {
//       res.status(404)
//       throw new Error("Product not found")
//     }
//   }),
// )

// // @desc    Get products by category
// // @route   GET /api/products/category/:categoryId
// // @access  Public
// router.get(
//   "/category/:categoryId",
//   asyncHandler(async (req, res) => {
//     const products = await Product.find({
//       category: req.params.categoryId,
//       isActive: true,
//     })
//       .populate("category", "name slug")
//       .populate("brand", "name")
//       .sort({ createdAt: -1 })

//     res.json(products)
//   }),
// )

// // @desc    Bulk preview products from Excel
// // @route   POST /api/products/bulk-preview
// // @access  Private/Admin
// router.post(
//   "/bulk-preview",
//   protect,
//   admin,
//   excelUpload.single("file"),
//   asyncHandler(async (req, res) => {
//     console.log("--- BULK PREVIEW START ---")
//     if (!req.file) {
//       console.log("No file uploaded")
//       return res.status(400).json({ message: "No file uploaded" })
//     }
//     try {
//       // Read Excel file
//       const workbook = XLSX.readFile(req.file.path)
//       const sheetName = workbook.SheetNames[0]
//       const sheet = workbook.Sheets[sheetName]
//       const rows = XLSX.utils.sheet_to_json(sheet)
//       console.log("Excel rows loaded:", rows.length)

//       // Remove uploaded file after parsing
//       fs.unlinkSync(req.file.path)
//       console.log("File unlinked")

//       // Only declare mappedRows ONCE after reading rows:
//       const mappedRows = rows.map(remapRow)
//       console.log("Rows mapped")

//       // Collect all unique category, brand, subCategory, tax, unit, color, warranty, size, volume names
//       const uniqueCategoryNames = new Set()
//       const uniqueBrandNames = new Set()
//       const uniqueSubCategoryNames = new Set()
//       const uniqueTaxNames = new Set()
//       const uniqueUnitNames = new Set()
//       const uniqueColorNames = new Set()
//       const uniqueWarrantyNames = new Set()
//       const uniqueSizeNames = new Set()
//       const uniqueVolumeNames = new Set()
//       mappedRows.forEach((row) => {
//         if (row.category) uniqueCategoryNames.add(String(row.category).trim())
//         if (row.brand) uniqueBrandNames.add(String(row.brand).trim())
//         if (row.subCategory) uniqueSubCategoryNames.add(String(row.subCategory).trim())
//         if (row.tax) uniqueTaxNames.add(String(row.tax).trim())
//         if (row.unit) uniqueUnitNames.add(String(row.unit).trim())
//         if (row.color) uniqueColorNames.add(String(row.color).trim())
//         if (row.warranty) uniqueWarrantyNames.add(String(row.warranty).trim())
//         if (row.size) uniqueSizeNames.add(String(row.size).trim())
//         if (row.volume) uniqueVolumeNames.add(String(row.volume).trim())
//       })
//       console.log("Unique names collected")

//       // Query DB for existing categories/brands/subCategories
//       const allCategories = await Category.find({ name: { $in: Array.from(uniqueCategoryNames) } })
//       const allBrands = await Brand.find({ name: { $in: Array.from(uniqueBrandNames) } })
//       const allSubCategories = await SubCategory.find({ name: { $in: Array.from(uniqueSubCategoryNames) } })
//       const allTaxes = await Tax.find({ name: { $in: Array.from(uniqueTaxNames) } })
//       const allUnits = await Unit.find({ name: { $in: Array.from(uniqueUnitNames) } })
//       const allColors = await Color.find({ name: { $in: Array.from(uniqueColorNames) } })
//       const allWarranties = await Warranty.find({ name: { $in: Array.from(uniqueWarrantyNames) } })
//       const allSizes = await Size.find({ name: { $in: Array.from(uniqueSizeNames) } })
//       const allVolumes = await Volume.find({ name: { $in: Array.from(uniqueVolumeNames) } })
//       const categoryMap = new Map()
//       allCategories.forEach((cat) => categoryMap.set(cat.name.trim().toLowerCase(), cat._id))
//       const brandMap = new Map()
//       allBrands.forEach((brand) => brandMap.set(brand.name.trim().toLowerCase(), brand._id))
//       const subCategoryMap = new Map()
//       allSubCategories.forEach((sub) => subCategoryMap.set(sub.name.trim().toLowerCase(), sub._id))
//       const taxMap = new Map()
//       allTaxes.forEach((tax) => taxMap.set(tax.name.trim().toLowerCase(), tax._id))
//       const unitMap = new Map()
//       allUnits.forEach((unit) => unitMap.set(unit.name.trim().toLowerCase(), unit._id))
//       const colorMap = new Map()
//       allColors.forEach((color) => colorMap.set(color.name.trim().toLowerCase(), color._id))
//       const warrantyMap = new Map()
//       allWarranties.forEach((w) => warrantyMap.set(w.name.trim().toLowerCase(), w._id))
//       const sizeMap = new Map()
//       allSizes.forEach((s) => sizeMap.set(s.name.trim().toLowerCase(), s._id))
//       const volumeMap = new Map()
//       allVolumes.forEach((v) => volumeMap.set(v.name.trim().toLowerCase(), v._id))
//       for (const name of uniqueCategoryNames) {
//         const slug = generateSlug(name)
//         const existingCategoryBySlug = await Category.findOne({ slug })
//         if (!categoryMap.has(name.trim().toLowerCase()) && !existingCategoryBySlug) {
//           const newCat = await Category.create({ name: name.trim(), slug, createdBy: req.user?._id })
//           categoryMap.set(name.trim().toLowerCase(), newCat._id)
//         } else if (existingCategoryBySlug) {
//           categoryMap.set(name.trim().toLowerCase(), existingCategoryBySlug._id)
//         }
//       }
//       for (const name of uniqueBrandNames) {
//         const brandSlug = generateSlug(name)
//         const existingBrandBySlug = await Brand.findOne({ slug: brandSlug })
//         if (!brandMap.has(name.trim().toLowerCase()) && !existingBrandBySlug) {
//           const newBrand = await Brand.create({ name: name.trim(), slug: brandSlug, createdBy: req.user?._id })
//           brandMap.set(name.trim().toLowerCase(), newBrand._id)
//         } else if (existingBrandBySlug) {
//           brandMap.set(name.trim().toLowerCase(), existingBrandBySlug._id)
//         }
//       }
//       for (const name of uniqueSubCategoryNames) {
//         const subSlug = generateSlug(name)
//         const existingSubCategoryBySlug = await SubCategory.findOne({ slug: subSlug })
//         if (!subCategoryMap.has(name.trim().toLowerCase()) && !existingSubCategoryBySlug) {
//           let parentCategoryId = undefined
//           const rowWithParent = mappedRows.find(
//             (r) =>
//               r.subCategory && String(r.subCategory).trim().toLowerCase() === name.trim().toLowerCase() && r.category,
//           )
//           if (rowWithParent && rowWithParent.category) {
//             parentCategoryId = categoryMap.get(String(rowWithParent.category).trim().toLowerCase())
//           }
//           const newSub = await SubCategory.create({
//             name: name.trim(),
//             slug: subSlug,
//             category: parentCategoryId,
//             createdBy: req.user?._id,
//           })
//           subCategoryMap.set(name.trim().toLowerCase(), newSub._id)
//         } else if (existingSubCategoryBySlug) {
//           subCategoryMap.set(name.trim().toLowerCase(), existingSubCategoryBySlug._id)
//         }
//       }
//       for (const name of uniqueTaxNames) {
//         if (!taxMap.has(name.trim().toLowerCase())) {
//           const newTax = await Tax.create({ name: name.trim(), createdBy: req.user?._id })
//           taxMap.set(name.trim().toLowerCase(), newTax._id)
//         }
//       }
//       for (const name of uniqueUnitNames) {
//         if (!unitMap.has(name.trim().toLowerCase())) {
//           const symbol = name.trim().length <= 3 ? name.trim() : name.trim().charAt(0)
//           const newUnit = await Unit.create({ name: name.trim(), symbol, type: "piece", createdBy: req.user?._id })
//           unitMap.set(name.trim().toLowerCase(), newUnit._id)
//         }
//       }
//       for (const name of uniqueColorNames) {
//         if (!colorMap.has(name.trim().toLowerCase())) {
//           const newColor = await Color.create({ name: name.trim(), createdBy: req.user?._id })
//           colorMap.set(name.trim().toLowerCase(), newColor._id)
//         }
//       }
//       for (const name of uniqueWarrantyNames) {
//         if (!warrantyMap.has(name.trim().toLowerCase())) {
//           const newWarranty = await Warranty.create({ name: name.trim(), createdBy: req.user?._id })
//           warrantyMap.set(name.trim().toLowerCase(), newWarranty._id)
//         }
//       }
//       for (const name of uniqueSizeNames) {
//         if (!sizeMap.has(name.trim().toLowerCase())) {
//           const newSize = await Size.create({ name: name.trim(), createdBy: req.user?._id })
//           sizeMap.set(name.trim().toLowerCase(), newSize._id)
//         }
//       }
//       for (const name of uniqueVolumeNames) {
//         if (!volumeMap.has(name.trim().toLowerCase())) {
//           const newVolume = await Volume.create({ name: name.trim(), createdBy: req.user?._id })
//           volumeMap.set(name.trim().toLowerCase(), newVolume._id)
//         }
//       }
//       console.log("Existing related records fetched")

//       // Collect all names and slugs from Excel
//       const names = rows.map((r) => r.name).filter(Boolean)
//       const slugs = rows.map((r) => r.slug).filter(Boolean)
//       const existingProducts = await Product.find({ $or: [{ name: { $in: names } }, { slug: { $in: slugs } }] })
//       const existingNames = new Set(existingProducts.map((p) => p.name))
//       const existingSlugs = new Set(existingProducts.map((p) => p.slug))

//       // Validate and map rows to product schema
//       const previewProducts = []
//       const invalidRows = []
//       const allowedStockStatus = ["Available Product", "Out of Stock", "PreOrder"]
//       for (const [i, row] of mappedRows.entries()) {
//         // Skip row if all fields are empty/falsy
//         if (Object.values(row).every((v) => !v)) {
//           invalidRows.push({ row: i + 2, reason: "Empty row", data: row })
//           continue
//         }
//         // Use batch maps for category and brand
//         let categoryId = undefined
//         let brandId = undefined
//         if (row.category) {
//           categoryId = categoryMap.get(String(row.category).trim().toLowerCase())
//         }
//         if (row.brand) {
//           brandId = brandMap.get(String(row.brand).trim().toLowerCase())
//         }
//         // Check for duplicate by name or slug
//         if ((row.name && existingNames.has(row.name)) || (row.slug && existingSlugs.has(row.slug))) {
//           invalidRows.push({ row: i + 2, reason: "Duplicate product name or slug", data: row })
//           continue
//         }
//         // Prepare product for preview, using defaults for missing fields
//         let stockStatus = row.stockStatus || "Available Product"
//         if (!allowedStockStatus.includes(stockStatus)) stockStatus = "Available Product"
//         previewProducts.push({
//           name: row.name || "",
//           price: row.price || 0,
//           offerPrice: row.offerPrice || 0,
//           discount: row.discount || 0,
//           oldPrice: row.oldPrice || 0,
//           image: row.image || "",
//           galleryImages: row.galleryImages ? String(row.galleryImages).split(",") : [],
//           countInStock: row.countInStock || 0,
//           description: row.description || "",
//           shortDescription: row.shortDescription || "",
//           category: categoryId,
//           brand: brandId,
//           sku: row.sku || "",
//           slug: row.slug || "",
//           barcode: row.barcode || "",
//           stockStatus,
//           buyingPrice: row.buyingPrice || 0,
//           lowStockWarning: row.lowStockWarning || 5,
//           maxPurchaseQty: row.maxPurchaseQty || 10,
//           weight: row.weight || 0,
//           unit: row.unit ? unitMap.get(String(row.unit).trim().toLowerCase()) : undefined,
//           color: row.color ? colorMap.get(String(row.color).trim().toLowerCase()) : undefined,
//           tax: row.tax ? taxMap.get(String(row.tax).trim().toLowerCase()) : undefined,
//           tags: row.tags ? String(row.tags).split(",") : [],
//           isActive: row.isActive !== undefined ? Boolean(row.isActive) : true,
//           canPurchase: row.canPurchase !== undefined ? Boolean(row.canPurchase) : true,
//           showStockOut: row.showStockOut !== undefined ? Boolean(row.showStockOut) : true,
//           refundable: row.refundable !== undefined ? Boolean(row.refundable) : true,
//           featured: row.featured !== undefined ? Boolean(row.featured) : false,
//           subCategory: row.subCategory ? subCategoryMap.get(String(row.subCategory).trim().toLowerCase()) : undefined,
//           warranty: row.warranty ? warrantyMap.get(String(row.warranty).trim().toLowerCase()) : undefined,
//           size: row.size ? sizeMap.get(String(row.size).trim().toLowerCase()) : undefined,
//           volume: row.volume ? volumeMap.get(String(row.volume).trim().toLowerCase()) : undefined,
//         })
//       }
//       console.log("Preview products built")

//       // Populate category, subCategory, and brand for previewProducts
//       const populatedPreviewProducts = await Promise.all(
//         previewProducts.map(async (prod) => {
//           const populated = { ...prod }
//           if (prod.category) {
//             const cat = await Category.findById(prod.category).select("name slug")
//             if (cat) populated.category = { _id: cat._id, name: cat.name, slug: cat.slug }
//           }
//           if (prod.subCategory) {
//             const sub = await SubCategory.findById(prod.subCategory).select("name slug")
//             if (sub) populated.subCategory = { _id: sub._id, name: sub.name, slug: sub.slug }
//           }
//           if (prod.brand) {
//             const brand = await Brand.findById(prod.brand).select("name slug")
//             if (brand) populated.brand = { _id: brand._id, name: brand.name, slug: brand.slug }
//           }
//           return populated
//         }),
//       )
//       res.json({
//         previewProducts: populatedPreviewProducts,
//         invalidRows,
//         total: rows.length,
//         valid: previewProducts.length,
//         invalid: invalidRows.length,
//       })
//     } catch (error) {
//       console.error("Bulk preview error:", error)
//       if (req.file && req.file.path && fs.existsSync(req.file.path)) {
//         fs.unlinkSync(req.file.path)
//       }
//       res.status(500).json({ message: "Bulk preview failed", error: error.message })
//     }
//   }),
// )

// // @desc    Bulk preview products from CSV
// // @route   POST /api/products/bulk-preview-csv
// // @access  Private/Admin
// router.post(
//   "/bulk-preview-csv",
//   protect,
//   admin,
//   asyncHandler(async (req, res) => {
//     console.log("--- CSV BULK PREVIEW START ---")
//     const { csvData } = req.body

//     if (!csvData || !Array.isArray(csvData)) {
//       return res.status(400).json({ message: "No CSV data provided" })
//     }

//     try {
//       console.log("CSV data received:", csvData.length, "rows")

//       // Collect all unique parent_category, category (subcategory), brand names
//       const uniqueParentCategoryNames = new Set()
//       const uniqueCategoryNames = new Set() // These will be subcategories
//       const uniqueBrandNames = new Set()
//       const uniqueTaxNames = new Set()
//       const uniqueUnitNames = new Set()

//       csvData.forEach((row) => {
//         if (row.parent_category) uniqueParentCategoryNames.add(String(row.parent_category).trim())
//         if (row.category) uniqueCategoryNames.add(String(row.category).trim())
//         if (row.brand) uniqueBrandNames.add(String(row.brand).trim())
//         if (row.tax) uniqueTaxNames.add(String(row.tax).trim())
//         if (row.unit) uniqueUnitNames.add(String(row.unit).trim())
//       })

//       console.log("Unique names collected")

//       // Query DB for existing records
//       const allParentCategories = await Category.find({ name: { $in: Array.from(uniqueParentCategoryNames) } })
//       const allSubCategories = await SubCategory.find({ name: { $in: Array.from(uniqueCategoryNames) } })
//       const allBrands = await Brand.find({ name: { $in: Array.from(uniqueBrandNames) } })
//       const allTaxes = await Tax.find({ name: { $in: Array.from(uniqueTaxNames) } })
//       const allUnits = await Unit.find({ name: { $in: Array.from(uniqueUnitNames) } })

//       // Create maps for quick lookup
//       const parentCategoryMap = new Map()
//       allParentCategories.forEach((cat) => parentCategoryMap.set(cat.name.trim().toLowerCase(), cat._id))

//       const subCategoryMap = new Map()
//       allSubCategories.forEach((sub) => subCategoryMap.set(sub.name.trim().toLowerCase(), sub._id))

//       const brandMap = new Map()
//       allBrands.forEach((brand) => brandMap.set(brand.name.trim().toLowerCase(), brand._id))

//       const taxMap = new Map()
//       allTaxes.forEach((tax) => taxMap.set(tax.name.trim().toLowerCase(), tax._id))

//       const unitMap = new Map()
//       allUnits.forEach((unit) => unitMap.set(unit.name.trim().toLowerCase(), unit._id))

//       // Create missing parent categories (main categories)
//       for (const name of uniqueParentCategoryNames) {
//         const slug = generateSlug(name)
//         const existingCategoryBySlug = await Category.findOne({ slug })
//         if (!parentCategoryMap.has(name.trim().toLowerCase()) && !existingCategoryBySlug) {
//           const newCat = await Category.create({ name: name.trim(), slug, createdBy: req.user?._id })
//           parentCategoryMap.set(name.trim().toLowerCase(), newCat._id)
//         } else if (existingCategoryBySlug) {
//           parentCategoryMap.set(name.trim().toLowerCase(), existingCategoryBySlug._id)
//         }
//       }
//       // Create missing subcategories
//       for (const name of uniqueCategoryNames) {
//         const subSlug = generateSlug(name)
//         const existingSubCategoryBySlug = await SubCategory.findOne({ slug: subSlug })
//         if (!subCategoryMap.has(name.trim().toLowerCase()) && !existingSubCategoryBySlug) {
//           // Find the parent category for this subcategory from CSV data
//           let parentCategoryId = undefined
//           const rowWithParent = csvData.find(
//             (r) =>
//               r.category && String(r.category).trim().toLowerCase() === name.trim().toLowerCase() && r.parent_category,
//           )
//           if (rowWithParent && rowWithParent.parent_category) {
//             parentCategoryId = parentCategoryMap.get(String(rowWithParent.parent_category).trim().toLowerCase())
//           }
//           const newSub = await SubCategory.create({
//             name: name.trim(),
//             slug: subSlug,
//             category: parentCategoryId, // Link to parent category
//             createdBy: req.user?._id,
//           })
//           subCategoryMap.set(name.trim().toLowerCase(), newSub._id)
//         } else if (existingSubCategoryBySlug) {
//           subCategoryMap.set(name.trim().toLowerCase(), existingSubCategoryBySlug._id)
//         }
//       }
//       // Create missing brands
//       for (const name of uniqueBrandNames) {
//         const brandSlug = generateSlug(name)
//         const existingBrandBySlug = await Brand.findOne({ slug: brandSlug })
//         if (!brandMap.has(name.trim().toLowerCase()) && !existingBrandBySlug) {
//           const newBrand = await Brand.create({ name: name.trim(), slug: brandSlug, createdBy: req.user?._id })
//           brandMap.set(name.trim().toLowerCase(), newBrand._id)
//         } else if (existingBrandBySlug) {
//           brandMap.set(name.trim().toLowerCase(), existingBrandBySlug._id)
//         }
//       }

//       // Create missing taxes
//       for (const name of uniqueTaxNames) {
//         if (!taxMap.has(name.trim().toLowerCase())) {
//           const newTax = await Tax.create({
//             name: name.trim(),
//             rate: 5, // Default rate
//             createdBy: req.user?._id,
//           })
//           taxMap.set(name.trim().toLowerCase(), newTax._id)
//         }
//       }

//       // Create missing units
//       for (const name of uniqueUnitNames) {
//         if (!unitMap.has(name.trim().toLowerCase())) {
//           const symbol = name.trim().length <= 3 ? name.trim() : name.trim().charAt(0)
//           const newUnit = await Unit.create({
//             name: name.trim(),
//             symbol,
//             type: "piece",
//             createdBy: req.user?._id,
//           })
//           unitMap.set(name.trim().toLowerCase(), newUnit._id)
//         }
//       }

//       console.log("Missing records created")

//       // Check for existing products
//       const names = csvData.map((r) => r.name).filter(Boolean)
//       const slugs = csvData.map((r) => r.slug).filter(Boolean)
//       const existingProducts = await Product.find({
//         $or: [{ name: { $in: names } }, { slug: { $in: slugs } }],
//       })
//       const existingNames = new Set(existingProducts.map((p) => p.name))
//       const existingSlugs = new Set(existingProducts.map((p) => p.slug))

//       // Validate and map rows to product schema
//       const previewProducts = []
//       const invalidRows = []
//       const allowedStockStatus = ["Available Product", "Out of Stock", "PreOrder"]

//       for (const [i, row] of csvData.entries()) {
//         // Skip row if all fields are empty/falsy
//         if (Object.values(row).every((v) => !v)) {
//           invalidRows.push({ row: i + 2, reason: "Empty row", data: row })
//           continue
//         }

//         // Validate required fields
//         if (!row.name || !row.parent_category) {
//           invalidRows.push({ row: i + 2, reason: "Missing required fields (name, parent_category)", data: row })
//           continue
//         }

//         // Check for duplicates
//         if ((row.name && existingNames.has(row.name)) || (row.slug && existingSlugs.has(row.slug))) {
//           invalidRows.push({ row: i + 2, reason: "Duplicate product name or slug", data: row })
//           continue
//         }

//         // Get IDs from maps
//         const parentCategoryId = parentCategoryMap.get(String(row.parent_category).trim().toLowerCase())
//         const subCategoryId = row.category ? subCategoryMap.get(String(row.category).trim().toLowerCase()) : undefined
//         const brandId = row.brand ? brandMap.get(String(row.brand).trim().toLowerCase()) : undefined
//         const taxId = row.tax ? taxMap.get(String(row.tax).trim().toLowerCase()) : undefined
//         const unitId = row.unit ? unitMap.get(String(row.unit).trim().toLowerCase()) : undefined

//         // Prepare product for preview
//         let stockStatus = row.stockStatus || "Available Product"
//         if (!allowedStockStatus.includes(stockStatus)) stockStatus = "Available Product"

//         const product = {
//           name: row.name || "",
//           slug: row.slug || generateSlug(row.name || ""),
//           sku: row.sku || "",
//           barcode: row.barcode || "",
//           parentCategory: parentCategoryId, // Main category
//           category: subCategoryId, // Subcategory
//           brand: brandId,
//           buyingPrice: Number.parseFloat(row.buyingPrice) || 0,
//           price: Number.parseFloat(row.price) || 0,
//           offerPrice: Number.parseFloat(row.offerPrice) || 0,
//           discount: Number.parseFloat(row.discount) || 0,
//           tax: taxId,
//           stockStatus,
//           showStockOut: row.showStockOut === "true" || row.showStockOut === true,
//           canPurchase: row.canPurchase === "true" || row.canPurchase === true,
//           refundable: row.refundable === "true" || row.refundable === true,
//           maxPurchaseQty: Number.parseInt(row.maxPurchaseQty) || 10,
//           lowStockWarning: Number.parseInt(row.lowStockWarning) || 5,
//           unit: unitId,
//           weight: Number.parseFloat(row.weight) || 0,
//           tags: row.tags
//             ? String(row.tags)
//                 .split(",")
//                 .map((t) => t.trim())
//             : [],
//           description: row.description || "",
//           shortDescription: row.shortDescription || "",
//           specifications: row.specifications ? [{ key: "Specifications", value: row.specifications }] : [],
//           details: row.details || "",
//           countInStock: Number.parseInt(row.countInStock) || 0,
//           isActive: true,
//           featured: false,
//         }

//         previewProducts.push(product)
//       }

//       console.log("Preview products built")

//       // Populate category, subcategory, and brand for preview
//       const populatedPreviewProducts = await Promise.all(
//         previewProducts.map(async (prod) => {
//           const populated = { ...prod }

//           if (prod.parentCategory) {
//             const cat = await Category.findById(prod.parentCategory).select("name slug")
//             if (cat) populated.parentCategory = { _id: cat._id, name: cat.name, slug: cat.slug }
//           }

//           if (prod.category) {
//             const sub = await SubCategory.findById(prod.category).select("name slug")
//             if (sub) populated.category = { _id: sub._id, name: sub.name, slug: sub.slug }
//           }

//           if (prod.brand) {
//             const brand = await Brand.findById(prod.brand).select("name slug")
//             if (brand) populated.brand = { _id: brand._id, name: brand.name, slug: brand.slug }
//           }

//           return populated
//         }),
//       )

//       res.json({
//         previewProducts: populatedPreviewProducts,
//         invalidRows,
//         total: csvData.length,
//         valid: previewProducts.length,
//         invalid: invalidRows.length,
//       })
//     } catch (error) {
//       console.error("CSV bulk preview error:", error)
//       res.status(500).json({ message: "CSV bulk preview failed", error: error.message })
//     }
//   }),
// )

// // @desc    Bulk save products to database
// // @route   POST /api/products/bulk-save
// // @access  Private/Admin
// router.post(
//   "/bulk-save",
//   protect,
//   admin,
//   asyncHandler(async (req, res) => {
//     const products = req.body.products
//     if (!Array.isArray(products) || products.length === 0) {
//       return res.status(400).json({ message: "No products to save" })
//     }

//     const results = []
//     let success = 0
//     let failed = 0
//     const allowedStockStatus = ["Available Product", "Out of Stock", "PreOrder"]

//     for (const [i, prod] of products.entries()) {
//       try {
//         // Skip row if all fields are empty/falsy
//         if (Object.values(prod).every((v) => !v)) {
//           results.push({ index: i, status: "failed", reason: "Empty row", product: prod })
//           failed++
//           continue
//         }

//         // Check for duplicate by name or slug
//         const existing = await Product.findOne({
//           $or: [{ name: prod.name }, { slug: prod.slug }],
//         })

//         if (existing) {
//           results.push({ index: i, status: "failed", reason: "Duplicate product name or slug", product: prod })
//           failed++
//           continue
//         }

//         // Validate required fields
//         if (!prod.name || !prod.parentCategory) {
//           results.push({ index: i, status: "failed", reason: "Missing required fields", product: prod })
//           failed++
//           continue
//         }

//         // Use defaults for missing fields
//         let stockStatus = prod.stockStatus || "Available Product"
//         if (!allowedStockStatus.includes(stockStatus)) stockStatus = "Available Product"

//         const product = new Product({
//           name: prod.name || "",
//           slug: prod.slug || generateSlug(prod.name || ""),
//           sku: prod.sku || "",
//           barcode: prod.barcode || "",
//           parentCategory: prod.parentCategory, // Main category
//           category: prod.category, // Subcategory
//           subCategory: prod.category, // For backward compatibility
//           brand: prod.brand,
//           buyingPrice: prod.buyingPrice || 0,
//           price: prod.price || 0,
//           offerPrice: prod.offerPrice || 0,
//           discount: prod.discount || 0,
//           tax: prod.tax,
//           stockStatus,
//           showStockOut: prod.showStockOut !== undefined ? Boolean(prod.showStockOut) : true,
//           canPurchase: prod.canPurchase !== undefined ? Boolean(prod.canPurchase) : true,
//           refundable: prod.refundable !== undefined ? Boolean(prod.refundable) : true,
//           maxPurchaseQty: prod.maxPurchaseQty || 10,
//           lowStockWarning: prod.lowStockWarning || 5,
//           unit: prod.unit,
//           weight: prod.weight || 0,
//           tags: prod.tags || [],
//           description: prod.description || "",
//           shortDescription: prod.shortDescription || "",
//           specifications: prod.specifications || [],
//           countInStock: prod.countInStock || 0,
//           isActive: prod.isActive !== undefined ? Boolean(prod.isActive) : true,
//           featured: prod.featured !== undefined ? Boolean(prod.featured) : false,
//           createdBy: req.user._id,
//         })

//         await product.save()
//         results.push({ index: i, status: "success", product: product })
//         success++
//       } catch (error) {
//         results.push({ index: i, status: "failed", reason: error.message, product: prod })
//         failed++
//       }
//     }

//     // Populate category, subcategory, and brand in the results
//     const populatedResults = await Promise.all(
//       results.map(async (result) => {
//         if (!result.product || result.status === "failed") return result

//         const prod = { ...result.product.toObject() }

//         if (prod.parentCategory) {
//           const cat = await Category.findById(prod.parentCategory).select("name slug")
//           if (cat) prod.parentCategory = { _id: cat._id, name: cat.name, slug: cat.slug }
//         }

//         if (prod.category) {
//           const sub = await SubCategory.findById(prod.category).select("name slug")
//           if (sub) prod.category = { _id: sub._id, name: sub.name, slug: sub.slug }
//         }

//         if (prod.brand) {
//           const brand = await Brand.findById(prod.brand).select("name slug")
//           if (brand) prod.brand = { _id: brand._id, name: brand.name, slug: brand.slug }
//         }

//         return { ...result, product: prod }
//       }),
//     )

//     res.json({
//       message: `Bulk save complete`,
//       total: products.length,
//       success,
//       failed,
//       results: populatedResults,
//     })
//   }),
// )

// // @desc    Bulk create products
// // @route   POST /api/products/bulk
// // @access  Private/Admin
// router.post(
//   "/bulk",
//   protect,
//   admin,
//   asyncHandler(async (req, res) => {
//     const { products } = req.body

//     if (!products || !Array.isArray(products) || products.length === 0) {
//       res.status(400)
//       throw new Error("No products provided")
//     }

//     const results = []
//     let successCount = 0
//     let failedCount = 0

//     for (let i = 0; i < products.length; i++) {
//       const productData = products[i]

//       try {
//         // Find or create parent category
//         let parentCategory = null
//         if (productData.parentCategory) {
//           const parentCategoryStr = String(productData.parentCategory).trim()
          
//           if (mongoose.Types.ObjectId.isValid(parentCategoryStr)) {
//             parentCategory = await Category.findById(parentCategoryStr)
//           } else {
//             parentCategory = await Category.findOne({ 
//               name: parentCategoryStr,
//               isDeleted: { $ne: true }
//             })
            
//             if (!parentCategory) {
//               const slug = parentCategoryStr.toLowerCase()
//                 .replace(/[^a-z0-9\s-]/g, '')
//                 .replace(/\s+/g, '-')
//                 .replace(/-+/g, '-')
//                 .trim()
              
//               parentCategory = new Category({
//                 name: parentCategoryStr,
//                 slug: slug,
//                 isActive: true,
//                 createdBy: req.user._id
//               })
//               await parentCategory.save()
//             }
//           }
//         }

//         // Find or create subcategory
//         let subCategory = null
//         if (productData.category) {
//           const categoryStr = String(productData.category).trim()
          
//           if (mongoose.Types.ObjectId.isValid(categoryStr)) {
//             subCategory = await SubCategory.findById(categoryStr)
//           } else if (parentCategory) {
//             subCategory = await SubCategory.findOne({ 
//               name: categoryStr,
//               category: parentCategory._id,
//               isDeleted: { $ne: true }
//             })
            
//             if (!subCategory) {
//               const slug = categoryStr.toLowerCase()
//                 .replace(/[^a-z0-9\s-]/g, '')
//                 .replace(/\s+/g, '-')
//                 .replace(/-+/g, '-')
//                 .trim()
              
//               subCategory = new SubCategory({
//                 name: categoryStr,
//                 slug: slug,
//                 category: parentCategory._id,
//                 isActive: true,
//                 createdBy: req.user._id
//               })
//               await subCategory.save()
//             }
//           }
//         }

//         // Find or create brand
//         let brand = null
//         if (productData.brand) {
//           const brandStr = String(productData.brand).trim()
          
//           if (mongoose.Types.ObjectId.isValid(brandStr)) {
//             brand = await Brand.findById(brandStr)
//           } else {
//             brand = await Brand.findOne({ 
//               name: brandStr,
//               isDeleted: { $ne: true }
//             })
            
//             if (!brand) {
//               const slug = brandStr.toLowerCase()
//                 .replace(/[^a-z0-9\s-]/g, '')
//                 .replace(/\s+/g, '-')
//                 .replace(/-+/g, '-')
//                 .trim()
              
//               brand = new Brand({
//                 name: brandStr,
//                 slug: slug,
//                 isActive: true,
//                 createdBy: req.user._id
//               })
//               await brand.save()
//             }
//           }
//         }

//         // Handle tax - Find or create tax record
//         let tax = null
//         if (productData.tax) {
//           const taxStr = String(productData.tax).trim()
          
//           if (mongoose.Types.ObjectId.isValid(taxStr)) {
//             tax = await Tax.findById(taxStr)
//           } else {
//             // Try to find existing tax by name
//             tax = await Tax.findOne({ 
//               name: taxStr,
//               isDeleted: { $ne: true }
//             })
            
//             if (!tax) {
//               // Create new tax record
//               tax = new Tax({
//                 name: taxStr,
//                 percentage: taxStr.includes('5') ? 5 : 0, // Extract percentage if possible
//                 isActive: true,
//                 createdBy: req.user._id
//               })
//               await tax.save()
//             }
//           }
//         }

//         // Handle unit - Find or create unit record
//         let unit = null
//         if (productData.unit) {
//           const unitStr = String(productData.unit).trim()
          
//           if (mongoose.Types.ObjectId.isValid(unitStr)) {
//             unit = await Unit.findById(unitStr)
//           } else {
//             unit = await Unit.findOne({ 
//               name: unitStr,
//               isDeleted: { $ne: true }
//             })
            
//             if (!unit) {
//               unit = new Unit({
//                 name: unitStr,
//                 isActive: true,
//                 createdBy: req.user._id
//               })
//               await unit.save()
//             }
//           }
//         }

//         // Generate unique slug
//         const productName = String(productData.name || '').trim()
//         let baseSlug = productData.slug || productName.toLowerCase()
//           .replace(/[^a-z0-9\s-]/g, '')
//           .replace(/\s+/g, '-')
//           .replace(/-+/g, '-')
//           .trim()

//         // Ensure slug is unique
//         let productSlug = baseSlug
//         let counter = 1
//         while (await Product.findOne({ slug: productSlug })) {
//           productSlug = `${baseSlug}-${counter}`
//           counter++
//         }

//         // Check if product with same SKU already exists
//         const existingProduct = await Product.findOne({ sku: productData.sku })
//         if (existingProduct) {
//           results.push({
//             status: "error",
//             product: productData,
//             message: `Product with SKU '${productData.sku}' already exists`,
//             originalIndex: i
//           })
//           failedCount++
//           continue
//         }

//         // Create the product with proper ObjectId references
//         const product = new Product({
//           name: productName,
//           slug: productSlug,
//           sku: String(productData.sku || '').trim(),
//           parentCategory: parentCategory?._id,
//           category: subCategory?._id,
//           brand: brand?._id,
//           tax: tax?._id, // Use ObjectId reference
//           unit: unit?._id, // Use ObjectId reference
//           buyingPrice: Number(productData.buyingPrice) || 0,
//           price: Number(productData.price) || 0,
//           offerPrice: Number(productData.offerPrice) || 0,
//           stockStatus: String(productData.stockStatus || "Available Product").trim(),
//           showStockOut: productData.showStockOut !== undefined ? Boolean(productData.showStockOut) : true,
//           canPurchase: productData.canPurchase !== undefined ? Boolean(productData.canPurchase) : true,
//           refundable: productData.refundable !== undefined ? Boolean(productData.refundable) : true,
//           maxPurchaseQty: Number(productData.maxPurchaseQty) || 10,
//           lowStockWarning: Number(productData.lowStockWarning) || 5,
//           weight: Number(productData.weight) || 0,
//           tags: productData.tags ? String(productData.tags).split(',').map(tag => tag.trim()).filter(tag => tag) : [],
//           description: String(productData.description || '').trim(),
//           discount: Number(productData.discount) || 0,
//           specifications: productData.specifications ? [{
//             key: "Specifications",
//             value: String(productData.specifications).trim()
//           }] : [],
//           details: String(productData.details || '').trim(),
//           shortDescription: String(productData.shortDescription || '').trim(),
//           barcode: String(productData.barcode || '').trim(),
//           isActive: true,
//           countInStock: Number(productData.countInStock) || 0,
//           createdBy: req.user._id
//         })

//         await product.save()

//         results.push({
//           status: "success",
//           product: {
//             _id: product._id,
//             name: product.name,
//             sku: product.sku
//           },
//           originalIndex: i
//         })
//         successCount++

//       } catch (error) {
//         console.error(`Error creating product ${i + 1}:`, error)
//         results.push({
//           status: "error",
//           product: productData,
//           message: error.message || "Failed to create product",
//           details: error.stack,
//           originalIndex: i
//         })
//         failedCount++
//       }
//     }

//     res.json({
//       success: true,
//       message: `Bulk import completed. ${successCount} products created, ${failedCount} failed.`,
//       successCount,
//       failedCount,
//       results,
//       summary: {
//         total: products.length,
//         success: successCount,
//         failed: failedCount
//       }
//     })
//   })
// )

// // Update your GET products route to support excludeId parameter
// router.get('/', async (req, res) => {
//   try {
//     const {
//       page = 1,
//       limit = 12,
//       category,
//       search,
//       brand,
//       minPrice,
//       maxPrice,
//       sortBy = 'createdAt',
//       sortOrder = 'desc',
//       excludeId // Add this parameter
//     } = req.query

//     let query = {}

//     // Exclude specific product ID
//     if (excludeId) {
//       query._id = { $ne: excludeId }
//     }

//     // Category filter
//     if (category) {
//       if (mongoose.Types.ObjectId.isValid(category)) {
//         query.category = category
//       } else {
//         const categoryDoc = await Category.findOne({ name: new RegExp(category, 'i') })
//         if (categoryDoc) {
//           query.category = categoryDoc._id
//         }
//       }
//     }

//     // Search filter
//     if (search) {
//       query.$or = [
//         { name: { $regex: search, $options: 'i' } },
//         { description: { $regex: search, $options: 'i' } },
//         { shortDescription: { $regex: search, $options: 'i' } },
//         { tags: { $in: [new RegExp(search, 'i')] } }
//       ]
//     }

//     // Brand filter
//     if (brand) {
//       if (mongoose.Types.ObjectId.isValid(brand)) {
//         query.brand = brand
//       } else {
//         const brandDoc = await Brand.findOne({ name: new RegExp(brand, 'i') })
//         if (brandDoc) {
//           query.brand = brandDoc._id
//         }
//       }
//     }

//     // Price range filter
//     if (minPrice || maxPrice) {
//       query.price = {}
//       if (minPrice) query.price.$gte = Number(minPrice)
//       if (maxPrice) query.price.$lte = Number(maxPrice)
//     }

//     const sortOptions = {}
//     sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1

//     const products = await Product.find(query)
//       .populate('category', 'name')
//       .populate('brand', 'name')
//       .sort(sortOptions)
//       .limit(limit * 1)
//       .skip((page - 1) * limit)
//       .exec()

//     const total = await Product.countDocuments(query)

//     res.json({
//       products,
//       totalPages: Math.ceil(total / limit),
//       currentPage: page,
//       total
//     })
//   } catch (error) {
//     console.error('Error fetching products:', error)
//     res.status(500).json({ message: 'Server error' })
//   }
// })

// export default router



























































































































































































































































































































































































































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

// Helper: map Excel columns to backend keys
const excelToBackendKey = {
  name: "name",
  slug: "slug",
  SKU: "sku",
  sku: "sku",
  category: "category",
  parent_category: "parent_category",
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
  subCategory: "subCategory",
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

function generateSlug(name) {
  return name.trim().toLowerCase().replace(/\s+/g, "-")
}

// Helper to escape regex special characters
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// @desc    Fetch all products (Admin only - includes inactive)
// @route   GET /api/products/admin
// @access  Private/Admin
router.get("/admin", protect, admin, async (req, res) => {
  try {
    const { search, category, subcategory, parentCategory, limit = 20, page = 1 } = req.query
    const query = {}
    const orConditions = []

    if (category) query.category = category
    if (subcategory) query.subCategory = subcategory
    if (parentCategory) query.parentCategory = parentCategory

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
      andConditions.push({ $or: [{ category: subcategory }, { subCategory: subcategory }] })
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

    // Optimize query by selecting only necessary fields and using lean()
    let productsQuery = Product.find(query)
      .select(
        "name slug sku price offerPrice discount image countInStock stockStatus brand category parentCategory featured tags createdAt rating numReviews",
      )
      .populate("brand", "name slug")
      .populate("category", "name slug")
      .populate("parentCategory", "name slug")
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
      andConditions.push({ $or: [{ category: subcategory }, { subCategory: subcategory }] })
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
    const { parentCategory, category, ...productData } = req.body

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

    // Check if slug is unique
    if (productData.slug) {
      const existingProduct = await Product.findOne({ slug: productData.slug })
      if (existingProduct) {
        res.status(400)
        throw new Error("Product slug already exists")
      }
    }

    const product = new Product({
      ...productData,
      parentCategory,
      category,
      subCategory: category || undefined, // for backward compatibility
      createdBy: req.user._id,
    })

    const createdProduct = await product.save()
    const populatedProduct = await Product.findById(createdProduct._id)
      .populate("parentCategory", "name slug")
      .populate("category", "name slug")
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
      const { parentCategory, category, slug, ...updateData } = req.body

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

      // Check if slug is unique (excluding current product)
      if (slug && slug !== product.slug) {
        const existingProduct = await Product.findOne({ slug, _id: { $ne: req.params.id } })
        if (existingProduct) {
          res.status(400)
          throw new Error("Product slug already exists")
        }
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
      if (slug) product.slug = slug

      const updatedProduct = await product.save()
      const populatedProduct = await Product.findById(updatedProduct._id)
        .populate("parentCategory", "name slug")
        .populate("category", "name slug")
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
      category: req.params.categoryId,
      isActive: true,
    })
      .populate("category", "name slug")
      .populate("brand", "name")
      .sort({ createdAt: -1 })

    res.json(products)
  }),
)

// @desc    Bulk preview products from Excel
// @route   POST /api/products/bulk-preview
// @access  Private/Admin
router.post(
  "/bulk-preview",
  protect,
  admin,
  excelUpload.single("file"),
  asyncHandler(async (req, res) => {
    console.log("--- BULK PREVIEW START ---")
    if (!req.file) {
      console.log("No file uploaded")
      return res.status(400).json({ message: "No file uploaded" })
    }
    try {
      // Read Excel file
      const workbook = XLSX.readFile(req.file.path)
      const sheetName = workbook.SheetNames[0]
      const sheet = workbook.Sheets[sheetName]
      const rows = XLSX.utils.sheet_to_json(sheet)
      console.log("Excel rows loaded:", rows.length)

      // Remove uploaded file after parsing
      fs.unlinkSync(req.file.path)
      console.log("File unlinked")

      // Only declare mappedRows ONCE after reading rows:
      const mappedRows = rows.map(remapRow)
      console.log("Rows mapped")

      // Collect all unique category, brand, subCategory, tax, unit, color, warranty, size, volume names
      const uniqueCategoryNames = new Set()
      const uniqueBrandNames = new Set()
      const uniqueSubCategoryNames = new Set()
      const uniqueTaxNames = new Set()
      const uniqueUnitNames = new Set()
      const uniqueColorNames = new Set()
      const uniqueWarrantyNames = new Set()
      const uniqueSizeNames = new Set()
      const uniqueVolumeNames = new Set()
      mappedRows.forEach((row) => {
        if (row.category) uniqueCategoryNames.add(String(row.category).trim())
        if (row.brand) uniqueBrandNames.add(String(row.brand).trim())
        if (row.subCategory) uniqueSubCategoryNames.add(String(row.subCategory).trim())
        if (row.tax) uniqueTaxNames.add(String(row.tax).trim())
        if (row.unit) uniqueUnitNames.add(String(row.unit).trim())
        if (row.color) uniqueColorNames.add(String(row.color).trim())
        if (row.warranty) uniqueWarrantyNames.add(String(row.warranty).trim())
        if (row.size) uniqueSizeNames.add(String(row.size).trim())
        if (row.volume) uniqueVolumeNames.add(String(row.volume).trim())
      })
      console.log("Unique names collected")

      // Query DB for existing categories/brands/subCategories
      const allCategories = await Category.find({ name: { $in: Array.from(uniqueCategoryNames) } })
      const allBrands = await Brand.find({ name: { $in: Array.from(uniqueBrandNames) } })
      const allSubCategories = await SubCategory.find({ name: { $in: Array.from(uniqueSubCategoryNames) } })
      const allTaxes = await Tax.find({ name: { $in: Array.from(uniqueTaxNames) } })
      const allUnits = await Unit.find({ name: { $in: Array.from(uniqueUnitNames) } })
      const allColors = await Color.find({ name: { $in: Array.from(uniqueColorNames) } })
      const allWarranties = await Warranty.find({ name: { $in: Array.from(uniqueWarrantyNames) } })
      const allSizes = await Size.find({ name: { $in: Array.from(uniqueSizeNames) } })
      const allVolumes = await Volume.find({ name: { $in: Array.from(uniqueVolumeNames) } })
      const categoryMap = new Map()
      allCategories.forEach((cat) => categoryMap.set(cat.name.trim().toLowerCase(), cat._id))
      const brandMap = new Map()
      allBrands.forEach((brand) => brandMap.set(brand.name.trim().toLowerCase(), brand._id))
      const subCategoryMap = new Map()
      allSubCategories.forEach((sub) => subCategoryMap.set(sub.name.trim().toLowerCase(), sub._id))
      const taxMap = new Map()
      allTaxes.forEach((tax) => taxMap.set(tax.name.trim().toLowerCase(), tax._id))
      const unitMap = new Map()
      allUnits.forEach((unit) => unitMap.set(unit.name.trim().toLowerCase(), unit._id))
      const colorMap = new Map()
      allColors.forEach((color) => colorMap.set(color.name.trim().toLowerCase(), color._id))
      const warrantyMap = new Map()
      allWarranties.forEach((w) => warrantyMap.set(w.name.trim().toLowerCase(), w._id))
      const sizeMap = new Map()
      allSizes.forEach((s) => sizeMap.set(s.name.trim().toLowerCase(), s._id))
      const volumeMap = new Map()
      allVolumes.forEach((v) => volumeMap.set(v.name.trim().toLowerCase(), v._id))
      for (const name of uniqueCategoryNames) {
        const slug = generateSlug(name)
        const existingCategoryBySlug = await Category.findOne({ slug })
        if (!categoryMap.has(name.trim().toLowerCase()) && !existingCategoryBySlug) {
          const newCat = await Category.create({ name: name.trim(), slug, createdBy: req.user?._id })
          categoryMap.set(name.trim().toLowerCase(), newCat._id)
        } else if (existingCategoryBySlug) {
          categoryMap.set(name.trim().toLowerCase(), existingCategoryBySlug._id)
        }
      }
      for (const name of uniqueBrandNames) {
        const brandSlug = generateSlug(name)
        const existingBrandBySlug = await Brand.findOne({ slug: brandSlug })
        if (!brandMap.has(name.trim().toLowerCase()) && !existingBrandBySlug) {
          const newBrand = await Brand.create({ name: name.trim(), slug: brandSlug, createdBy: req.user?._id })
          brandMap.set(name.trim().toLowerCase(), newBrand._id)
        } else if (existingBrandBySlug) {
          brandMap.set(name.trim().toLowerCase(), existingBrandBySlug._id)
        }
      }
      for (const name of uniqueSubCategoryNames) {
        const subSlug = generateSlug(name)
        const existingSubCategoryBySlug = await SubCategory.findOne({ slug: subSlug })
        if (!subCategoryMap.has(name.trim().toLowerCase()) && !existingSubCategoryBySlug) {
          let parentCategoryId = undefined
          const rowWithParent = mappedRows.find(
            (r) =>
              r.subCategory && String(r.subCategory).trim().toLowerCase() === name.trim().toLowerCase() && r.category,
          )
          if (rowWithParent && rowWithParent.category) {
            parentCategoryId = categoryMap.get(String(rowWithParent.category).trim().toLowerCase())
          }
          const newSub = await SubCategory.create({
            name: name.trim(),
            slug: subSlug,
            category: parentCategoryId,
            createdBy: req.user?._id,
          })
          subCategoryMap.set(name.trim().toLowerCase(), newSub._id)
        } else if (existingSubCategoryBySlug) {
          subCategoryMap.set(name.trim().toLowerCase(), existingSubCategoryBySlug._id)
        }
      }
      for (const name of uniqueTaxNames) {
        if (!taxMap.has(name.trim().toLowerCase())) {
          const newTax = await Tax.create({ name: name.trim(), createdBy: req.user?._id })
          taxMap.set(name.trim().toLowerCase(), newTax._id)
        }
      }
      for (const name of uniqueUnitNames) {
        if (!unitMap.has(name.trim().toLowerCase())) {
          const symbol = name.trim().length <= 3 ? name.trim() : name.trim().charAt(0)
          const newUnit = await Unit.create({ name: name.trim(), symbol, type: "piece", createdBy: req.user?._id })
          unitMap.set(name.trim().toLowerCase(), newUnit._id)
        }
      }
      for (const name of uniqueColorNames) {
        if (!colorMap.has(name.trim().toLowerCase())) {
          const newColor = await Color.create({ name: name.trim(), createdBy: req.user?._id })
          colorMap.set(name.trim().toLowerCase(), newColor._id)
        }
      }
      for (const name of uniqueWarrantyNames) {
        if (!warrantyMap.has(name.trim().toLowerCase())) {
          const newWarranty = await Warranty.create({ name: name.trim(), createdBy: req.user?._id })
          warrantyMap.set(name.trim().toLowerCase(), newWarranty._id)
        }
      }
      for (const name of uniqueSizeNames) {
        if (!sizeMap.has(name.trim().toLowerCase())) {
          const newSize = await Size.create({ name: name.trim(), createdBy: req.user?._id })
          sizeMap.set(name.trim().toLowerCase(), newSize._id)
        }
      }
      for (const name of uniqueVolumeNames) {
        if (!volumeMap.has(name.trim().toLowerCase())) {
          const newVolume = await Volume.create({ name: name.trim(), createdBy: req.user?._id })
          volumeMap.set(name.trim().toLowerCase(), newVolume._id)
        }
      }
      console.log("Existing related records fetched")

      // Collect all names and slugs from Excel
      const names = rows.map((r) => r.name).filter(Boolean)
      const slugs = rows.map((r) => r.slug).filter(Boolean)
      const existingProducts = await Product.find({ $or: [{ name: { $in: names } }, { slug: { $in: slugs } }] })
      const existingNames = new Set(existingProducts.map((p) => p.name))
      const existingSlugs = new Set(existingProducts.map((p) => p.slug))

      // Validate and map rows to product schema
      const previewProducts = []
      const invalidRows = []
      const allowedStockStatus = ["Available Product", "Out of Stock", "PreOrder"]
      for (const [i, row] of mappedRows.entries()) {
        // Skip row if all fields are empty/falsy
        if (Object.values(row).every((v) => !v)) {
          invalidRows.push({ row: i + 2, reason: "Empty row", data: row })
          continue
        }
        // Use batch maps for category and brand
        let categoryId = undefined
        let brandId = undefined
        if (row.category) {
          categoryId = categoryMap.get(String(row.category).trim().toLowerCase())
        }
        if (row.brand) {
          brandId = brandMap.get(String(row.brand).trim().toLowerCase())
        }
        // Check for duplicate by name or slug
        if ((row.name && existingNames.has(row.name)) || (row.slug && existingSlugs.has(row.slug))) {
          invalidRows.push({ row: i + 2, reason: "Duplicate product name or slug", data: row })
          continue
        }
        // Prepare product for preview, using defaults for missing fields
        let stockStatus = row.stockStatus || "Available Product"
        if (!allowedStockStatus.includes(stockStatus)) stockStatus = "Available Product"
        previewProducts.push({
          name: row.name || "",
          price: row.price || 0,
          offerPrice: row.offerPrice || 0,
          discount: row.discount || 0,
          oldPrice: row.oldPrice || 0,
          image: row.image || "",
          galleryImages: row.galleryImages ? String(row.galleryImages).split(",") : [],
          countInStock: row.countInStock || 0,
          description: row.description || "",
          shortDescription: row.shortDescription || "",
          category: categoryId,
          brand: brandId,
          sku: row.sku || "",
          slug: row.slug || "",
          barcode: row.barcode || "",
          stockStatus,
          buyingPrice: row.buyingPrice || 0,
          lowStockWarning: row.lowStockWarning || 5,
          maxPurchaseQty: row.maxPurchaseQty || 10,
          weight: row.weight || 0,
          unit: row.unit ? unitMap.get(String(row.unit).trim().toLowerCase()) : undefined,
          color: row.color ? colorMap.get(String(row.color).trim().toLowerCase()) : undefined,
          tax: row.tax ? taxMap.get(String(row.tax).trim().toLowerCase()) : undefined,
          tags: row.tags ? String(row.tags).split(",") : [],
          isActive: row.isActive !== undefined ? Boolean(row.isActive) : true,
          canPurchase: row.canPurchase !== undefined ? Boolean(row.canPurchase) : true,
          showStockOut: row.showStockOut !== undefined ? Boolean(row.showStockOut) : true,
          refundable: row.refundable !== undefined ? Boolean(row.refundable) : true,
          featured: row.featured !== undefined ? Boolean(row.featured) : false,
          subCategory: row.subCategory ? subCategoryMap.get(String(row.subCategory).trim().toLowerCase()) : undefined,
          warranty: row.warranty ? warrantyMap.get(String(row.warranty).trim().toLowerCase()) : undefined,
          size: row.size ? sizeMap.get(String(row.size).trim().toLowerCase()) : undefined,
          volume: row.volume ? volumeMap.get(String(row.volume).trim().toLowerCase()) : undefined,
        })
      }
      console.log("Preview products built")

      // Populate category, subCategory, and brand for previewProducts
      const populatedPreviewProducts = await Promise.all(
        previewProducts.map(async (prod) => {
          const populated = { ...prod }
          if (prod.category) {
            const cat = await Category.findById(prod.category).select("name slug")
            if (cat) populated.category = { _id: cat._id, name: cat.name, slug: cat.slug }
          }
          if (prod.subCategory) {
            const sub = await SubCategory.findById(prod.subCategory).select("name slug")
            if (sub) populated.subCategory = { _id: sub._id, name: sub.name, slug: sub.slug }
          }
          if (prod.brand) {
            const brand = await Brand.findById(prod.brand).select("name slug")
            if (brand) populated.brand = { _id: brand._id, name: brand.name, slug: brand.slug }
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
      if (req.file && req.file.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path)
      }
      res.status(500).json({ message: "Bulk preview failed", error: error.message })
    }
  }),
)

// @desc    Bulk preview products from CSV
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

    try {
      console.log("CSV data received:", csvData.length, "rows")

      // Collect all unique parent_category, category (subcategory), brand names
      const uniqueParentCategoryNames = new Set()
      const uniqueCategoryNames = new Set() // These will be subcategories
      const uniqueBrandNames = new Set()
      const uniqueTaxNames = new Set()
      const uniqueUnitNames = new Set()

      csvData.forEach((row) => {
        if (row.parent_category) uniqueParentCategoryNames.add(String(row.parent_category).trim())
        if (row.category) uniqueCategoryNames.add(String(row.category).trim())
        if (row.brand) uniqueBrandNames.add(String(row.brand).trim())
        if (row.tax) uniqueTaxNames.add(String(row.tax).trim())
        if (row.unit) uniqueUnitNames.add(String(row.unit).trim())
      })

      console.log("Unique names collected")

      // Query DB for existing records
      const allParentCategories = await Category.find({ name: { $in: Array.from(uniqueParentCategoryNames) } })
      const allSubCategories = await SubCategory.find({ name: { $in: Array.from(uniqueCategoryNames) } })
      const allBrands = await Brand.find({ name: { $in: Array.from(uniqueBrandNames) } })
      const allTaxes = await Tax.find({ name: { $in: Array.from(uniqueTaxNames) } })
      const allUnits = await Unit.find({ name: { $in: Array.from(uniqueUnitNames) } })

      // Create maps for quick lookup
      const parentCategoryMap = new Map()
      allParentCategories.forEach((cat) => parentCategoryMap.set(cat.name.trim().toLowerCase(), cat._id))

      const subCategoryMap = new Map()
      allSubCategories.forEach((sub) => subCategoryMap.set(sub.name.trim().toLowerCase(), sub._id))

      const brandMap = new Map()
      allBrands.forEach((brand) => brandMap.set(brand.name.trim().toLowerCase(), brand._id))

      const taxMap = new Map()
      allTaxes.forEach((tax) => taxMap.set(tax.name.trim().toLowerCase(), tax._id))

      const unitMap = new Map()
      allUnits.forEach((unit) => unitMap.set(unit.name.trim().toLowerCase(), unit._id))

      // Create missing parent categories (main categories)
      for (const name of uniqueParentCategoryNames) {
        const slug = generateSlug(name)
        const existingCategoryBySlug = await Category.findOne({ slug })
        if (!parentCategoryMap.has(name.trim().toLowerCase()) && !existingCategoryBySlug) {
          const newCat = await Category.create({ name: name.trim(), slug, createdBy: req.user?._id })
          parentCategoryMap.set(name.trim().toLowerCase(), newCat._id)
        } else if (existingCategoryBySlug) {
          parentCategoryMap.set(name.trim().toLowerCase(), existingCategoryBySlug._id)
        }
      }
      // Create missing subcategories
      for (const name of uniqueCategoryNames) {
        const subSlug = generateSlug(name)
        const existingSubCategoryBySlug = await SubCategory.findOne({ slug: subSlug })
        if (!subCategoryMap.has(name.trim().toLowerCase()) && !existingSubCategoryBySlug) {
          // Find the parent category for this subcategory from CSV data
          let parentCategoryId = undefined
          const rowWithParent = csvData.find(
            (r) =>
              r.category && String(r.category).trim().toLowerCase() === name.trim().toLowerCase() && r.parent_category,
          )
          if (rowWithParent && rowWithParent.parent_category) {
            parentCategoryId = parentCategoryMap.get(String(rowWithParent.parent_category).trim().toLowerCase())
          }
          const newSub = await SubCategory.create({
            name: name.trim(),
            slug: subSlug,
            category: parentCategoryId, // Link to parent category
            createdBy: req.user?._id,
          })
          subCategoryMap.set(name.trim().toLowerCase(), newSub._id)
        } else if (existingSubCategoryBySlug) {
          subCategoryMap.set(name.trim().toLowerCase(), existingSubCategoryBySlug._id)
        }
      }
      // Create missing brands
      for (const name of uniqueBrandNames) {
        const brandSlug = generateSlug(name)
        const existingBrandBySlug = await Brand.findOne({ slug: brandSlug })
        if (!brandMap.has(name.trim().toLowerCase()) && !existingBrandBySlug) {
          const newBrand = await Brand.create({ name: name.trim(), slug: brandSlug, createdBy: req.user?._id })
          brandMap.set(name.trim().toLowerCase(), newBrand._id)
        } else if (existingBrandBySlug) {
          brandMap.set(name.trim().toLowerCase(), existingBrandBySlug._id)
        }
      }

      // Create missing taxes
      for (const name of uniqueTaxNames) {
        if (!taxMap.has(name.trim().toLowerCase())) {
          const newTax = await Tax.create({
            name: name.trim(),
            rate: 5, // Default rate
            createdBy: req.user?._id,
          })
          taxMap.set(name.trim().toLowerCase(), newTax._id)
        }
      }

      // Create missing units
      for (const name of uniqueUnitNames) {
        if (!unitMap.has(name.trim().toLowerCase())) {
          const symbol = name.trim().length <= 3 ? name.trim() : name.trim().charAt(0)
          const newUnit = await Unit.create({
            name: name.trim(),
            symbol,
            type: "piece",
            createdBy: req.user?._id,
          })
          unitMap.set(name.trim().toLowerCase(), newUnit._id)
        }
      }

      console.log("Missing records created")

      // Check for existing products
      const names = csvData.map((r) => r.name).filter(Boolean)
      const slugs = csvData.map((r) => r.slug).filter(Boolean)
      const existingProducts = await Product.find({
        $or: [{ name: { $in: names } }, { slug: { $in: slugs } }],
      })
      const existingNames = new Set(existingProducts.map((p) => p.name))
      const existingSlugs = new Set(existingProducts.map((p) => p.slug))

      // Validate and map rows to product schema
      const previewProducts = []
      const invalidRows = []
      const allowedStockStatus = ["Available Product", "Out of Stock", "PreOrder"]

      for (const [i, row] of csvData.entries()) {
        // Skip row if all fields are empty/falsy
        if (Object.values(row).every((v) => !v)) {
          invalidRows.push({ row: i + 2, reason: "Empty row", data: row })
          continue
        }

        // Validate required fields
        if (!row.name || !row.parent_category) {
          invalidRows.push({ row: i + 2, reason: "Missing required fields (name, parent_category)", data: row })
          continue
        }

        // Check for duplicates
        if ((row.name && existingNames.has(row.name)) || (row.slug && existingSlugs.has(row.slug))) {
          invalidRows.push({ row: i + 2, reason: "Duplicate product name or slug", data: row })
          continue
        }

        // Get IDs from maps
        const parentCategoryId = parentCategoryMap.get(String(row.parent_category).trim().toLowerCase())
        const subCategoryId = row.category ? subCategoryMap.get(String(row.category).trim().toLowerCase()) : undefined
        const brandId = row.brand ? brandMap.get(String(row.brand).trim().toLowerCase()) : undefined
        const taxId = row.tax ? taxMap.get(String(row.tax).trim().toLowerCase()) : undefined
        const unitId = row.unit ? unitMap.get(String(row.unit).trim().toLowerCase()) : undefined

        // Prepare product for preview
        let stockStatus = row.stockStatus || "Available Product"
        if (!allowedStockStatus.includes(stockStatus)) stockStatus = "Available Product"

        const product = {
          name: row.name || "",
          slug: row.slug || generateSlug(row.name || ""),
          sku: row.sku || "",
          barcode: row.barcode || "",
          parentCategory: parentCategoryId, // Main category
          category: subCategoryId, // Subcategory
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
        }

        previewProducts.push(product)
      }

      console.log("Preview products built")

      // Populate category, subcategory, and brand for preview
      const populatedPreviewProducts = await Promise.all(
        previewProducts.map(async (prod) => {
          const populated = { ...prod }

          if (prod.parentCategory) {
            const cat = await Category.findById(prod.parentCategory).select("name slug")
            if (cat) populated.parentCategory = { _id: cat._id, name: cat.name, slug: cat.slug }
          }

          if (prod.category) {
            const sub = await SubCategory.findById(prod.category).select("name slug")
            if (sub) populated.category = { _id: sub._id, name: sub.name, slug: sub.slug }
          }

          if (prod.brand) {
            const brand = await Brand.findById(prod.brand).select("name slug")
            if (brand) populated.brand = { _id: brand._id, name: brand.name, slug: brand.slug }
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
    } catch (error) {
      console.error("CSV bulk preview error:", error)
      res.status(500).json({ message: "CSV bulk preview failed", error: error.message })
    }
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
          results.push({ index: i, status: "failed", reason: "Empty row", product: prod })
          failed++
          continue
        }

        // Check for duplicate by name or slug
        const existing = await Product.findOne({
          $or: [{ name: prod.name }, { slug: prod.slug }],
        })

        if (existing) {
          results.push({ index: i, status: "failed", reason: "Duplicate product name or slug", product: prod })
          failed++
          continue
        }

        // Validate required fields
        if (!prod.name || !prod.parentCategory) {
          results.push({ index: i, status: "failed", reason: "Missing required fields", product: prod })
          failed++
          continue
        }

        // Use defaults for missing fields
        let stockStatus = prod.stockStatus || "Available Product"
        if (!allowedStockStatus.includes(stockStatus)) stockStatus = "Available Product"

        const product = new Product({
          name: prod.name || "",
          slug: prod.slug || generateSlug(prod.name || ""),
          sku: prod.sku || "",
          barcode: prod.barcode || "",
          parentCategory: prod.parentCategory, // Main category
          category: prod.category, // Subcategory
          subCategory: prod.category, // For backward compatibility
          brand: prod.brand,
          buyingPrice: prod.buyingPrice || 0,
          price: prod.price || 0,
          offerPrice: prod.offerPrice || 0,
          discount: prod.discount || 0,
          tax: prod.tax,
          stockStatus,
          showStockOut: prod.showStockOut !== undefined ? Boolean(prod.showStockOut) : true,
          canPurchase: prod.canPurchase !== undefined ? Boolean(prod.canPurchase) : true,
          refundable: prod.refundable !== undefined ? Boolean(prod.refundable) : true,
          maxPurchaseQty: prod.maxPurchaseQty || 10,
          lowStockWarning: prod.lowStockWarning || 5,
          unit: prod.unit,
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
        results.push({ index: i, status: "success", product: product })
        success++
      } catch (error) {
        results.push({ index: i, status: "failed", reason: error.message, product: prod })
        failed++
      }
    }

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
    })
  }),
)

// Update your GET products route to support excludeId parameter
router.get('/', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 12,
      category,
      search,
      brand,
      minPrice,
      maxPrice,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      excludeId // Add this parameter
    } = req.query

    let query = {}

    // Exclude specific product ID
    if (excludeId) {
      query._id = { $ne: excludeId }
    }

    // Category filter
    if (category) {
      if (mongoose.Types.ObjectId.isValid(category)) {
        query.category = category
      } else {
        const categoryDoc = await Category.findOne({ name: new RegExp(category, 'i') })
        if (categoryDoc) {
          query.category = categoryDoc._id
        }
      }
    }

    // Search filter
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { shortDescription: { $regex: search, $options: 'i' } },
        { tags: { $in: [new RegExp(search, 'i')] } }
      ]
    }

    // Brand filter
    if (brand) {
      if (mongoose.Types.ObjectId.isValid(brand)) {
        query.brand = brand
      } else {
        const brandDoc = await Brand.findOne({ name: new RegExp(brand, 'i') })
        if (brandDoc) {
          query.brand = brandDoc._id
        }
      }
    }

    // Price range filter
    if (minPrice || maxPrice) {
      query.price = {}
      if (minPrice) query.price.$gte = Number(minPrice)
      if (maxPrice) query.price.$lte = Number(maxPrice)
    }

    const sortOptions = {}
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1

    const products = await Product.find(query)
      .populate('category', 'name')
      .populate('brand', 'name')
      .sort(sortOptions)
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .exec()

    const total = await Product.countDocuments(query)

    res.json({
      products,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    })
  } catch (error) {
    console.error('Error fetching products:', error)
    res.status(500).json({ message: 'Server error' })
  }
})

export default router