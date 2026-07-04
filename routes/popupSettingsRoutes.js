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

// Helper: get or create singleton popup settings doc
const getOrCreate = async () => {
  let doc = await PopupSettings.findOne({})
  if (!doc) doc = await PopupSettings.create({})
  return doc
}

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

// @desc    Get popup settings (public)
// @route   GET /api/popup-settings
// @access  Public
router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const settings = await getOrCreate()
    res.json(settings)
  }),
)

// @desc    Get popup settings (admin)
// @route   GET /api/popup-settings/admin
// @access  Private/Admin
router.get(
  "/admin",
  protect,
  admin,
  asyncHandler(async (_req, res) => {
    const settings = await getOrCreate()
    res.json(settings)
  }),
)

// @desc    Update popup settings
// @route   PUT /api/popup-settings
// @access  Private/Admin
router.put(
  "/",
  protect,
  admin,
  upload.single("leftImage"),
  asyncHandler(async (req, res) => {
    const settings = await getOrCreate()
    const b = req.body

    const str = (val) => (val !== undefined ? String(val).trim() : undefined)
    const bool = (val) => (val !== undefined ? val === true || val === "true" : undefined)

    const fields = [
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
      if (v !== undefined) settings[key] = v
    })

    const enabled = bool(b.isEnabled)
    if (enabled !== undefined) settings.isEnabled = enabled

    if (b.showOnPages !== undefined) {
      try {
        const parsed = typeof b.showOnPages === "string" ? JSON.parse(b.showOnPages) : b.showOnPages
        settings.showOnPages = Array.isArray(parsed) ? parsed : [parsed]
      } catch {
        settings.showOnPages = String(b.showOnPages)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      }
    }

    // Handle left panel image upload
    if (req.file) {
      deleteLocalFile(settings.leftImageUrl)
      settings.leftImageUrl = `/uploads/popup/${req.file.filename}`
    }

    settings.updatedBy = req.user._id
    const updated = await settings.save()

    await logActivity({
      user: req.user,
      action: "UPDATE",
      module: "POPUP_SETTINGS",
      description: "Updated popup settings",
      targetId: updated._id,
      targetName: "Popup Settings",
      req,
    })

    res.json(updated)
  }),
)

export default router
