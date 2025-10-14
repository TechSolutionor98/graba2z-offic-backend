// import express from "express"
// import asyncHandler from "express-async-handler"
// import SubCategory from "../models/subCategoryModel.js"
// import Category from "../models/categoryModel.js"
// import { protect, admin } from "../middleware/authMiddleware.js"

// const router = express.Router()

// // @desc    Get all active subcategories
// // @route   GET /api/subcategories
// // @access  Public
// router.get(
//   "/",
//   asyncHandler(async (req, res) => {
//     const { category } = req.query

//     const query = { isActive: true, isDeleted: false }
//     if (category) {
//       query.category = category
//     }

//     const subcategories = await SubCategory.find(query)
//       .populate("category", "name slug")
//       .sort({ sortOrder: 1, name: 1 })
//     res.json(subcategories)
//   }),
// )

// // @desc    Get all subcategories (admin)
// // @route   GET /api/subcategories/admin
// // @access  Private/Admin
// router.get(
//   "/admin",
//   protect,
//   admin,
//   asyncHandler(async (req, res) => {
//     const subcategories = await SubCategory.find({ isDeleted: false })
//       .populate("category", "name slug")
//       .sort({ createdAt: -1 })
//     res.json(subcategories)
//   }),
// )

// // @desc    Get subcategories by category
// // @route   GET /api/subcategories/category/:categoryId
// // @access  Public
// router.get(
//   "/category/:categoryId",
//   asyncHandler(async (req, res) => {
//     const subcategories = await SubCategory.find({
//       category: req.params.categoryId,
//       isActive: true,
//       isDeleted: false,
//     }).sort({ sortOrder: 1, name: 1 })
//     res.json(subcategories)
//   }),
// )

// // @desc    Get trash subcategories
// // @route   GET /api/subcategories/trash
// // @access  Private/Admin
// router.get(
//   "/trash",
//   protect,
//   admin,
//   asyncHandler(async (req, res) => {
//     const subcategories = await SubCategory.find({ isDeleted: true })
//       .populate("category", "name slug")
//       .sort({ deletedAt: -1 })
//     res.json(subcategories)
//   }),
// )

// // @desc    Create a subcategory
// // @route   POST /api/subcategories
// // @access  Private/Admin
// router.post(
//   "/",
//   protect,
//   admin,
//   asyncHandler(async (req, res) => {
//     const { name, description, image, category, isActive, sortOrder } = req.body

//     // Check if category exists
//     const categoryExists = await Category.findById(category)
//     if (!categoryExists) {
//       res.status(400)
//       throw new Error("Category not found")
//     }

//     // Generate slug from name
//     const slug = name
//       .toLowerCase()
//       .replace(/[^a-zA-Z0-9]/g, "-")
//       .replace(/-+/g, "-")
//       .replace(/^-|-$/g, "")

//     const subcategory = new SubCategory({
//       name,
//       slug,
//       description,
//       image,
//       category,
//       isActive: isActive !== undefined ? isActive : true,
//       sortOrder: sortOrder || 0,
//       createdBy: req.user._id,
//     })

//     const createdSubCategory = await subcategory.save()

//     // Populate category info before sending response
//     await createdSubCategory.populate("category", "name slug")

//     res.status(201).json(createdSubCategory)
//   }),
// )

// // @desc    Update a subcategory
// // @route   PUT /api/subcategories/:id
// // @access  Private/Admin
// router.put(
//   "/:id",
//   protect,
//   admin,
//   asyncHandler(async (req, res) => {
//     const subcategory = await SubCategory.findById(req.params.id)

//     if (subcategory && !subcategory.isDeleted) {
//       const { name, description, image, category, isActive, sortOrder } = req.body

//       // Check if category exists if it's being updated
//       if (category && category !== subcategory.category.toString()) {
//         const categoryExists = await Category.findById(category)
//         if (!categoryExists) {
//           res.status(400)
//           throw new Error("Category not found")
//         }
//       }

