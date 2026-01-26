import express from "express"
import asyncHandler from "express-async-handler"
import Blog from "../models/blogModel.js"
import { protect, admin } from "../middleware/authMiddleware.js"

const router = express.Router()

// @desc    Get featured blogs
// @route   GET /api/blogs/featured
// @access  Public
router.get(
  "/featured",
  asyncHandler(async (req, res) => {
    const featuredBlogs = await Blog.find({ 
      status: "published", 
      featured: true 
    })
      .populate("mainCategory", "name slug")
      .populate("subCategory1", "name slug")
      .populate("subCategory2", "name slug")
      .populate("subCategory3", "name slug")
      .populate("subCategory4", "name slug")
      .populate("topic", "name slug color")
      .populate("brand", "name slug")
      .sort({ createdAt: -1 })
      .limit(10)

    res.json(featuredBlogs)
  }),
)

// @desc    Get trending blogs
// @route   GET /api/blogs/trending
// @access  Public
router.get(
  "/trending",
  asyncHandler(async (req, res) => {
    const { limit = 20 } = req.query
    
    const trendingBlogs = await Blog.find({ 
      status: "published", 
      trending: true 
    })
      .populate("mainCategory", "name slug color")
      .populate("subCategory1", "name slug")
      .populate("subCategory2", "name slug")
      .populate("subCategory3", "name slug")
      .populate("subCategory4", "name slug")
      .populate("topic", "name slug color")
      .populate("brand", "name slug")
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))

    res.json(trendingBlogs)
  }),
)

// @desc    Get all blogs
// @route   GET /api/blogs
// @access  Public
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { status, category, topic, search, page = 1, limit = 10 } = req.query

    const query = {}

    // Filter by status
    if (status && status !== "all") {
      query.status = status
    }

    // Filter by category
    if (category && category !== "all") {
      query.mainCategory = category
    }

    // Filter by topic
    if (topic && topic !== "all") {
      query.topic = topic
    }

    // Search functionality
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
        { tags: { $in: [new RegExp(search, "i")] } },
      ]
    }

    const blogs = await Blog.find(query)
      .populate("mainCategory", "name slug")
      .populate("subCategory1", "name slug")
      .populate("subCategory2", "name slug")
      .populate("subCategory3", "name slug")
      .populate("subCategory4", "name slug")
      .populate("topic", "name slug color")
      .populate("brand", "name slug")
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)

    const total = await Blog.countDocuments(query)
    
    const currentPage = parseInt(page)
    const itemsPerPage = parseInt(limit)
    const totalPages = Math.ceil(total / itemsPerPage)

    res.json({
      blogs,
      pagination: {
        current: currentPage,
        total: totalPages,
        hasNext: currentPage < totalPages,
        hasPrev: currentPage > 1,
        totalBlogs: total
      }
    })
  }),
)

// @desc    Get single blog
// @route   GET /api/blogs/:id
// @access  Public
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const blog = await Blog.findById(req.params.id)
      .populate("mainCategory", "name slug")
      .populate("subCategory1", "name slug")
      .populate("subCategory2", "name slug")
      .populate("subCategory3", "name slug")
      .populate("subCategory4", "name slug")
      .populate("topic", "name slug color")
      .populate("brand", "name slug")

    if (!blog) {
      res.status(404)
      throw new Error("Blog not found")
    }

    // Increment views
    blog.views += 1
    await blog.save()

    res.json(blog)
  }),
)

// @desc    Get blog by slug
// @route   GET /api/blogs/slug/:slug
// @access  Public
router.get(
  "/slug/:slug",
  asyncHandler(async (req, res) => {
    const blog = await Blog.findOne({ slug: req.params.slug })
      .populate("mainCategory", "name slug")
      .populate("subCategory1", "name slug")
      .populate("subCategory2", "name slug")
      .populate("subCategory3", "name slug")
      .populate("subCategory4", "name slug")
      .populate("topic", "name slug color")
      .populate("brand", "name slug")

    if (!blog) {
      res.status(404)
      throw new Error("Blog not found")
    }

    // Increment views
    blog.views += 1
    await blog.save()

    res.json(blog)
  }),
)

