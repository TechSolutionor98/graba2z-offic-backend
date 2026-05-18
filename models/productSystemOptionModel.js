import mongoose from "mongoose"

const productSystemOptionSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    optionType: {
      type: String,
      required: true,
      enum: ["series", "make", "manufacturer", "soldBy"],
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

productSystemOptionSchema.index({ optionType: 1, name: 1 }, { unique: true })

const ProductSystemOption = mongoose.model("ProductSystemOption", productSystemOptionSchema)

export default ProductSystemOption
