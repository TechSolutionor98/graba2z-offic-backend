import mongoose from "mongoose"

// Singleton document holding the whole referral programme configuration.
//
// Every monetary value here is in AED, the base currency prices are stored in (see
// countryModel: other currencies are derived from AED via effectiveRate). So one set of
// values covers every country the store sells in.
//
// The programme has two sides and they are configured independently:
//   - the *referee*  (the invited friend) is rewarded the moment they sign up
//   - the *referrer* (the person who invited them) is rewarded only once that friend's
//     order has actually been delivered
const referralSettingsSchema = mongoose.Schema(
  {
    // Only one settings document ever exists; this key enforces that.
    singletonKey: {
      type: String,
      default: "referral",
      unique: true,
      immutable: true,
    },

    isEnabled: {
      type: Boolean,
      default: false,
    },

    // What the programme is called in the storefront. Admin-editable so it can be
    // renamed without a code change.
    programmeName: {
      type: String,
      default: "Refer a Friend",
      trim: true,
    },
    programmeNameAr: {
      type: String,
      default: "أدعُ صديقاً",
      trim: true,
    },

    // ---- The invited friend's reward (granted at signup) ----
    refereeDiscountType: {
      type: String,
      enum: ["percentage", "fixed"],
      default: "percentage",
    },
    // 20 means "20% off" for percentage, or "20 AED off" for fixed.
    refereeDiscountValue: {
      type: Number,
      default: 20,
      min: 0,
    },
    // Ceiling on a percentage discount, in AED (0 = no ceiling). Stops a 20% reward
    // taking hundreds off a large order.
    refereeMaxDiscountAed: {
      type: Number,
      default: 0,
      min: 0,
    },
    // The reward cannot be used on an order smaller than this.
    refereeMinOrderAed: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Days until an unused reward expires (0 = never).
    refereeExpiryDays: {
      type: Number,
      default: 0,
      min: 0,
    },
    // When true the reward may only be spent on the friend's very first order, which is
    // the whole point of a welcome discount.
    refereeFirstOrderOnly: {
      type: Boolean,
      default: true,
    },

    // ---- The referrer's reward (granted when the referral qualifies) ----
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

    // ---- Qualification ----
    // A referral stays pending until an order placed by the invited friend reaches this
    // status. Chosen so an order that is never delivered never pays the referrer.
    qualifyOnOrderStatus: {
      type: String,
      default: "Delivered",
    },
    // Statuses that undo a qualification, giving back an unspent referrer reward.
    cancelOnOrderStatuses: {
      type: [String],
      default: ["Cancelled", "Returned", "Deleted"],
    },
    // The friend's order must be worth at least this much (AED, after discounts) for the
    // referral to count. Stops a 5 AED order earning a full reward.
    qualifyMinOrderAed: {
      type: Number,
      default: 0,
      min: 0,
    },

    // ---- Limits ----
    // How many referrals one person may be rewarded for (0 = unlimited). Further signups
    // are still recorded and still reward the friend; they simply stop paying out.
    maxQualifiedReferralsPerUser: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Only reward a referral once the invited friend has verified their email address.
    requireEmailVerified: {
      type: Boolean,
      default: true,
    },

    // ---- Storefront display ----
    showInProfile: {
      type: Boolean,
      default: true,
    },
    // Prefilled text for the share sheet. {{link}} is replaced with the referral link.
    shareMessage: {
      type: String,
      default: "Shop at Grab A2Z and get a discount on your first order with my link: {{link}}",
    },
    // Copy shown under the programme in the customer's account.
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
referralSettingsSchema.statics.getSingleton = async function () {
  const existing = await this.findOne({ singletonKey: "referral" })
  if (existing) return existing
  return this.create({ singletonKey: "referral" })
}

const ReferralSettings = mongoose.model("ReferralSettings", referralSettingsSchema)

export default ReferralSettings
