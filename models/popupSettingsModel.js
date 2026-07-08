import mongoose from "mongoose"

const popupSettingsSchema = mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, default: "Default Promo Popup" },

    // ── Enable / Pages / Platforms ──────────────────────────────────────────────
    isEnabled: { type: Boolean, default: true },
    showOnPages: { type: [String], default: ["home"] },
    platforms: { type: [String], default: ["web", "app"] }, // target platforms
    showLimit: { type: String, enum: ["once", "always"], default: "once" },

    // ── LEFT PANEL (green image side) ───────────────────────────────────────────
    // The big promotional image that covers the entire left column
    leftImageUrl: { type: String, default: "", trim: true },
    mobileImageUrl: { type: String, default: "", trim: true },

    // ── RIGHT PANEL — "Why Download" section ───────────────────────────────────
    sectionTitle: { type: String, default: "Why Download Our App?", trim: true },

    // 3 feature tiles (icon is fixed; only labels are editable)
    feature1Label: { type: String, default: "Exclusive\nApp Discounts", trim: true },
    feature2Label: { type: String, default: "Faster &\nSmooth Checkout", trim: true },
    feature3Label: { type: String, default: "Early Access to\nDeals & Offers", trim: true },

    // ── RIGHT PANEL — Discount box ─────────────────────────────────────────────
    discountTopText: { type: String, default: "DOWNLOAD NOW & GET", trim: true },
    discountValue: { type: String, default: "10% Off", trim: true },
    discountBottomText: { type: String, default: "On Your First App Order!", trim: true },
    discountNote: { type: String, default: "*T&C Apply", trim: true },

    // ── RIGHT PANEL — App Store links ──────────────────────────────────────────
    googlePlayLink: {
      type: String,
      default: "https://play.google.com/store/apps/details?id=ae.grabatoz1.grabatoz1",
      trim: true,
    },
    appStoreLink: {
      type: String,
      default: "https://apps.apple.com/pk/app/graba2z/id6742447046",
      trim: true,
    },

    // ── RIGHT PANEL — Bottom CTA button ────────────────────────────────────────
    continueButtonText: { type: String, default: "Continue to Website", trim: true },

    // ── Meta ────────────────────────────────────────────────────────────────────
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
)

const PopupSettings = mongoose.model("PopupSettings", popupSettingsSchema)

export default PopupSettings
