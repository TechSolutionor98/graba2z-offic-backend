import express from "express"
import asyncHandler from "express-async-handler"
import multer from "multer"
import path from "path"
import fs from "fs"
import { fileURLToPath } from "url"
import PopupSettings from "../models/popupSettingsModel.js"
import { protect, admin } from "../middleware/authMiddleware.js"
import { logActivity } from "../middleware/permissionMiddleware.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const router = express.Router()

// Configure multer for popup image uploads
const uploadsDir = path.join(__dirname, "../uploads/popup")
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true })
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname)
    cb(null, `popup-${Date.now()}${ext}`)
  },
})

const fileFilter = (_req, file, cb) => {
  // Only accept WebP images
  const isWebp =
    file.mimetype === "image/webp" ||
    file.originalname.toLowerCase().endsWith(".webp")
  if (isWebp) {
    cb(null, true)
  } else {
    cb(new Error("Only WebP images are accepted for the popup banner."), false)
  }
}

const upload = multer({ storage, fileFilter, limits: { fileSize: 10 * 1024 * 1024 } })

// Helper: safely delete a local file
const deleteLocalFile = (relativeUrl) => {
  if (!relativeUrl) return
  try {
    const rel = relativeUrl.replace(/^\/uploads\//, "")
    const abs = path.resolve(path.join(__dirname, "../uploads"), rel)
    if (fs.existsSync(abs)) fs.unlinkSync(abs)
  } catch {
    // ignore
  }
}

// ── PUBLIC ROUTE ─────────────────────────────────────────────────────────────
// @desc    Get active popup for a specific pageKey
// @route   GET /api/popup-settings
// @access  Public
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { pageKey, platform } = req.query
    const source = (platform || req.headers["x-order-source"] || req.headers["x-client-source"] || "web")
      .toString()
      .trim()
      .toLowerCase()

    const query = { isEnabled: true }
    if (pageKey) {
      query.showOnPages = pageKey
    }

    // Filter by target platforms (support legacy empty array or missing field)
    query.$or = [
      { platforms: source },
      { platforms: { $exists: false } },
      { platforms: { $size: 0 } },
    ]

    // Find the latest active popup targeting this page and platform
    const popup = await PopupSettings.findOne(query).sort({ updatedAt: -1 })
    res.json(popup)
  }),
)

// ── ADMIN ROUTES ─────────────────────────────────────────────────────────────
// @desc    Get all popups for admin list
// @route   GET /api/popup-settings/admin
// @access  Private/Admin
router.get(
  "/admin",
  protect,
  admin,
  asyncHandler(async (_req, res) => {
    const list = await PopupSettings.find({}).sort({ createdAt: -1 })
    res.json(list)
  }),
)

// @desc    Get single popup detail
// @route   GET /api/popup-settings/admin/:id
// @access  Private/Admin
router.get(
  "/admin/:id",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const popup = await PopupSettings.findById(req.params.id)
    if (!popup) {
      res.status(404)
      throw new Error("Popup not found")
    }
    res.json(popup)
  }),
)

// @desc    Create new popup settings
// @route   POST /api/popup-settings
// @access  Private/Admin
router.post(
  "/",
  protect,
  admin,
  upload.single("leftImage"),
  asyncHandler(async (req, res) => {
    const b = req.body

    const showOnPages = b.showOnPages
      ? typeof b.showOnPages === "string" && b.showOnPages.startsWith("[")
        ? JSON.parse(b.showOnPages)
        : typeof b.showOnPages === "string"
        ? b.showOnPages.split(",").map((s) => s.trim()).filter(Boolean)
        : b.showOnPages
      : ["home"]

    const platforms = b.platforms
      ? typeof b.platforms === "string" && b.platforms.startsWith("[")
        ? JSON.parse(b.platforms)
        : typeof b.platforms === "string"
        ? b.platforms.split(",").map((s) => s.trim()).filter(Boolean)
        : b.platforms
      : ["web", "app"]

    const popup = new PopupSettings({
      name: b.name || "Unnamed Promo Popup",
      isEnabled: b.isEnabled === "true" || b.isEnabled === true,
      showOnPages,
      platforms,
      showLimit: b.showLimit || "once",
      sectionTitle: b.sectionTitle || "Why Download Our App?",
      feature1Label: b.feature1Label || "Exclusive\nApp Discounts",
      feature2Label: b.feature2Label || "Faster &\nSmooth Checkout",
      feature3Label: b.feature3Label || "Early Access to\nDeals & Offers",
      discountTopText: b.discountTopText || "DOWNLOAD NOW & GET",
      discountValue: b.discountValue || "10% Off",
      discountBottomText: b.discountBottomText || "On Your First App Order!",
      discountNote: b.discountNote || "*T&C Apply",
      googlePlayLink: b.googlePlayLink || "https://play.google.com/store/apps/details?id=ae.grabatoz1.grabatoz1",
      appStoreLink: b.appStoreLink || "https://apps.apple.com/pk/app/graba2z/id6742447046",
      continueButtonText: b.continueButtonText || "Continue to Website",
      leftImageUrl: req.file ? `/uploads/popup/${req.file.filename}` : "",
      updatedBy: req.user._id,
    })

    const created = await popup.save()

    await logActivity({
      user: req.user,
      action: "CREATE",
      module: "POPUP_SETTINGS",
      description: `Created popup: ${created.name}`,
      targetId: created._id,
      targetName: created.name,
      req,
    })

    res.status(201).json(created)
  }),
)