//       subcategory.name = name || subcategory.name
//       subcategory.description = description || subcategory.description
//       subcategory.image = image || subcategory.image
//       subcategory.category = category || subcategory.category
//       subcategory.isActive = isActive !== undefined ? isActive : subcategory.isActive
//       subcategory.sortOrder = sortOrder !== undefined ? sortOrder : subcategory.sortOrder

//       // Update slug if name changed
//       if (name && name !== subcategory.name) {
//         subcategory.slug = name
//           .toLowerCase()
//           .replace(/[^a-zA-Z0-9]/g, "-")
//           .replace(/-+/g, "-")
//           .replace(/^-|-$/g, "")
//       }

//       const updatedSubCategory = await subcategory.save()
//       await updatedSubCategory.populate("category", "name slug")

//       res.json(updatedSubCategory)
//     } else {
//       res.status(404)
//       throw new Error("SubCategory not found")
//     }
//   }),
// )

// // @desc    Soft delete a subcategory (move to trash)
// // @route   DELETE /api/subcategories/:id
// // @access  Private/Admin
// router.delete(
//   "/:id",
//   protect,
//   admin,
//   asyncHandler(async (req, res) => {
//     const subcategory = await SubCategory.findById(req.params.id)

//     if (subcategory && !subcategory.isDeleted) {
//       subcategory.isDeleted = true
//       subcategory.deletedAt = new Date()
//       await subcategory.save()
//       res.json({ message: "SubCategory moved to trash" })
//     } else {
//       res.status(404)
//       throw new Error("SubCategory not found")
//     }
//   }),
// )

// // @desc    Restore a subcategory from trash
// // @route   PUT /api/subcategories/:id/restore
// // @access  Private/Admin
// router.put(
//   "/:id/restore",
//   protect,
//   admin,
//   asyncHandler(async (req, res) => {
//     const subcategory = await SubCategory.findById(req.params.id)

//     if (subcategory && subcategory.isDeleted) {
//       subcategory.isDeleted = false
//       subcategory.deletedAt = null
//       await subcategory.save()
//       res.json({ message: "SubCategory restored successfully" })
//     } else {
//       res.status(404)
//       throw new Error("SubCategory not found in trash")
//     }
//   }),
// )

// // @desc    Permanently delete a subcategory
// // @route   DELETE /api/subcategories/:id/permanent
// // @access  Private/Admin
// router.delete(
//   "/:id/permanent",
//   protect,
//   admin,
//   asyncHandler(async (req, res) => {
//     const subcategory = await SubCategory.findById(req.params.id)

//     if (subcategory && subcategory.isDeleted) {
//       await subcategory.deleteOne()
//       res.json({ message: "SubCategory permanently deleted" })
//     } else {
//       res.status(404)
//       throw new Error("SubCategory not found in trash")
//     }
//   }),
// )

// export default router





// import express from "express"
// import asyncHandler from "express-async-handler"
// import SubCategory from "../models/subCategoryModel.js"
// import Category from "../models/categoryModel.js"
// import { protect, admin } from "../middleware/authMiddleware.js"

// const router = express.Router()

// // @desc    Get all active subcategories
// // @route   GET /api/subcategories
// // @access  Public
// router.get(
//   "/",
//   asyncHandler(async (req, res) => {
//     try {
//       const { category } = req.query

//       const query = {
//         isActive: { $ne: false },
//         isDeleted: { $ne: true },
//       }

//       if (category) {
//         // Find category by name or ID
//         const categoryDoc = await Category.findOne({
//           $or: [{ _id: category }, { name: { $regex: new RegExp(`^${category}$`, "i") } }, { slug: category }],
//         })

//         if (categoryDoc) {
//           query.category = categoryDoc._id
//         }
//       }

//       const subcategories = await SubCategory.find(query)
//         .populate("category", "name slug")
//         .sort({ sortOrder: 1, name: 1 })

//       // Filter out invalid subcategories
//       const validSubCategories = subcategories.filter((sub) => {
//         return sub && sub._id && sub.name && typeof sub.name === "string" && sub.name.trim() !== ""
//       })

