import mongoose from "mongoose"

const paymentMethodChargeSchema = mongoose.Schema(
  {
    paymentMethod: {
      type: String,
      required: true,
      unique: true,
      enum: ["cod", "card", "tabby", "tamara", "bank_transfer", "paypal"],
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

const PaymentMethodCharge = mongoose.model("PaymentMethodCharge", paymentMethodChargeSchema)

export default PaymentMethodCharge
