import mongoose from "mongoose"

// Singleton document holding the whole loyalty programme configuration.
//
// Every monetary value here is in AED, the base currency prices are stored in
// (see countryModel: other currencies are derived from AED via effectiveRate). So one
// set of rates covers every country the store sells in.
const loyaltySettingsSchema = mongoose.Schema(
  {
    // Only one settings document ever exists; this key enforces that.
    singletonKey: {
      type: String,
      default: "loyalty",
      unique: true,
      immutable: true,
    },

    isEnabled: {
      type: Boolean,
      default: false,
    },

    // What the points are called in the storefront. Admin-editable so the programme can
    // be renamed without a code change.
    pointsName: {
      type: String,
      default: "Grabian Points",
      trim: true,
    },
    pointsNameAr: {
      type: String,
      default: "نقاط جرابيان",
      trim: true,
    },
    // Singular form, for "1 Grabian Point".
    pointsNameSingular: {
      type: String,
      default: "Grabian Point",
      trim: true,
    },

    // ---- Earning ----
    // Points granted per 1 AED spent. "1 AED = 1 point" is earnPointsPerAed: 1.
    earnPointsPerAed: {
      type: Number,
      default: 1,
      min: 0,
    },
    // How a fractional point total is resolved.
    earnRounding: {
      type: String,
      enum: ["floor", "round", "ceil"],
      default: "floor",
    },
    // Points are earned on the item subtotal only; shipping and fees never earn.
    earnOnDiscountedPrice: {
      type: Boolean,
      default: true,
    },
    // The portion of an order paid for with points does not earn points back.
    earnOnRedeemedPortion: {
      type: Boolean,
      default: false,
    },

    // ---- Redemption ----
    // Points needed for 1 AED off. "1000 Grabian Points = 1 AED" is redeemPointsPerAed: 1000.
    redeemPointsPerAed: {
      type: Number,
      default: 1000,
      min: 1,
    },
    // A customer cannot redeem until they hold at least this many points.
    minPointsToRedeem: {
      type: Number,
      default: 1000,
      min: 0,
    },
    // Redemption is capped at this share of the eligible order amount, so points can never
    // drive a card payment to zero and break the gateway.
    maxRedeemPercentOfOrder: {
      type: Number,
      default: 50,
      min: 0,
      max: 100,
    },
    // Optional hard ceiling in points per single order (0 = no ceiling).
    maxPointsPerOrder: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Redeem in whole blocks of this size (1 = any amount). Keeps the slider tidy.
    redeemStep: {
      type: Number,
      default: 100,
      min: 1,
    },

    // ---- Awarding ----
    // Earned points sit pending until the order reaches this status. Chosen so a cancelled
    // or returned order never pays out.
    awardOnOrderStatus: {
      type: String,
      default: "Delivered",
    },
    // Order statuses that cancel a pending award and refund any points spent.
    cancelOnOrderStatuses: {
      type: [String],
      default: ["Cancelled", "Returned", "Deleted"],
    },
    // Days until confirmed points expire (0 = never).
    pointsExpiryDays: {
      type: Number,
      default: 0,
      min: 0,
    },

    // ---- Storefront display ----
    showOnProductPage: {
      type: Boolean,
      default: true,
    },
    showOnCart: {
      type: Boolean,
      default: true,
    },
    // Copy shown next to the balance in the customer's account.
    programmeTerms: {
      type: String,
      default: "",
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true },
)

// Read-or-create, so the storefront never has to cope with a missing configuration.
loyaltySettingsSchema.statics.getSingleton = async function () {
  const existing = await this.findOne({ singletonKey: "loyalty" })
  if (existing) return existing
  return this.create({ singletonKey: "loyalty" })
}

const LoyaltySettings = mongoose.model("LoyaltySettings", loyaltySettingsSchema)

export default LoyaltySettings
