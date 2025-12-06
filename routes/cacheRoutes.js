import express from "express"
import asyncHandler from "express-async-handler"
import CacheVersion from "../models/cacheVersionModel.js"
import { protect, admin } from "../middleware/authMiddleware.js"

const router = express.Router()

// @desc    Get current cache version
// @route   GET /api/cache/version
// @access  Public
router.get(
  "/version",
  asyncHandler(async (req, res) => {
    let cacheData = await CacheVersion.findOne({})

    if (!cacheData) {
      cacheData = new CacheVersion({ version: 1 })
      await cacheData.save()
    }

    res.json({
      version: cacheData.version,
      resetAt: cacheData.resetAt,
    })
  })
)

// @desc    Get cache reset history
// @route   GET /api/cache/history
// @access  Private/Admin
router.get(
  "/history",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    let cacheData = await CacheVersion.findOne({}).populate("resetHistory.resetBy", "name email")

    if (!cacheData) {
      cacheData = new CacheVersion({ version: 1 })
      await cacheData.save()
    }

    res.json({
      currentVersion: cacheData.version,
      lastResetAt: cacheData.resetAt,
      history: cacheData.resetHistory || [],
    })
  })
)

// @desc    Reset cache for all users
// @route   POST /api/cache/reset
// @access  Private/Admin
router.post(
  "/reset",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    let cacheData = await CacheVersion.findOne({})

    if (!cacheData) {
      cacheData = new CacheVersion({ version: 1 })
    }

    // Increment cache version
    const newVersion = (cacheData.version || 1) + 1
    const resetTime = new Date()

    // Add to history
    if (!cacheData.resetHistory) {
      cacheData.resetHistory = []
    }
    cacheData.resetHistory.unshift({
      version: newVersion,
      resetAt: resetTime,
      resetBy: req.user._id,
    })

    // Keep only last 20 reset records
    if (cacheData.resetHistory.length > 20) {
      cacheData.resetHistory = cacheData.resetHistory.slice(0, 20)
    }

    cacheData.version = newVersion
    cacheData.resetAt = resetTime
    cacheData.resetBy = req.user._id

    await cacheData.save()

    res.json({
      success: true,
      message: "Cache reset successfully! All users will get fresh content on their next visit.",
      version: cacheData.version,
      resetAt: cacheData.resetAt,
    })
  })
)

export default router
