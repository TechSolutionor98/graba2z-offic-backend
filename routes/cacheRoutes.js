import express from "express"
import asyncHandler from "express-async-handler"
import CacheVersion from "../models/cacheVersionModel.js"
import { protect, admin } from "../middleware/authMiddleware.js"
import cacheService, { cacheHelpers } from "../services/cacheService.js"
import warmServerCache from "../services/cacheWarmService.js"

const router = express.Router()
let isAutoWarmRunning = false

const parseBoolean = (value, fallback = false) => {
  if (typeof value === "boolean") return value
  if (typeof value !== "string") return fallback
  return ["1", "true", "yes", "y", "on"].includes(value.toLowerCase())
}

const getAutoWarmOptions = (req) => {
  const fallbackBaseUrl = `${req.protocol}://${req.get("host")}`
  const bannerPositions = String(process.env.CACHE_WARM_BANNER_POSITIONS || "hero,promotional,mobile")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)

  return {
    baseUrl: process.env.CACHE_WARM_BASE_URL || fallbackBaseUrl,
    warmAllProducts: parseBoolean(process.env.CACHE_WARM_ALL_PRODUCTS ?? "true", true),
    productListLimit: Number(process.env.CACHE_WARM_PRODUCT_LIMIT || 120),
    productSampleSize: Number(process.env.CACHE_WARM_SAMPLE_SIZE || 12),
    includeCategoryFanout: parseBoolean(process.env.CACHE_WARM_CATEGORY_FANOUT ?? "true", true),
    includeProductsByCategory: true,
    includeSubcategoriesByCategory: true,
    perCategoryProductLimit: Number(process.env.CACHE_WARM_PER_CATEGORY_PRODUCT_LIMIT || 12),
    includeBannerPositions: true,
    bannerPositions,
    includeBuyerProtection: parseBoolean(process.env.CACHE_WARM_INCLUDE_BUYER_PROTECTION ?? "true", true),
    verifyHits: false,
    verifyBuyerProtection: false,
    timeoutMs: Number(process.env.CACHE_WARM_TIMEOUT_MS || 15000),
    onProgress: (event) => {
      if (event.step === "start") {
        console.log(`[AutoWarm:${event.phase}] ${event.index}/${event.total} START ${event.path}`)
        return
      }
      const state = event.ok ? `OK ${event.status}` : `ERR ${event.status || 0}`
      const cacheText = event.cache ? ` X-Cache=${event.cache}` : ""
      const errorText = event.error ? ` ${event.error}` : ""
      console.log(
        `[AutoWarm:${event.phase}] ${event.index}/${event.total} ${state} ${event.durationMs}ms${cacheText}${errorText}`,
      )
    },
  }
}

const runAutoWarmAfterReset = (req) => {
  const enabled = parseBoolean(process.env.CACHE_AUTO_WARM_ON_RESET ?? "true", true)
  if (!enabled) return
  if (isAutoWarmRunning) {
    console.log("AutoWarm: skipped because a previous warmup is still running")
    return
  }

  isAutoWarmRunning = true
  setImmediate(async () => {
    try {
      console.log("AutoWarm: starting background cache warmup after reset")
      const result = await warmServerCache(getAutoWarmOptions(req))
      console.log(
        `AutoWarm: completed (ok=${result.summary.ok}, failed=${result.summary.failed}, avg=${result.summary.avgDurationMs}ms)`,
      )
    } catch (error) {
      console.error("AutoWarm: failed:", error.message)
    } finally {
      isAutoWarmRunning = false
    }
  })
}

const recordCacheReset = async ({ userId, reason = "Cache reset" }) => {
  let cacheData = await CacheVersion.findOne({})
  if (!cacheData) {
    cacheData = new CacheVersion({ version: 1 })
  }

  const newVersion = (cacheData.version || 1) + 1
  const resetTime = new Date()

  if (!cacheData.resetHistory) {
    cacheData.resetHistory = []
  }

  cacheData.resetHistory.unshift({
    version: newVersion,
    resetAt: resetTime,
    resetBy: userId,
    reason,
  })

  if (cacheData.resetHistory.length > 20) {
    cacheData.resetHistory = cacheData.resetHistory.slice(0, 20)
  }

  cacheData.version = newVersion
  cacheData.resetAt = resetTime
  cacheData.resetBy = userId

  await cacheData.save()

  return cacheData
}

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

// @desc    Get cache statistics
// @route   GET /api/cache/stats
// @access  Private/Admin
router.get(
  "/stats",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const stats = await cacheService.getStats()
    const health = await cacheService.healthCheck()
    
    res.json({
      success: true,
      stats,
      health,
    })
  })
)

// @desc    Get cache health status
// @route   GET /api/cache/health
// @access  Public
router.get(
  "/health",
  asyncHandler(async (req, res) => {
    const health = await cacheService.healthCheck()
    res.json(health)
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

// @desc    Reset cache for all users and flush server-side cache
// @route   POST /api/cache/reset
// @access  Private/Admin
router.post(
  "/reset",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const flushedKeys = await cacheService.flushAll()
    const cacheData = await recordCacheReset({
      userId: req.user._id,
      reason: "Admin reset cache button",
    })

    res.json({
      success: true,
      message: "Cache reset successfully. Server cache was flushed and all users will receive fresh content.",
      version: cacheData.version,
      resetAt: cacheData.resetAt,
      flushedKeys,
    })

    runAutoWarmAfterReset(req)
  })
)

// @desc    Flush all server-side cache
// @route   POST /api/cache/flush
// @access  Private/Admin
router.post(
  "/flush",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const result = await cacheService.flushAll()
    const cacheData = await recordCacheReset({
      userId: req.user._id,
      reason: "Full cache flush",
    })
    
    res.json({
      success: true,
      message: "All server-side cache has been flushed successfully!",
      result,
      clientCacheVersion: cacheData.version,
    })
  })
)