// @desc    Update popup settings
// @route   PUT /api/popup-settings/:id
// @access  Private/Admin
router.put(
  "/:id",
  protect,
  admin,
  upload.single("leftImage"),
  asyncHandler(async (req, res) => {
    const popup = await PopupSettings.findById(req.params.id)
    if (!popup) {
      res.status(404)
      throw new Error("Popup not found")
    }

    const b = req.body

    const str = (val) => (val !== undefined ? String(val).trim() : undefined)
    const bool = (val) => (val !== undefined ? val === true || val === "true" : undefined)

    const fields = [
      "name",
      "sectionTitle",
      "feature1Label",
      "feature2Label",
      "feature3Label",
      "discountTopText",
      "discountValue",
      "discountBottomText",
      "discountNote",
      "googlePlayLink",
      "appStoreLink",
      "continueButtonText",
      "showLimit",
    ]
    fields.forEach((key) => {
      const v = str(b[key])
      if (v !== undefined) popup[key] = v
    })

    const enabled = bool(b.isEnabled)
    if (enabled !== undefined) popup.isEnabled = enabled

    if (b.showOnPages !== undefined) {
      try {
        const parsed = typeof b.showOnPages === "string" && b.showOnPages.startsWith("[")
          ? JSON.parse(b.showOnPages)
          : typeof b.showOnPages === "string"
          ? b.showOnPages.split(",").map((s) => s.trim()).filter(Boolean)
          : b.showOnPages
        popup.showOnPages = Array.isArray(parsed) ? parsed : [parsed]
      } catch {
        popup.showOnPages = String(b.showOnPages)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      }
    }

    if (b.platforms !== undefined) {
      try {
        const parsed = typeof b.platforms === "string" && b.platforms.startsWith("[")
          ? JSON.parse(b.platforms)
          : typeof b.platforms === "string"
          ? b.platforms.split(",").map((s) => s.trim()).filter(Boolean)
          : b.platforms
        popup.platforms = Array.isArray(parsed) ? parsed : [parsed]
      } catch {
        popup.platforms = String(b.platforms)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      }
    }

    // Handle left panel image upload
    if (req.file) {
      deleteLocalFile(popup.leftImageUrl)
      popup.leftImageUrl = `/uploads/popup/${req.file.filename}`
    }

    popup.updatedBy = req.user._id
    const updated = await popup.save()

    await logActivity({
      user: req.user,
      action: "UPDATE",
      module: "POPUP_SETTINGS",
      description: `Updated popup: ${updated.name}`,
      targetId: updated._id,
      targetName: updated.name,
      req,
    })

    res.json(updated)
  }),
)

// @desc    Delete popup settings
// @route   DELETE /api/popup-settings/:id
// @access  Private/Admin
router.delete(
  "/:id",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const popup = await PopupSettings.findById(req.params.id)
    if (!popup) {
      res.status(404)
      throw new Error("Popup not found")
    }

    const name = popup.name
    const targetId = popup._id

    // Delete associated image file
    deleteLocalFile(popup.leftImageUrl)

    await popup.deleteOne()

    await logActivity({
      user: req.user,
      action: "DELETE",
      module: "POPUP_SETTINGS",
      description: `Deleted popup: ${name}`,
      targetId,
      targetName: name,
      req,
    })

    res.json({ message: "Popup deleted" })
  }),
)

export default router
