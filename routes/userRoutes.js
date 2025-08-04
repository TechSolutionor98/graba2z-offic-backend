import express from "express"
import asyncHandler from "express-async-handler"
import User from "../models/userModel.js"
import generateToken from "../utils/generateToken.js"
import { protect } from "../middleware/authMiddleware.js"
import { sendVerificationEmail } from "../utils/emailService.js"
import { sendResetPasswordEmail } from "../utils/emailService.js"

const router = express.Router()

// @desc    Register a new user
// @route   POST /api/users/register
// @access  Public
router.post(
  "/register",
  asyncHandler(async (req, res) => {
    const { name, email, password } = req.body

    const userExists = await User.findOne({ email })

    if (userExists) {
      res.status(400)
      throw new Error("User already exists")
    }

    const user = await User.create({
      name,
      email,
      password,
      isEmailVerified: false,
    })

    if (user) {
      // Generate verification code
      const verificationCode = user.generateEmailVerificationCode()
      await user.save()

      // Send verification email
      try {
        await sendVerificationEmail(email, name, verificationCode)
        res.status(201).json({
          message: "Registration successful! Please check your email for verification code.",
          email: user.email,
        })
      } catch (emailError) {
        console.error("Failed to send verification email:", emailError)
        res.status(201).json({
          message:
            "Registration successful! However, we couldn't send the verification email. Please try to resend it.",
          email: user.email,
        })
      }
    } else {
      res.status(400)
      throw new Error("Invalid user data")
    }
  }),
)

// @desc    Verify email with code
// @route   POST /api/users/verify-email
// @access  Public
router.post(
  "/verify-email",
  asyncHandler(async (req, res) => {
    const { email, code } = req.body

    const user = await User.findOne({ email })

    if (!user) {
      res.status(404)
      throw new Error("User not found")
    }

    if (user.isEmailVerified) {
      res.status(400)
      throw new Error("Email is already verified")
    }

    if (user.verifyEmailCode(code)) {
      user.isEmailVerified = true
      user.emailVerificationCode = undefined
      user.emailVerificationExpires = undefined
      await user.save()

      res.json({
        _id: user._id,
        name: user.name,
        email: user.email,
        isAdmin: user.isAdmin,
        isEmailVerified: user.isEmailVerified,
        token: generateToken(user._id),
      })
    } else {
      res.status(400)
      throw new Error("Invalid or expired verification code")
    }
  }),
)

// @desc    Resend verification email
// @route   POST /api/users/resend-verification
// @access  Public
router.post(
  "/resend-verification",
  asyncHandler(async (req, res) => {
    const { email } = req.body

    const user = await User.findOne({ email })

    if (!user) {
      res.status(404)
      throw new Error("User not found")
    }

    if (user.isEmailVerified) {
      res.status(400)
      throw new Error("Email is already verified")
    }

    // Generate new verification code
    const verificationCode = user.generateEmailVerificationCode()
    await user.save()

    // Send verification email
    try {
      await sendVerificationEmail(email, user.name, verificationCode)
      res.json({
        message: "Verification code sent successfully!",
      })
    } catch (emailError) {
      console.error("Failed to send verification email:", emailError)
      res.status(500)
      throw new Error("Failed to send verification email")
    }
  }),
)

// @desc    Auth user & get token
// @route   POST /api/users/login
// @access  Public
router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password } = req.body

    const user = await User.findOne({ email })

    if (user && (await user.matchPassword(password))) {
      if (!user.isEmailVerified) {
        res.status(401)
        throw new Error("Please verify your email before logging in")
      }

      res.json({
        _id: user._id,
        name: user.name,
        email: user.email,
        isAdmin: user.isAdmin,
        isEmailVerified: user.isEmailVerified,
        token: generateToken(user._id),
      })
    } else {
      res.status(401)
      throw new Error("Invalid email or password")
    }
  }),
)

