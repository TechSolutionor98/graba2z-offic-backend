import mongoose from "mongoose"

const paymentMethodChargeSchema = mongoose.Schema(
  {
    paymentMethod: {
      type: String,
      required: true,
      enum: ["cod", "card", "tabby", "tamara", "bank_transfer", "paypal"],
    },
    // ISO-2 country code this configuration applies to.
    // "" means it is the default rule used by every country without its own.
    countryCode: {
      type: String,
      uppercase: true,
      trim: true,
      default: "",
    },
    description: {
      type: String,
      trim: true,
    },
    charges: [
      {
        name: {
          type: String,
          required: true,
        },
        amount: {
          type: Number,
          required: true,
          min: 0,
        },
        type: {
          type: String,
          enum: ["fixed", "percentage"],
          default: "fixed",
        },
      },
    ],
    isActive: {
      type: Boolean,
      default: true,
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

// One configuration per payment method per country. The legacy single-field
// unique index on paymentMethod is dropped by ensurePaymentChargeIndexes().
paymentMethodChargeSchema.index({ paymentMethod: 1, countryCode: 1 }, { unique: true })

const PaymentMethodCharge = mongoose.model("PaymentMethodCharge", paymentMethodChargeSchema)

export default PaymentMethodCharge
