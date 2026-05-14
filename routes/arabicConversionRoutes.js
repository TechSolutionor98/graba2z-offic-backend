import express from "express"
import asyncHandler from "express-async-handler"
import { protect, admin } from "../middleware/authMiddleware.js"
import { getArabicConversionStatus, startArabicConversionJob } from "../services/arabicConversionJobService.js"

const router = express.Router()

// @desc    Get Arabic conversion status
// @route   GET /api/admin/arabic-conversion/status
// @access  Private/Admin
router.get(
  "/status",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const scope = req.query.scope ? String(req.query.scope).trim().toLowerCase() : ""
    if (scope && !["blog", "grab"].includes(scope)) {
      res.status(400)
      throw new Error("Invalid scope. Use 'blog' or 'grab'.")
    }
    const payload = getArabicConversionStatus(scope || undefined)
    res.json(payload)
  }),
)

// @desc    Start Arabic conversion job
// @route   POST /api/admin/arabic-conversion/start
// @access  Private/Admin
router.post(
  "/start",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const scope = String(req.body?.scope || "").trim().toLowerCase()
    const force = Boolean(req.body?.force)
    if (!["blog", "grab"].includes(scope)) {
      res.status(400)
      throw new Error("Invalid scope. Use 'blog' or 'grab'.")
    }

    const result = startArabicConversionJob({
      scope,
      force,
      requestedBy: req.user?._id ? String(req.user._id) : null,
    })

    res.status(result.started ? 202 : 200).json(result)
  }),
)

export default router
