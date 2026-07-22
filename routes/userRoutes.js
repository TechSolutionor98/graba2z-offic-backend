import express from "express"
import asyncHandler from "express-async-handler"
import User from "../models/userModel.js"
import generateToken from "../utils/generateToken.js"
import { protect } from "../middleware/authMiddleware.js"
import { sendVerificationEmail, sendAccountDeletionEmail, sendGuestAccountCreatedEmail } from "../utils/emailService.js"
import { sendResetPasswordEmail } from "../utils/emailService.js"
import crypto from "crypto"

const router = express.Router()

const normalizeRegistrationSource = (value) => {
  const normalized = String(value || "").trim().toLowerCase()
  return normalized === "app" ? "app" : "web"
}

const normalizeRegistrationPlatform = (value) => {
  const normalized = String(value || "").trim().toLowerCase()
  if (normalized === "android" || normalized === "ios") return normalized
  return "unknown"
}

// @desc    Register a new user
// @route   POST /api/users/register
// @access  Public
router.post(
  "/register",
  asyncHandler(async (req, res) => {
    const { name, email, password, registrationSource, registrationPlatform } = req.body

    const userExists = await User.findOne({ email })

    if (userExists) {
      res.status(400)
      throw new Error("User already exists")
    }

    const resolvedSource = normalizeRegistrationSource(
      registrationSource || req.headers["x-client-source"] || req.headers["x-order-source"],
    )
    const resolvedPlatform = normalizeRegistrationPlatform(
      registrationPlatform || req.headers["x-client-platform"] || req.headers["x-device-platform"],
    )

    const user = await User.create({
      name,
      email,
      password,
      isEmailVerified: false,
      registrationSource: resolvedSource,
      registrationPlatform: resolvedSource === "app" ? resolvedPlatform : null,
      appRegisteredAt: resolvedSource === "app" ? new Date() : null,
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
          registrationSource: user.registrationSource,
          registrationPlatform: user.registrationPlatform,
        })
      } catch (emailError) {
        console.error("Failed to send verification email:", emailError)
        res.status(201).json({
          message:
            "Registration successful! However, we couldn't send the verification email. Please try to resend it.",
          email: user.email,
          registrationSource: user.registrationSource,
          registrationPlatform: user.registrationPlatform,
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
        registrationSource: user.registrationSource,
        registrationPlatform: user.registrationPlatform,
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

// @desc    Register guest as user with auto-generated password
// @route   POST /api/users/register-guest
// @access  Public
router.post(
  "/register-guest",
  asyncHandler(async (req, res) => {
    const { name, email, phone, address } = req.body

    // Check if user already exists
    const userExists = await User.findOne({ email })

    if (userExists) {
      // User already exists, just return success (they can use forgot password if needed)
      console.log(`[register-guest] User already exists with email: ${email}`)
      res.json({
        message: "Account already exists",
        alreadyExists: true,
        email: email,
      })
      return
    }

    // Generate a random password (12 characters with letters, numbers, and special chars)
    const randomPassword = crypto.randomBytes(8).toString('base64').slice(0, 12)

    // Create the user with verified email (since they already verified via guest flow)
    const user = await User.create({
      name,
      email,
      password: randomPassword,
      isEmailVerified: true,
      phone: phone || "",
      address: address ? {
        street: address.address || "",
        city: address.city || "",
        state: address.state || "",
        zipCode: address.zipCode || "",
        country: address.country || "UAE",
      } : undefined,
    })

    if (user) {
      // Send email with credentials
      try {
        await sendGuestAccountCreatedEmail(email, name, randomPassword)
        console.log(`[register-guest] Account created and email sent to: ${email}`)
        res.status(201).json({
          message: "Account created successfully! Check your email for login credentials.",
          email: user.email,
          success: true,
        })
      } catch (emailError) {
        console.error("[register-guest] Failed to send credentials email:", emailError)
        // Still return success - account was created
        res.status(201).json({
          message: "Account created successfully! However, we couldn't send the credentials email.",
          email: user.email,
          success: true,
          emailFailed: true,
        })
      }
    } else {
      res.status(400)
      throw new Error("Failed to create user account")
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
        registrationSource: user.registrationSource,
        registrationPlatform: user.registrationPlatform,
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
    const clientBaseUrl = (process.env.CLIENT_URL || "http://localhost:5173").replace(/\/+$/, "");
    const resetPath = process.env.RESET_PASSWORD_PATH || "/ae-en/reset-password";
    const normalizedResetPath = resetPath.startsWith("/") ? resetPath : `/${resetPath}`;
    const resetLink = `${clientBaseUrl}${normalizedResetPath}?token=${encodeURIComponent(resetToken)}`;
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
      // Auto-migrate legacy address to addresses array if addresses array is empty
      if (
        (!user.addresses || user.addresses.length === 0) &&
        user.address &&
        (user.address.street || user.address.city)
      ) {
        const street = (user.address.street || "").trim()
        const city = (user.address.city || "").trim()
        const phone = (user.phone || "").trim()

        if (street && city) {
          const migratedAddress = {
            name: "Default Address",
            phone: phone || "0500000000",
            address: street,
            city: city,
            state: user.address.state || "",
            zipCode: user.address.zipCode || "",
            isDefault: true,
          }
          user.addresses.push(migratedAddress)
          await user.save()
        }
      }

      res.json({
        _id: user._id,
        name: user.name,
        email: user.email,
        isAdmin: user.isAdmin,
        isEmailVerified: user.isEmailVerified,
        phone: user.phone,
        address: user.address,
        addresses: user.addresses || [],
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
        if (!req.body.currentPassword) {
          res.status(400)
          throw new Error("Please provide your current password to change it")
        }
        const isMatch = await user.matchPassword(req.body.currentPassword)
        if (!isMatch) {
          res.status(400)
          throw new Error("Incorrect current password")
        }
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
        addresses: updatedUser.addresses || [],
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

// @desc    Get user saved addresses
// @route   GET /api/users/addresses
// @access  Private
router.get(
  "/addresses",
  protect,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id)
    if (user) {
      // Auto-migrate legacy address to addresses array if addresses array is empty
      if (
        (!user.addresses || user.addresses.length === 0) &&
        user.address &&
        (user.address.street || user.address.city)
      ) {
        const street = (user.address.street || "").trim()
        const city = (user.address.city || "").trim()
        const phone = (user.phone || "").trim()

        if (street && city) {
          const migratedAddress = {
            name: "Default Address",
            phone: phone || "0500000000",
            address: street,
            city: city,
            state: user.address.state || "",
            zipCode: user.address.zipCode || "",
            isDefault: true,
          }
          user.addresses.push(migratedAddress)
          await user.save()
        }
      }
      res.json(user.addresses || [])
    } else {
      res.status(404)
      throw new Error("User not found")
    }
  }),
)

// @desc    Add a new address
// @route   POST /api/users/addresses
// @access  Private
router.post(
  "/addresses",
  protect,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id)
    if (user) {
      const { name, phone, email, address, city, state, zipCode, isDefault } = req.body

      if (!name || !phone || !address || !city) {
        res.status(400)
        throw new Error("Please provide name, phone, address, and city")
      }

      if (isDefault) {
        user.addresses.forEach((addr) => {
          addr.isDefault = false
        })
      }

      const newAddress = {
        name,
        phone,
        email,
        address,
        city,
        state,
        zipCode,
        isDefault: isDefault || user.addresses.length === 0,
      }

      user.addresses.push(newAddress)
      await user.save()
      res.status(201).json(user.addresses)
    } else {
      res.status(404)
      throw new Error("User not found")
    }
  }),
)

// @desc    Update a saved address
// @route   PUT /api/users/addresses/:addressId
// @access  Private
router.put(
  "/addresses/:addressId",
  protect,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id)
    if (user) {
      const address = user.addresses.id(req.params.addressId)
      if (address) {
        const { name, phone, email, address: addressText, city, state, zipCode, isDefault } = req.body

        address.name = name !== undefined ? name : address.name
        address.phone = phone !== undefined ? phone : address.phone
        address.email = email !== undefined ? email : address.email
        address.address = addressText !== undefined ? addressText : address.address
        address.city = city !== undefined ? city : address.city
        address.state = state !== undefined ? state : address.state
        address.zipCode = zipCode !== undefined ? zipCode : address.zipCode

        if (isDefault) {
          user.addresses.forEach((addr) => {
            if (addr._id.toString() !== req.params.addressId) {
              addr.isDefault = false
            }
          })
          address.isDefault = true
        }

        await user.save()
        res.json(user.addresses)
      } else {
        res.status(404)
        throw new Error("Address not found")
      }
    } else {
      res.status(404)
      throw new Error("User not found")
    }
  }),
)

// @desc    Delete a saved address
// @route   DELETE /api/users/addresses/:addressId
// @access  Private
router.delete(
  "/addresses/:addressId",
  protect,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id)
    if (user) {
      user.addresses = user.addresses.filter((addr) => addr._id.toString() !== req.params.addressId)

      if (user.addresses.length > 0 && !user.addresses.some((addr) => addr.isDefault)) {
        user.addresses[0].isDefault = true
      }

      await user.save()
      res.json(user.addresses)
    } else {
      res.status(404)
      throw new Error("User not found")
    }
  }),
)

