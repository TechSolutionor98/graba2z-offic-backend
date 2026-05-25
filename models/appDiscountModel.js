import mongoose from "mongoose"

const appDiscountSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    appliesTo: {
      type: String,
      enum: ["all", "products"],
      default: "all",
    },
    products: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Product",
      },
    ],
    discountType: {
      type: String,
      enum: ["percentage", "fixed"],
      default: "percentage",
    },
    discountValue: {
      type: Number,
      required: true,
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
    priority: {
      type: Number,
      default: 0,
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
appDiscountSchema.index({ priority: -1, createdAt: -1 })

const AppDiscount = mongoose.model("AppDiscount", appDiscountSchema)

export default AppDiscount
