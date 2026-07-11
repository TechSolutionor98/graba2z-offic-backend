import express from "express"
import asyncHandler from "express-async-handler"
import axios from "axios"
import IndexNowLog from "../models/indexNowLogModel.js"
import { protect, admin } from "../middleware/authMiddleware.js"
import { submitUrls, submitSitemap } from "../services/indexNowService.js"
import config from "../config/config.js"

const router = express.Router()

// @desc    Get IndexNow submission logs
// @route   GET /api/indexnow/logs
// @access  Private/Admin
router.get(
  "/logs",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page) || 1
    const limit = parseInt(req.query.limit) || 10
    const skip = (page - 1) * limit

    const count = await IndexNowLog.countDocuments()
    const logs = await IndexNowLog.find()
      .populate("initiatedBy", "name email")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)

    res.json({
      logs,
      page,
      pages: Math.ceil(count / limit),
      totalLogs: count,
    })
  }),
)

// @desc    Manually submit custom URLs
// @route   POST /api/indexnow/submit
// @access  Private/Admin
router.post(
  "/submit",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const { urls } = req.body

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      res.status(400)
      throw new Error("An array of URLs is required")
    }

    const result = await submitUrls(urls, "manual_single", req.user._id)

    if (result.success) {
      res.json({
        message: "URLs submitted successfully to IndexNow",
        status: result.status,
        submittedCount: result.submittedCount || urls.length,
      })
    } else {
      res.status(result.status || 500)
      throw new Error(result.message || "Failed to submit URLs to IndexNow")
    }
  }),
)

// @desc    Submit all sitemap URLs (bulk)
// @route   POST /api/indexnow/submit-sitemap
// @access  Private/Admin
router.post(
  "/submit-sitemap",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const result = await submitSitemap(req.user._id)

    if (result.success) {
      res.json({
        message: "Sitemap URLs submitted successfully to IndexNow",
        status: result.status,
        submittedCount: result.submittedCount,
      })
    } else {
      res.status(result.status || 500)
      throw new Error(result.message || "Failed to submit sitemap to IndexNow")
    }
  }),
)

// @desc    Verify if API key file is hosted successfully and reachable
// @route   GET /api/indexnow/status
// @access  Private/Admin
router.get(
  "/status",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const key = config.INDEXNOW_KEY
    const protocol = req.protocol
    const host = req.headers.host
    const verifyUrl = `${protocol}://${host}/${key}.txt`

    try {
      console.log(`[IndexNow Status] Verifying hosted key at ${verifyUrl}`)
      const response = await axios.get(verifyUrl, { 
        timeout: 8000,
        headers: {
          "User-Agent": "IndexNow-Validator/1.0"
        }
      })

      const content = typeof response.data === "string" ? response.data.trim() : String(response.data).trim()

      if (content === key) {
        return res.json({
          success: true,
          verified: true,
          keyLocation: verifyUrl,
          message: "API key verified successfully! The hosted key matches.",
          content: content,
        })
      } else {
        return res.json({
          success: false,
          verified: false,
          keyLocation: verifyUrl,
          message: `File found but content did not match key. Expected '${key}', got '${content.substring(0, 100)}'`,
          content: content,
        })
      }
    } catch (error) {
      return res.json({
        success: false,
        verified: false,
        keyLocation: verifyUrl,
        message: `Could not reach hosted verification file: ${error.message}`,
        error: error.message,
      })
    }
  }),
)

export default router
