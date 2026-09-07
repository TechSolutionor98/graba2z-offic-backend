import mongoose from "mongoose"

// One band of a tiered delivery method: "baskets between this much and that much cost
// this much to deliver". A method with no rules falls back to its own charge and
// min/max as a single band -- see utils/deliveryCharge.js, which is the one place that
// decides what a method costs.
const deliveryRuleSchema = mongoose.Schema(
  {
    minOrderAmount: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    // null means no ceiling. Past the highest ceiling on a method, delivery is free.
    maxOrderAmount: {
      type: Number,
      default: null,
    },
    charge: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { _id: false },
)

const deliveryChargeSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    charge: {
      type: Number,
      required: true,
      min: 0,
    },
    minOrderAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    maxOrderAmount: {
      type: Number,
      default: null,
    },
    // Optional bands. When present they replace the single charge/min/max above, so one
    // method can price several basket sizes differently.
    rules: {
      type: [deliveryRuleSchema],
      default: [],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    applicableAreas: [
      {
        type: String,
        trim: true,
      },
    ],
    country: {
      type: String,
      default: "United Arab Emirates",
      trim: true,
    },
    countryCode: {
      type: String,
      default: "AE",
      trim: true,
    },
    isInternational: {
      type: Boolean,
      default: false,
    },
    deliveryTime: {
      type: String,
      default: "1-2 business days",
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  },
)

const DeliveryCharge = mongoose.model("DeliveryCharge", deliveryChargeSchema)

export default DeliveryCharge
