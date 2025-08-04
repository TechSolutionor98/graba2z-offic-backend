import express from "express"
import { upload, deleteFromCloudinary, uploadBanner } from "../utils/cloudinary.js"
import { protect, admin } from "../middleware/authMiddleware.js"
import asyncHandler from "express-async-handler"

const router = express.Router()

// @desc    Upload single image
// @route   POST /api/upload/single
// @access  Private/Admin
router.post(
  "/single",
  (req, res, next) => {
    console.log("📤 Single upload request received")
    console.log("🔐 Authorization header:", req.headers.authorization ? "Present" : "Missing")
    next()
  },
  protect,
  admin,
  upload.single("image"),
  (req, res) => {
    try {
      console.log("📁 File upload attempt")
      console.log("📋 Request body keys:", Object.keys(req.body))
      console.log("📋 Request file:", req.file ? "Present" : "Missing")

      if (!req.file) {
        console.log("❌ No file uploaded")
        return res.status(400).json({
          success: false,
          message: "No file uploaded",
        })
      }

      console.log("✅ File uploaded successfully:")
      console.log("📍 URL:", req.file.path)
      console.log("🆔 Public ID:", req.file.filename)

      res.json({
        success: true,
        message: "Image uploaded successfully",
        url: req.file.path,
        publicId: req.file.filename,
      })
    } catch (error) {
      console.error("❌ Upload error:", error)
      res.status(500).json({
        success: false,
        message: "Upload failed",
        error: error.message,
      })
    }
  },
)

// @desc    Upload multiple images
// @route   POST /api/upload/multiple
// @access  Private/Admin
router.post(
  "/multiple",
  (req, res, next) => {
    console.log("📤 Multiple upload request received")
    next()
  },
  protect,
  admin,
  upload.array("images", 5),
  (req, res) => {
    try {
      console.log("📁 Multiple file upload attempt")
      console.log("📋 Files count:", req.files ? req.files.length : 0)

      if (!req.files || req.files.length === 0) {
        console.log("❌ No files uploaded")
        return res.status(400).json({
          success: false,
          message: "No files uploaded",
        })
      }

      const files = req.files.map((file) => {
        console.log("✅ File processed:", file.originalname, "->", file.path)
        return {
          url: file.path,
          publicId: file.filename,
        }
      })

      console.log("✅ All files uploaded successfully")

      res.json({
        success: true,
        message: "Images uploaded successfully",
        files: files,
      })
    } catch (error) {
      console.error("❌ Multiple upload error:", error)
      res.status(500).json({
        success: false,
        message: "Upload failed",
        error: error.message,
      })
    }
  },
)

// @desc    Upload banner image (high-res, no transformation)
// @route   POST /api/upload/banner
// @access  Private/Admin
router.post(
  "/banner",
  uploadBanner.single("image"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }
    res.json({ url: req.file.path });
  })
);

// @desc    Delete image
// @route   DELETE /api/upload/:publicId
// @access  Private/Admin
router.delete("/:publicId", protect, admin, async (req, res) => {
  try {
    const { publicId } = req.params
    console.log("🗑️ Delete request for:", publicId)

    const result = await deleteFromCloudinary(publicId)

    res.json({
      success: true,
      message: "Image deleted successfully",
      result,
    })
  } catch (error) {
    console.error("❌ Delete error:", error)
    res.status(500).json({
      success: false,
      message: "Delete failed",
      error: error.message,
    })
  }
})

// Test route to check if upload route is working
router.get("/test", (req, res) => {
  res.json({
    message: "Upload routes are working",
    timestamp: new Date().toISOString(),
  })
})

export default router
