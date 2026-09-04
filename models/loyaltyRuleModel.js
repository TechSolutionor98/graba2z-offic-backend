import mongoose from "mongoose"

// Per-category earning rule. One row per category that departs from the global rate.
//
// Product-level rules live on the product document itself (loyaltyPointsMode and friends),
// because the storefront already has the product in hand when it renders "earn N points"
// and must not pay for an extra lookup. Categories are few and change rarely, so they sit
// here in their own collection instead of being bolted onto five separate category models.
const loyaltyRuleSchema = mongoose.Schema(
  {
    // Which category collection refId points at.
    //   category    -> Category      (the top-level "Categories" admin screen)
    //   subcategory -> SubCategory   (levels 1-4, all one collection)
    scope: {
      type: String,
      enum: ["category", "subcategory"],
      required: true,
    },
    refId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    // Kept for the admin list so it can name the category without a join.
    refName: {
      type: String,
      default: "",
    },

    // multiplier -> global rate x multiplier
    // fixed      -> exactly this many points per unit, whatever the price
    mode: {
      type: String,
      enum: ["multiplier", "fixed"],
      default: "multiplier",
    },
    multiplier: {
      type: Number,
      default: 1,
      min: 0,
    },
    fixedPoints: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Switch a rule off without deleting it; products then fall through to the global rate.
    // To stop a category earning at all, set mode "multiplier" with multiplier 0.
    isActive: {
      type: Boolean,
      default: true,
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true },
)

// One rule per category.
loyaltyRuleSchema.index({ scope: 1, refId: 1 }, { unique: true })

const LoyaltyRule = mongoose.model("LoyaltyRule", loyaltyRuleSchema)

export default LoyaltyRule
