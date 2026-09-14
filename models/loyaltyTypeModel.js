import mongoose from "mongoose"

const loyaltyTypeSchema = mongoose.Schema(
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
      default: "#10b981", // Emerald green
      trim: true,
    },
    badgeText: {
      type: String,
      default: "",
      trim: true,
    },

    // ---- Earning Multiplier / Rates ----
    // 1.0 = standard rate (1x)
    // 1.5 = 1.5x points (e.g., Gold)
    // 2.0 = 2x points (e.g., Platinum)
    earnMultiplier: {
      type: Number,
      default: 1,
      min: 0,
    },
    // Optional override: if set > 0, gives a fixed points-per-AED instead of multiplier
    customEarnPointsPerAed: {
      type: Number,
      default: null,
    },

    // ---- Optional Redemption Perks ----
    // Optional override for points needed per 1 AED off (null inherits global rate)
    redeemPointsPerAed: {
      type: Number,
      default: null,
    },
    // Optional override for min points needed to redeem (null inherits global)
    minPointsToRedeem: {
      type: Number,
      default: null,
    },
    // Optional override for max % of order redeemable with points (null inherits global)
    maxRedeemPercentOfOrder: {
      type: Number,
      default: null,
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

loyaltyTypeSchema.index({ isDefault: 1 })
loyaltyTypeSchema.index({ isActive: 1 })

const LoyaltyType = mongoose.model("LoyaltyType", loyaltyTypeSchema)

export default LoyaltyType
