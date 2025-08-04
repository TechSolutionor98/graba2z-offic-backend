import mongoose from "mongoose"

const settingsSchema = mongoose.Schema(
  {
    siteName: {
      type: String,
      default: "Watch-Hub",
    },
    siteDescription: {
      type: String,
      default: "Premium watches for every occasion",
    },
    primaryColor: {
      type: String,
      default: "#3B82F6", // Blue
    },
    secondaryColor: {
      type: String,
      default: "#1F2937", // Gray
    },
    accentColor: {
      type: String,
      default: "#10B981", // Green
    },
    theme: {
      type: String,
      enum: ["blue", "green", "purple", "red", "orange", "custom"],
      default: "blue",
    },
    currency: {
      type: String,
      default: "AED",
    },
    taxRate: {
      type: Number,
      default: 0, // Percentage
    },
    shippingRate: {
      type: Number,
      default: 200,
    },
    freeShippingThreshold: {
      type: Number,
      default: 5000,
    },
    contactEmail: {
      type: String,
      default: "info@watchhub.com",
    },
    contactPhone: {
      type: String,
      default: "+1 (555) 123-4567",
    },
    socialMedia: {
      facebook: String,
      twitter: String,
      instagram: String,
      youtube: String,
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

const Settings = mongoose.model("Settings", settingsSchema)

export default Settings
