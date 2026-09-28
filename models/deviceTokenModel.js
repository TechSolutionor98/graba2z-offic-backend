import mongoose from "mongoose"

// One row per app install that can receive push notifications.
//
// The token is Firebase Cloud Messaging's address for that install. It is not tied to a
// login: a visitor who never signs in still gets marketing pushes, and a signed-in user
// is attached when the app registers the token with a bearer token (or re-registers after
// login). Tokens rotate and die; a delivery attempt that Firebase reports as
// "unregistered" marks the row inactive so the next campaign does not count it.
const deviceTokenSchema = mongoose.Schema(
  {
    token: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    platform: {
      type: String,
      enum: ["android", "ios", "web", "unknown"],
      default: "unknown",
      index: true,
    },
    // Store the app was opened in, so a campaign can target one country.
    country: {
      type: String,
      default: "",
      uppercase: true,
      trim: true,
    },
    language: {
      type: String,
      default: "en",
      trim: true,
    },
    appVersion: {
      type: String,
      default: "",
      trim: true,
    },
    deviceName: {
      type: String,
      default: "",
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    lastSeenAt: {
      type: Date,
      default: Date.now,
    },
    // Why it was switched off: "unregistered", "invalid", "user_logout".
    inactiveReason: {
      type: String,
      default: "",
    },
  },
  { timestamps: true },
)

deviceTokenSchema.index({ isActive: 1, platform: 1, country: 1 })

const DeviceToken = mongoose.model("DeviceToken", deviceTokenSchema)

export default DeviceToken