// @desc    Set address as default
// @route   PUT /api/users/addresses/:addressId/default
// @access  Private
router.put(
  "/addresses/:addressId/default",
  protect,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id)
    if (user) {
      let addressFound = false
      user.addresses.forEach((addr) => {
        if (addr._id.toString() === req.params.addressId) {
          addr.isDefault = true
          addressFound = true
        } else {
          addr.isDefault = false
        }
      })

      if (addressFound) {
        await user.save()
        res.json(user.addresses)
      } else {
        res.status(404)
        throw new Error("Address not found")
      }
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

// @desc    Request account deletion - sends 6-digit code via email
// @route   POST /api/users/request-account-deletion
// @access  Private
router.post(
  "/request-account-deletion",
  protect,
  asyncHandler(async (req, res) => {
    console.log("[Account Deletion] Request received for user:", req.user._id)
    const user = await User.findById(req.user._id)

    if (!user) {
      res.status(404)
      throw new Error("User not found")
    }

    console.log("[Account Deletion] User found:", user.email)

    // Generate deletion verification code
    const deletionCode = user.generateDeleteAccountCode()
    console.log("[Account Deletion] Generated code:", deletionCode)
    await user.save()
    console.log("[Account Deletion] User saved with code")

    // Send deletion verification email
    try {
      console.log("[Account Deletion] Attempting to send email to:", user.email)
      await sendAccountDeletionEmail(user.email, user.name, deletionCode)
      console.log("[Account Deletion] Email sent successfully")
      res.json({
        message: "Account deletion verification code sent to your email. Please check your inbox.",
      })
    } catch (emailError) {
      console.error("[Account Deletion] Failed to send email:", emailError)
      console.error("[Account Deletion] Error stack:", emailError.stack)
      res.status(500)
      throw new Error("Failed to send verification email. Please try again later.")
    }
  }),
)

// @desc    Verify deletion code and delete account
// @route   POST /api/users/verify-account-deletion
// @access  Private
router.post(
  "/verify-account-deletion",
  protect,
  asyncHandler(async (req, res) => {
    const { code } = req.body

    if (!code) {
      res.status(400)
      throw new Error("Verification code is required")
    }

    const user = await User.findById(req.user._id)

    if (!user) {
      res.status(404)
      throw new Error("User not found")
    }

    // Verify the deletion code
    if (user.verifyDeleteAccountCode(code)) {
      // Code is valid, delete the user account
      await User.findByIdAndDelete(user._id)
      
      res.json({
        message: "Your account has been successfully deleted. We're sorry to see you go.",
      })
    } else {
      res.status(400)
      throw new Error("Invalid or expired verification code. Please request a new code.")
    }
  }),
)

export default router