// @desc    Create new blog
// @route   POST /api/blogs
// @access  Private/Admin
router.post(
  "/",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const {
      blogName,
      title,
      slug,
      status,
      featured,
      trending,
      mainCategory,
      subCategory1,
      subCategory2,
      subCategory3,
      subCategory4,
      topic,
      brand,
      mainImage,
      additionalImage,
      readMinutes,
      postedBy,
      description,
      metaTitle,
      metaDescription,
      tags,
    } = req.body

    // Check if slug already exists
    const existingBlog = await Blog.findOne({ slug })
    if (existingBlog) {
      res.status(400)
      throw new Error("Slug already exists")
    }

    const blog = new Blog({
      blogName,
      title,
      slug,
      status,
      featured: featured || false,
      trending: trending || false,
      mainCategory,
      subCategory1: subCategory1 || null,
      subCategory2: subCategory2 || null,
      subCategory3: subCategory3 || null,
      subCategory4: subCategory4 || null,
      topic: topic || null,
      brand: brand || null,
      mainImage,
      additionalImage,
      readMinutes,
      postedBy,
      description,
      metaTitle,
      metaDescription,
      tags,
    })

    const createdBlog = await blog.save()

    // Populate the created blog before returning
    const populatedBlog = await Blog.findById(createdBlog._id)
      .populate("mainCategory", "name slug")
      .populate("subCategory1", "name slug")
      .populate("subCategory2", "name slug")
      .populate("subCategory3", "name slug")
      .populate("subCategory4", "name slug")
      .populate("topic", "name slug color")
      .populate("brand", "name slug")

    res.status(201).json(populatedBlog)
  }),
)

// @desc    Update blog
// @route   PUT /api/blogs/:id
// @access  Private/Admin
router.put(
  "/:id",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const blog = await Blog.findById(req.params.id)

    if (!blog) {
      res.status(404)
      throw new Error("Blog not found")
    }

    const {
      blogName,
      title,
      slug,
      status,
      featured,
      trending,
      mainCategory,
      subCategory1,
      subCategory2,
      subCategory3,
      subCategory4,
      topic,
      brand,
      mainImage,
      additionalImage,
      readMinutes,
      postedBy,
      description,
      metaTitle,
      metaDescription,
      tags,
    } = req.body

    // Update blog fields
    blog.blogName = blogName || blog.blogName
    blog.title = title || blog.title
    blog.slug = slug || blog.slug
    blog.status = status || blog.status
    blog.featured = featured !== undefined ? featured : blog.featured
    blog.trending = trending !== undefined ? trending : blog.trending
    blog.mainCategory = mainCategory || blog.mainCategory
    blog.subCategory1 = subCategory1 !== undefined ? subCategory1 : blog.subCategory1
    blog.subCategory2 = subCategory2 !== undefined ? subCategory2 : blog.subCategory2
    blog.subCategory3 = subCategory3 !== undefined ? subCategory3 : blog.subCategory3
    blog.subCategory4 = subCategory4 !== undefined ? subCategory4 : blog.subCategory4
    blog.topic = topic || blog.topic
    blog.brand = brand || blog.brand
    blog.mainImage = mainImage || blog.mainImage
    blog.additionalImage = additionalImage || blog.additionalImage
    blog.readMinutes = readMinutes || blog.readMinutes
    blog.postedBy = postedBy || blog.postedBy
    blog.description = description || blog.description
    blog.metaTitle = metaTitle || blog.metaTitle
    blog.metaDescription = metaDescription || blog.metaDescription
    blog.tags = tags || blog.tags

    const updatedBlog = await blog.save()

    // Populate the updated blog before returning
    const populatedBlog = await Blog.findById(updatedBlog._id)
      .populate("mainCategory", "name slug")
      .populate("subCategory1", "name slug")
      .populate("subCategory2", "name slug")
      .populate("subCategory3", "name slug")
      .populate("subCategory4", "name slug")
      .populate("topic", "name slug color")
      .populate("brand", "name slug")

    res.json(populatedBlog)
  }),
)

// @desc    Update blog status
// @route   PATCH /api/blogs/:id/status
// @access  Private/Admin
router.patch(
  "/:id/status",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const { status } = req.body

    const blog = await Blog.findByIdAndUpdate(req.params.id, { status }, { new: true })
      .populate("mainCategory", "name slug")
      .populate("subCategory1", "name slug")
      .populate("subCategory2", "name slug")
      .populate("subCategory3", "name slug")
      .populate("subCategory4", "name slug")
      .populate("topic", "name slug color")
      .populate("brand", "name slug")

    if (!blog) {
      res.status(404)
      throw new Error("Blog not found")
    }

    res.json(blog)
  }),
)

// @desc    Delete blog
// @route   DELETE /api/blogs/:id
// @access  Private/Admin
router.delete(
  "/:id",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const blog = await Blog.findById(req.params.id)

    if (!blog) {
      res.status(404)
      throw new Error("Blog not found")
    }

    await blog.deleteOne()

    res.json({ message: "Blog deleted successfully" })
  }),
)

export default router
