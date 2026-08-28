import mongoose from "mongoose"

const countrySchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    nameAr: {
      type: String,
      required: true,
      trim: true,
    },
    currencyCode: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    currencySymbol: {
      type: String,
      required: true,
      trim: true,
    },
    currencySymbolAr: {
      type: String,
      required: true,
      trim: true,
    },
    flagSvg: {
      type: String,
      default: "",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
    useManualRate: {
      type: Boolean,
      default: false,
    },
    manualExchangeRate: {
      type: Number,
      default: 1.0,
    },
    liveExchangeRate: {
      type: Number,
      default: 1.0,
    },
    lastRateUpdated: {
      type: Date,
      default: Date.now,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
    // Payment methods enabled for this country.
    // Empty / missing means "no country restriction configured" -> every method is allowed.
    paymentMethods: {
      type: [String],
      enum: ["card", "cod", "tamara", "tabby"],
      default: undefined,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  },
)

// Virtual property for effective exchange rate (AED to Local Currency)
countrySchema.virtual("effectiveRate").get(function () {
  if (this.isDefault) return 1.0
  if (this.useManualRate && this.manualExchangeRate > 0) {
    return this.manualExchangeRate
  }
  return this.liveExchangeRate > 0 ? this.liveExchangeRate : 1.0
})

countrySchema.set("toJSON", { virtuals: true })
countrySchema.set("toObject", { virtuals: true })

const Country = mongoose.model("Country", countrySchema)

export default Country