//       res.json(validSubCategories)
//     } catch (error) {
//       console.error("Error fetching subcategories:", error)
//       res.status(500).json({ message: "Error fetching subcategories", error: error.message })
//     }
//   }),
// )

// // @desc    Get single subcategory
// // @route   GET /api/subcategories/:id
// // @access  Public
// router.get(
//   "/:id",
//   asyncHandler(async (req, res) => {
//     const subcategory = await SubCategory.findById(req.params.id).populate("category")

//     if (subcategory && subcategory.isActive !== false) {
//       res.json(subcategory)
//     } else {
//       res.status(404)
//       throw new Error("Subcategory not found")
//     }
//   }),
// )

// // @desc    Create a subcategory
// // @route   POST /api/subcategories
// // @access  Private/Admin
// router.post(
//   "/",
//   protect,
//   admin,
//   asyncHandler(async (req, res) => {
//     const { name, description, image, category, isActive, sortOrder } = req.body

//     if (!name || name.trim() === "") {
//       res.status(400)
//       throw new Error("Subcategory name is required")
//     }

//     if (!category) {
//       res.status(400)
//       throw new Error("Parent category is required")
//     }

//     // Verify parent category exists
//     const parentCategory = await Category.findById(category)
//     if (!parentCategory) {
//       res.status(400)
//       throw new Error("Parent category not found")
//     }

//     // Check if subcategory with same name already exists in this category
//     const existingSubCategory = await SubCategory.findOne({
//       name: { $regex: new RegExp(`^${name.trim()}$`, "i") },
//       category: category,
//     })

//     if (existingSubCategory) {
//       res.status(400)
//       throw new Error("Subcategory with this name already exists in this category")
//     }

//     // Generate slug
//     const slug = name.trim().toLowerCase().replace(/\s+/g, "-")

//     const subcategory = new SubCategory({
//       name: name.trim(),
//       slug,
//       description: description || "",
//       image: image || "",
//       category,
//       isActive: isActive !== undefined ? isActive : true,
//       sortOrder: sortOrder || 0,
//       createdBy: req.user._id,
//     })

//     const createdSubCategory = await subcategory.save()
//     await createdSubCategory.populate("category", "name slug")

//     res.status(201).json(createdSubCategory)
//   }),
// )

// // @desc    Update a subcategory
// // @route   PUT /api/subcategories/:id
// // @access  Private/Admin
// router.put(
//   "/:id",
//   protect,
//   admin,
//   asyncHandler(async (req, res) => {
//     const { name, description, image, category, isActive, sortOrder } = req.body

//     const subcategory = await SubCategory.findById(req.params.id)

//     if (subcategory) {
//       // Check if another subcategory with same name exists (excluding current)
//       if (name && name.trim() !== subcategory.name) {
//         const existingSubCategory = await SubCategory.findOne({
//           name: { $regex: new RegExp(`^${name.trim()}$`, "i") },
//           category: category || subcategory.category,
//           _id: { $ne: req.params.id },
//         })

//         if (existingSubCategory) {
//           res.status(400)
//           throw new Error("Subcategory with this name already exists in this category")
//         }
//       }

//       // Verify parent category if being changed
//       if (category && category !== subcategory.category.toString()) {
//         const parentCategory = await Category.findById(category)
//         if (!parentCategory) {
//           res.status(400)
//           throw new Error("Parent category not found")
//         }
//       }

//       subcategory.name = name?.trim() || subcategory.name
//       subcategory.description = description !== undefined ? description : subcategory.description
//       subcategory.image = image !== undefined ? image : subcategory.image
//       subcategory.category = category || subcategory.category
//       subcategory.isActive = isActive !== undefined ? isActive : subcategory.isActive
//       subcategory.sortOrder = sortOrder !== undefined ? sortOrder : subcategory.sortOrder

//       // Update slug if name changed
//       if (name && name.trim() !== subcategory.name) {
//         subcategory.slug = name.trim().toLowerCase().replace(/\s+/g, "-")
//       }

