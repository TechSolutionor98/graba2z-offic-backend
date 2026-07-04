import mongoose from "mongoose"

const appDiscountRuleSchema = mongoose.Schema({
  minCartAmount: {
    type: Number,
    required: true,
    min: 0,
  },
  maxCartAmount: {
    type: Number,
    required: true,
    min: 0,
  },
  discountType: {
    type: String,
    enum: ["percentage", "fixed"],
    required: true,
    default: "percentage",
  },
  discountValue: {
    type: Number,
    required: true,
    min: 0,
  },
})

const appDiscountSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    appliesTo: {
      type: String,
      enum: ["all", "products", "categories", "subcategories"],
      default: "all",
    },
    products: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Product",
      },
    ],
    categories: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Category",
      },
    ],
    subcategories: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "SubCategory",
      },
    ],
    // For backwards compatibility:
    discountType: {
      type: String,
      enum: ["percentage", "fixed"],
      default: "percentage",
    },
    discountValue: {
      type: Number,
      default: 0,
      min: 0,
    },
    minOrderAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    maxDiscountAmount: {
      type: Number,
      default: null,
      min: 0,
    },
    userEligibility: {
      type: String,
      enum: ["all", "new"],
      default: "all",
    },
    usageLimitType: {
      type: String,
      enum: ["one-time", "unlimited"],
      default: "one-time",
    },
    rules: {
      type: [appDiscountRuleSchema],
      default: [],
    },
    onlyNewAppUsers: {
      type: Boolean,
      default: true,
    },
    singleUsePerUser: {
      type: Boolean,
      default: true,
    },
    startsAt: {
      type: Date,
      required: true,
    },
    endsAt: {
      type: Date,
      required: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  {
    timestamps: true,
  },
)

appDiscountSchema.index({ isActive: 1, startsAt: 1, endsAt: 1 })
appDiscountSchema.index({ createdAt: -1 })

const AppDiscount = mongoose.model("AppDiscount", appDiscountSchema)

export default AppDiscount
