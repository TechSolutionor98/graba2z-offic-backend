import mongoose from "mongoose"

const referralTypeSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    color: {
      type: String,
      default: "#3b82f6", // Blue
      trim: true,
    },
    badgeText: {
      type: String,
      default: "",
      trim: true,
    },

    // ---- Referee Reward (Granted to invited friend on signup) ----
    refereeDiscountType: {
      type: String,
      enum: ["percentage", "fixed"],
      default: "percentage",
    },
    refereeDiscountValue: {
      type: Number,
      default: 20,
      min: 0,
    },
    refereeMaxDiscountAed: {
      type: Number,
      default: 0,
      min: 0,
    },
    refereeMinOrderAed: {
      type: Number,
      default: 0,
      min: 0,
    },
    refereeExpiryDays: {
      type: Number,
      default: 0,
      min: 0,
    },
    refereeFirstOrderOnly: {
      type: Boolean,
      default: true,
    },

    // ---- Referrer Reward (Granted when referral qualifies) ----
    referrerDiscountType: {
      type: String,
      enum: ["percentage", "fixed"],
      default: "percentage",
    },
    referrerDiscountValue: {
      type: Number,
      default: 10,
      min: 0,
    },
    referrerMaxDiscountAed: {
      type: Number,
      default: 0,
      min: 0,
    },
    referrerMinOrderAed: {
      type: Number,
      default: 0,
      min: 0,
    },
    referrerExpiryDays: {
      type: Number,
      default: 0,
      min: 0,
    },

    // ---- Qualification & Limits ----
    qualifyMinOrderAed: {
      type: Number,
      default: 0,
      min: 0,
    },
    maxQualifiedReferralsPerUser: {
      type: Number,
      default: 0,
      min: 0,
    },

    isDefault: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true },
)

referralTypeSchema.index({ isDefault: 1 })
referralTypeSchema.index({ isActive: 1 })

const ReferralType = mongoose.model("ReferralType", referralTypeSchema)

export default ReferralType
