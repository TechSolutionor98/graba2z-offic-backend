import mongoose from "mongoose"
import bcrypt from "bcryptjs"

const userSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
    },
    password: {
      type: String,
      required: true,
    },
    isAdmin: {
      type: Boolean,
      required: true,
      default: false,
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    emailVerificationCode: {
      type: String,
    },
    emailVerificationExpires: {
      type: Date,
    },
    phone: {
      type: String,
    },
    address: {
      street: String,
      city: String,
      state: String,
      zipCode: String,
      country: String,
    },
    dateOfBirth: {
      type: Date,
    },
    gender: {
      type: String,
      enum: ["male", "female", "other"],
    },
    preferences: {
      newsletter: {
        type: Boolean,
        default: true,
      },
      notifications: {
        type: Boolean,
        default: true,
      },
    },
    wishlist: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Product",
      },
    ],
    resetPasswordToken: String,
    resetPasswordExpires: Date,
    deleteAccountCode: String,
    deleteAccountExpires: Date,
  },
  {
    timestamps: true,
  },
)

// Method to match password
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password)
}

// Method to generate email verification code - THIS IS THE MISSING METHOD
userSchema.methods.generateEmailVerificationCode = function () {
  // Generate 6-digit code
  const code = Math.floor(100000 + Math.random() * 900000).toString()

  // Set code and expiration (10 minutes)
  this.emailVerificationCode = code
  this.emailVerificationExpires = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes

  return code
}

// Method to verify email code
userSchema.methods.verifyEmailCode = function (code) {
  if (!this.emailVerificationCode || !this.emailVerificationExpires) {
    return false
  }

  // Check if code has expired
  if (new Date() > this.emailVerificationExpires) {
    return false
  }

  // Check if code matches
  return this.emailVerificationCode === code
}

// Method to generate password reset token
userSchema.methods.generatePasswordResetToken = function () {
  // Generate random token
  const resetToken = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)

  // Hash token and set to resetPasswordToken field
  this.resetPasswordToken = resetToken
  this.resetPasswordExpires = new Date(Date.now() + 30 * 60 * 1000) // 30 minutes

  return resetToken
}

// Method to generate account deletion code
userSchema.methods.generateDeleteAccountCode = function () {
  // Generate 6-digit code
  const code = Math.floor(100000 + Math.random() * 900000).toString()

  // Set code and expiration (10 minutes)
  this.deleteAccountCode = code
  this.deleteAccountExpires = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes

  return code
}

// Method to verify account deletion code
userSchema.methods.verifyDeleteAccountCode = function (code) {
  if (!this.deleteAccountCode || !this.deleteAccountExpires) {
    return false
  }

  // Check if code has expired
  if (new Date() > this.deleteAccountExpires) {
    return false
  }

  // Check if code matches
  return this.deleteAccountCode === code
}

// Encrypt password before saving
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) {
    next()
  }

  const salt = await bcrypt.genSalt(10)
  this.password = await bcrypt.hash(this.password, salt)
})

const User = mongoose.model("User", userSchema)

export default User