//       const updatedSubCategory = await subcategory.save()
//       await updatedSubCategory.populate("category", "name slug")

//       res.json(updatedSubCategory)
//     } else {
//       res.status(404)
//       throw new Error("Subcategory not found")
//     }
//   }),
// )

// // @desc    Delete a subcategory
// // @route   DELETE /api/subcategories/:id
// // @access  Private/Admin
// router.delete(
//   "/:id",
//   protect,
//   admin,
//   asyncHandler(async (req, res) => {
//     const subcategory = await SubCategory.findById(req.params.id)

//     if (subcategory) {
//       // Soft delete
//       subcategory.isDeleted = true
//       subcategory.isActive = false
//       subcategory.deletedAt = new Date()
//       await subcategory.save()

//       res.json({ message: "Subcategory deleted successfully" })
//     } else {
//       res.status(404)
//       throw new Error("Subcategory not found")
//     }
//   }),
// )

// // @desc    Get subcategories by category
// // @route   GET /api/subcategories/category/:categoryId
// // @access  Public
// router.get(
//   "/category/:categoryId",
//   asyncHandler(async (req, res) => {
//     const subcategories = await SubCategory.find({
//       category: req.params.categoryId,
//       isActive: { $ne: false },
//       isDeleted: { $ne: true },
//     })
//       .populate("category", "name slug")
//       .sort({ sortOrder: 1, name: 1 })

//     res.json(subcategories)
//   }),
// )

// export default router




//======================================Final +===============================






import express from "express"
import asyncHandler from "express-async-handler"
import SubCategory from "../models/subCategoryModel.js"
import Category from "../models/categoryModel.js"
import { protect, admin } from "../middleware/authMiddleware.js"

const router = express.Router()

// @desc    Fetch all subcategories (Admin only - includes inactive)
// @route   GET /api/subcategories/admin
// @access  Private/Admin
router.get(
  "/admin",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const subCategories = await SubCategory.find({ isDeleted: { $ne: true } })
      .populate("category", "name slug")
      .sort({ sortOrder: 1, name: 1 })
    res.json(subCategories)
  }),
)

// @desc    Fetch all subcategories
// @route   GET /api/subcategories
// @access  Public
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { category } = req.query;
    let filter = { isActive: true, isDeleted: { $ne: true } };
    if (category) {
      filter.category = category;
    }
    const subCategories = await SubCategory.find(filter)
      .populate("category", "name slug")
      .sort({ sortOrder: 1, name: 1 });
    res.json(subCategories);
  })
);

// @desc    Create a subcategory
// @route   POST /api/subcategories
// @access  Private/Admin
router.post(
  "/",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const { name, description, seoContent, metaTitle, metaDescription, redirectUrl, category, image, slug } = req.body

    if (!name || name.trim() === "") {
      res.status(400)
      throw new Error("Subcategory name is required")
    }

    if (!category) {
      res.status(400)
      throw new Error("Parent category is required")
    }

    // Check if parent category exists
    const parentCategory = await Category.findById(category)
    if (!parentCategory) {
      res.status(400)
      throw new Error("Parent category not found")
    }

    // Check if subcategory with same name already exists in this category
    const existingSubCategory = await SubCategory.findOne({
      name: { $regex: new RegExp(`^${name.trim()}$`, "i") },
      category: category,
    })

    if (existingSubCategory) {
      res.status(400)
      throw new Error("Subcategory with this name already exists in this category")
    }

    // Generate slug if not provided
    const subCategorySlug = slug || name.trim().toLowerCase().replace(/\s+/g, "-")

    const subcategory = new SubCategory({
      name: name.trim(),
      description: description || "",
      seoContent: seoContent || "",
      metaTitle: metaTitle || "",
      metaDescription: metaDescription || "",
      redirectUrl: redirectUrl || "",
      category: category,
      image: image || "",
      slug: subCategorySlug,
      isActive: true,
      createdBy: req.user._id,
    })

    const createdSubCategory = await subcategory.save()
    await createdSubCategory.populate("category", "name")
    res.status(201).json(createdSubCategory)
  }),
)

