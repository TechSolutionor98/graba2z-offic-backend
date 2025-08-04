import express from "express"
import asyncHandler from "express-async-handler"
import Settings from "../models/settingsModel.js"
import User from "../models/userModel.js"
import bcrypt from "bcryptjs"
import { protect, admin } from "../middleware/authMiddleware.js"

const router = express.Router()

// @desc    Get settings
// @route   GET /api/settings
// @access  Public
router.get(
  "/",
  asyncHandler(async (req, res) => {
    let settings = await Settings.findOne({})

    if (!settings) {
      // Create default settings if none exist
      settings = new Settings({})
      await settings.save()
    }

    res.json(settings)
  }),
)

// @desc    Update settings
// @route   PUT /api/settings
// @access  Private/Admin
router.put(
  "/",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    let settings = await Settings.findOne({})

    if (!settings) {
      settings = new Settings({})
    }

    // Update settings fields
    Object.keys(req.body).forEach((key) => {
      if (key !== "updatedBy") {
        settings[key] = req.body[key]
      }
    })

    settings.updatedBy = req.user._id
    const updatedSettings = await settings.save()

    res.json(updatedSettings)
  }),
)

// @desc    Change admin password
// @route   PUT /api/settings/password
// @access  Private/Admin
router.put(
  "/password",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body

    const user = await User.findById(req.user._id)

    if (user && (await user.matchPassword(currentPassword))) {
      // Hash new password
      const salt = await bcrypt.genSalt(10)
      user.password = await bcrypt.hash(newPassword, salt)

      await user.save()

      res.json({ message: "Password updated successfully" })
    } else {
      res.status(400)
      throw new Error("Current password is incorrect")
    }
  }),
)

export default router
