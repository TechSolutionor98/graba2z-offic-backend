import mongoose from "mongoose"

const taxSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    rate: {
      type: Number,
      required: true,
      min: 0,
    },
    type: {
      type: String,
      required: true,
      enum: ["percentage", "fixed"],
      default: "percentage",
    },
    description: {
      type: String,
      trim: true,
    },
    // ISO-2 country code this tax applies to.
    // "" means it is the default tax used by every country without its own.
    countryCode: {
      type: String,
      uppercase: true,
      trim: true,
      default: "",
    },
    isActive: {
      type: Boolean,
      default: true,
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

const Tax = mongoose.model("Tax", taxSchema)

export default Tax