// @desc    Update a subcategory
// @route   PUT /api/subcategories/:id
// @access  Private/Admin
router.put(
  "/:id",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const { name, description, seoContent, metaTitle, metaDescription, redirectUrl, category, image, slug, isActive } = req.body

    const subcategory = await SubCategory.findById(req.params.id)

    if (subcategory && !subcategory.isDeleted) {
      // Check if another subcategory with same name exists (excluding current)
      if (name && name.trim() !== subcategory.name) {
        const existingSubCategory = await SubCategory.findOne({
          name: { $regex: new RegExp(`^${name.trim()}$`, "i") },
          category: category || subcategory.category,
          _id: { $ne: req.params.id },
        })

        if (existingSubCategory) {
          res.status(400)
          throw new Error("Subcategory with this name already exists in this category")
        }
      }

      // Validate parent category if provided
      if (category && category !== subcategory.category.toString()) {
        const parentCategory = await Category.findById(category)
        if (!parentCategory) {
          res.status(400)
          throw new Error("Parent category not found")
        }
      }

      subcategory.name = name?.trim() || subcategory.name
      subcategory.description = description !== undefined ? description : subcategory.description
      subcategory.seoContent = seoContent !== undefined ? seoContent : subcategory.seoContent
      subcategory.metaTitle = metaTitle !== undefined ? metaTitle : subcategory.metaTitle
      subcategory.metaDescription = metaDescription !== undefined ? metaDescription : subcategory.metaDescription
      subcategory.redirectUrl = redirectUrl !== undefined ? redirectUrl : subcategory.redirectUrl
      subcategory.category = category || subcategory.category
      subcategory.image = image !== undefined ? image : subcategory.image
      subcategory.slug = slug || subcategory.slug
      subcategory.isActive = isActive !== undefined ? isActive : subcategory.isActive

      const updatedSubCategory = await subcategory.save()
      await updatedSubCategory.populate("category", "name")
      res.json(updatedSubCategory)
    } else {
      res.status(404)
      throw new Error("Subcategory not found")
    }
  }),
)

// @desc    Delete a subcategory
// @route   DELETE /api/subcategories/:id
// @access  Private/Admin
router.delete(
  "/:id",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const subcategory = await SubCategory.findById(req.params.id)

    if (subcategory && !subcategory.isDeleted) {
      // Soft delete - mark as deleted instead of removing
      subcategory.isDeleted = true
      subcategory.isActive = false
      await subcategory.save()

      res.json({ message: "Subcategory deleted successfully" })
    } else {
      res.status(404)
      throw new Error("Subcategory not found")
    }
  }),
)

// @desc    Get subcategories by category
// @route   GET /api/subcategories/category/:categoryId
// @access  Public
router.get(
  "/category/:categoryId",
  asyncHandler(async (req, res) => {
    const subcategories = await SubCategory.find({
      category: req.params.categoryId,
      isActive: { $ne: false },
      isDeleted: { $ne: true },
    })
      .populate("category", "name")
      .sort({ name: 1 })

    res.json(subcategories)
  }),
)

// @desc    Get a subcategory by ID
// @route   GET /api/subcategories/:id
// @access  Private/Admin
router.get(
  "/:id",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    console.log(`Fetching subcategory with ID: ${req.params.id}`)
    try {
      const subcategory = await SubCategory.findById(req.params.id).populate("category", "name slug")
      
      console.log(`Subcategory found:`, subcategory ? 'Yes' : 'No')
      
      if (subcategory && !subcategory.isDeleted) {
        res.json(subcategory)
      } else {
        res.status(404)
        throw new Error("Subcategory not found")
      }
    } catch (error) {
      console.error(`Error fetching subcategory: ${error.message}`)
      res.status(404)
      throw new Error(`Subcategory not found: ${error.message}`)
    }
  }),
)

export default router