// @desc    Forgot password - send reset link
// @route   POST /api/users/forgot-password
// @access  Public
router.post(
  "/forgot-password",
  asyncHandler(async (req, res) => {
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) {
      // Always respond with success to prevent email enumeration
      return res.json({ message: "If this email is registered, a reset link has been sent." });
    }
    const resetToken = user.generatePasswordResetToken();
    // Set expiry to 60 minutes
    user.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000);
    await user.save();
    const resetLink = `${process.env.CLIENT_URL || "http://localhost:5173"}/reset-password?token=${resetToken}`;
    await sendResetPasswordEmail(user.email, user.name, resetLink);
    res.json({ message: "If this email is registered, a reset link has been sent." });
  })
);

// @desc    Reset password
// @route   POST /api/users/reset-password
// @access  Public
router.post(
  "/reset-password",
  asyncHandler(async (req, res) => {
    const { token, password } = req.body;
    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: new Date() },
    });
    if (!user) {
      res.status(400);
      throw new Error("Invalid or expired reset token");
    }
    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();
    res.json({ message: "Password has been reset successfully." });
  })
);

// @desc    Get user profile
// @route   GET /api/users/profile
// @access  Private
router.get(
  "/profile",
  protect,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id)

    if (user) {
      res.json({
        _id: user._id,
        name: user.name,
        email: user.email,
        isAdmin: user.isAdmin,
        isEmailVerified: user.isEmailVerified,
        phone: user.phone,
        address: user.address,
        dateOfBirth: user.dateOfBirth,
        gender: user.gender,
        preferences: user.preferences,
        wishlist: user.wishlist,
      })
    } else {
      res.status(404)
      throw new Error("User not found")
    }
  }),
)

// @desc    Update user profile
// @route   PUT /api/users/profile
// @access  Private
router.put(
  "/profile",
  protect,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id)

    if (user) {
      user.name = req.body.name || user.name
      user.email = req.body.email || user.email
      user.phone = req.body.phone || user.phone
      user.address = req.body.address || user.address
      user.dateOfBirth = req.body.dateOfBirth || user.dateOfBirth
      user.gender = req.body.gender || user.gender
      user.preferences = req.body.preferences || user.preferences

      if (req.body.password) {
        user.password = req.body.password
      }

      const updatedUser = await user.save()

      res.json({
        _id: updatedUser._id,
        name: updatedUser.name,
        email: updatedUser.email,
        isAdmin: updatedUser.isAdmin,
        isEmailVerified: updatedUser.isEmailVerified,
        phone: updatedUser.phone,
        address: updatedUser.address,
        dateOfBirth: updatedUser.dateOfBirth,
        gender: updatedUser.gender,
        preferences: updatedUser.preferences,
        token: generateToken(updatedUser._id),
      })
    } else {
      res.status(404)
      throw new Error("User not found")
    }
  }),
)

// @desc    Get all users (Admin only)
// @route   GET /api/users
// @access  Private/Admin
router.get(
  "/",
  protect,
  asyncHandler(async (req, res) => {
    const users = await User.find({}).select("-password")
    res.json(users)
  }),
)

// @desc    Delete user (Admin only)
// @route   DELETE /api/users/:id
// @access  Private/Admin
router.delete(
  "/:id",
  protect,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id)

    if (user) {
      await User.findByIdAndDelete(req.params.id)
      res.json({ message: "User removed" })
    } else {
      res.status(404)
      throw new Error("User not found")
    }
  }),
)

// @desc    Get user by ID (Admin only)
// @route   GET /api/users/:id
// @access  Private/Admin
router.get(
  "/:id",
  protect,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id).select("-password")

    if (user) {
      res.json(user)
    } else {
      res.status(404)
      throw new Error("User not found")
    }
  }),
)

// @desc    Update user (Admin only)
// @route   PUT /api/users/:id
// @access  Private/Admin
router.put(
  "/:id",
  protect,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id)

    if (user) {
      user.name = req.body.name || user.name
      user.email = req.body.email || user.email
      user.isAdmin = Boolean(req.body.isAdmin)

      const updatedUser = await user.save()

      res.json({
        _id: updatedUser._id,
        name: updatedUser.name,
        email: updatedUser.email,
        isAdmin: updatedUser.isAdmin,
        isEmailVerified: updatedUser.isEmailVerified,
      })
    } else {
      res.status(404)
      throw new Error("User not found")
    }
  }),
)

export default router
