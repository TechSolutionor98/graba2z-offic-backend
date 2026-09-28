import mongoose from "mongoose"

// A push notification written by an admin and sent to the mobile app.
//
// The row is the record of the campaign: what was said, who it went to, and how the
// send went. It also feeds the app's notification inbox, so a customer who missed the
// banner can still read it later.
const pushNotificationSchema = mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    body: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    // Arabic copy, sent to devices whose app language is Arabic when present.
    titleAr: {
      type: String,
      default: "",
      trim: true,
      maxlength: 120,
    },
    bodyAr: {
      type: String,
      default: "",
      trim: true,
      maxlength: 500,
    },
    imageUrl: {
      type: String,
      default: "",
      trim: true,
    },
    // Where a tap takes the customer. The app reads `screen` and `targetId`; `url` is
    // the web fallback and what the inbox link opens.
    action: {
      screen: {
        type: String,
        enum: ["home", "product", "category", "offer", "orders", "cart", "url", "none"],
        default: "none",
      },
      targetId: { type: String, default: "" },
      url: { type: String, default: "" },
    },
    audience: {
      type: {
        type: String,
        enum: ["all", "platform", "country", "users", "signed_in", "guests"],
        default: "all",
      },
      platform: { type: String, enum: ["", "android", "ios"], default: "" },
      country: { type: String, default: "" },
      users: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    },
    status: {
      type: String,
      enum: ["draft", "scheduled", "sending", "sent", "failed"],
      default: "draft",
      index: true,
    },
    scheduledAt: {
      type: Date,
      default: null,
      index: true,
    },
    sentAt: {
      type: Date,
      default: null,
    },
    stats: {
      targeted: { type: Number, default: 0 },
      sent: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
      invalidTokens: { type: Number, default: 0 },
    },
    error: {
      type: String,
      default: "",
    },
    // Shown in the app inbox until this date (null = always).
    expiresAt: {
      type: Date,
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true },
)

pushNotificationSchema.index({ status: 1, sentAt: -1 })

const PushNotification = mongoose.model("PushNotification", pushNotificationSchema)

export default PushNotification