// @desc    Invalidate cache for specific entity type
// @route   POST /api/cache/invalidate/:entityType
// @access  Private/Admin
router.post(
  "/invalidate/:entityType",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const { entityType } = req.params
    
    // Valid entity types
    const validTypes = [
      'products', 'categories', 'subCategories', 'brands', 'banners', 'bannerCards',
      'settings', 'homeSections', 'offers', 'gamingZone', 'blogs', 'colors', 
      'sizes', 'units', 'volumes', 'warranties', 'taxes', 'deliveryCharges',
      'coupons', 'reviews', 'customSliderItems', 'buyerProtection'
    ]
    
    if (!validTypes.includes(entityType)) {
      res.status(400)
      throw new Error(`Invalid entity type. Valid types: ${validTypes.join(', ')}`)
    }
    
    const helper = cacheHelpers[entityType]
    let invalidatedCount = 0
    
    if (helper?.invalidate) {
      invalidatedCount = await helper.invalidate()
    } else {
      invalidatedCount = await cacheService.invalidateEntity(entityType)
    }
    
    res.json({
      success: true,
      message: `Cache for '${entityType}' has been invalidated.`,
      invalidatedKeys: invalidatedCount,
    })
  })
)

// @desc    Invalidate multiple entity types
// @route   POST /api/cache/invalidate-multiple
// @access  Private/Admin
router.post(
  "/invalidate-multiple",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const { entityTypes } = req.body
    
    if (!entityTypes || !Array.isArray(entityTypes) || entityTypes.length === 0) {
      res.status(400)
      throw new Error("Please provide an array of entity types to invalidate")
    }
    
    const results = {}
    let totalInvalidated = 0
    
    for (const entityType of entityTypes) {
      const helper = cacheHelpers[entityType]
      let count = 0
      
      if (helper?.invalidate) {
        count = await helper.invalidate()
      } else {
        count = await cacheService.invalidateEntity(entityType)
      }
      
      results[entityType] = count
      totalInvalidated += count
    }
    
    res.json({
      success: true,
      message: `Cache invalidated for ${entityTypes.length} entity types.`,
      results,
      totalInvalidated,
    })
  })
)

// @desc    Warm up cache for critical data
// @route   POST /api/cache/warm
// @access  Private/Admin
router.post(
  "/warm",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const baseUrl = req.body?.baseUrl || `${req.protocol}://${req.get("host")}`
    const warmAllProducts = req.body?.warmAllProducts !== undefined
      ? Boolean(req.body.warmAllProducts)
      : String(process.env.CACHE_WARM_ALL_PRODUCTS || "true") !== "false"
    const productListLimit = Number(req.body?.productListLimit || process.env.CACHE_WARM_PRODUCT_LIMIT || 120)
    const productSampleSize = Number(req.body?.productSampleSize || process.env.CACHE_WARM_SAMPLE_SIZE || 12)
    const includeCategoryFanout = req.body?.includeCategoryFanout !== undefined
      ? Boolean(req.body.includeCategoryFanout)
      : String(process.env.CACHE_WARM_CATEGORY_FANOUT || "true") !== "false"
    const includeProductsByCategory = req.body?.includeProductsByCategory !== undefined
      ? Boolean(req.body.includeProductsByCategory)
      : true
    const includeSubcategoriesByCategory = req.body?.includeSubcategoriesByCategory !== undefined
      ? Boolean(req.body.includeSubcategoriesByCategory)
      : true
    const perCategoryProductLimit = Number(
      req.body?.perCategoryProductLimit || process.env.CACHE_WARM_PER_CATEGORY_PRODUCT_LIMIT || 12,
    )
    const includeBannerPositions = req.body?.includeBannerPositions !== undefined
      ? Boolean(req.body.includeBannerPositions)
      : true
    const bannerPositions = Array.isArray(req.body?.bannerPositions) && req.body.bannerPositions.length > 0
      ? req.body.bannerPositions
      : String(process.env.CACHE_WARM_BANNER_POSITIONS || "hero,promotional,mobile")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
    const verifyHits = Boolean(req.body?.verifyHits)
    const verifyBuyerProtection = req.body?.verifyBuyerProtection !== undefined
      ? Boolean(req.body.verifyBuyerProtection)
      : true
    const includeBuyerProtection = req.body?.includeBuyerProtection !== undefined
      ? Boolean(req.body.includeBuyerProtection)
      : true

    const warmupResult = await warmServerCache({
      baseUrl,
      warmAllProducts,
      productListLimit,
      productSampleSize,
      includeCategoryFanout,
      includeProductsByCategory,
      includeSubcategoriesByCategory,
      perCategoryProductLimit,
      includeBannerPositions,
      bannerPositions,
      verifyHits,
      verifyBuyerProtection,
      includeBuyerProtection,
    })

    res.json({
      success: true,
      message: "Cache warmup completed.",
      ...warmupResult,
    })
  })
)

// @desc    Get list of available entity types for cache management
// @route   GET /api/cache/entity-types
// @access  Private/Admin
router.get(
  "/entity-types",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const entityTypes = Object.keys(cacheHelpers).map(key => ({
      name: key,
      description: `Cache for ${key}`,
    }))
    
    res.json({
      success: true,
      entityTypes,
    })
  })
)

export default router
