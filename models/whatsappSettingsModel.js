import mongoose from "mongoose"

// One row. Everything the shop owner pastes on Admin -> WhatsApp -> Connection.
//
// The credentials live here rather than in .env because the owner is expected to
// rotate them from the admin screen when Meta reissues a token, and a .env change
// needs a redeploy. The access token is never read back out to the browser --
// `toSafeJSON` below is the only shape that leaves the server.

const templateSchema = mongoose.Schema(
  {
    // The template's name exactly as it was approved in the Meta dashboard.
    name: { type: String, default: "", trim: true },
    // The language the approved template was written in, e.g. "en" or "en_US".
    language: { type: String, default: "en", trim: true },
  },
  { _id: false },
)

const whatsappSettingsSchema = mongoose.Schema(
  {
    // ---- Credentials from Meta (WhatsApp Business Platform / Cloud API) ----
    // Business Settings -> WhatsApp Accounts -> the number -> Phone number ID.
    phoneNumberId: { type: String, default: "", trim: true },
    // The WhatsApp Business Account the number sits under. Recorded for support;
    // sending does not need it.
    wabaId: { type: String, default: "", trim: true },
    // A permanent System User token with whatsapp_business_messaging.
    accessToken: { type: String, default: "" },
    // App Dashboard -> Settings -> Basic -> App Secret. Used to verify that an
    // incoming webhook really came from Meta.
    appSecret: { type: String, default: "" },
    // A string the owner invents and types into Meta's webhook form. Meta echoes
    // it back once, during the subscription handshake.
    verifyToken: { type: String, default: "" },
    // Graph API version to call. Kept here so a version bump is a settings change
    // rather than a deploy.
    apiVersion: { type: String, default: "v21.0", trim: true },
    // Numbers customers type locally ("0501234567") carry no country code. This is
    // the code they are assumed to belong to. The shop is UAE-based by default.
    defaultCountryCode: { type: String, default: "971", trim: true },
    // The number as the customer sees it, shown in the admin for reference only.
    businessDisplayNumber: { type: String, default: "", trim: true },

    // ---- Master switch ----
    // Off until the owner turns it on, even once credentials are saved. Connecting
    // the account must not, by itself, send anybody anything.
    enabled: { type: Boolean, default: false },

    // ---- Which order events are allowed to message the customer ----
    // Every one of these starts false. The owner turns each on deliberately.
    notifications: {
      orderPlaced: { type: Boolean, default: false },
      shipped: { type: Boolean, default: false },
      delivered: { type: Boolean, default: false },
      cancelled: { type: Boolean, default: false },
    },

    // ---- The approved template to use for each event ----
    templates: {
      orderPlaced: { type: templateSchema, default: () => ({}) },
      shipped: { type: templateSchema, default: () => ({}) },
      delivered: { type: templateSchema, default: () => ({}) },
      cancelled: { type: templateSchema, default: () => ({}) },
    },

    // When the last admin test send went out, so the test button cannot be used
    // as a way to message a list of numbers one at a time.
    lastTestSentAt: { type: Date, default: null },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true },
)

// The only shape allowed to reach the browser. Secrets are reported as "set or
// not set" plus their last four characters, never in full -- an admin session
// that leaks must not hand over the ability to message customers.
const maskTail = (value) => {
  const text = String(value || "")
  if (!text) return ""
  return text.length <= 4 ? "****" : `****${text.slice(-4)}`
}

whatsappSettingsSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    _id: this._id,
    phoneNumberId: this.phoneNumberId,
    wabaId: this.wabaId,
    apiVersion: this.apiVersion,
    defaultCountryCode: this.defaultCountryCode,
    businessDisplayNumber: this.businessDisplayNumber,
    enabled: this.enabled,
    notifications: {
      orderPlaced: Boolean(this.notifications?.orderPlaced),
      shipped: Boolean(this.notifications?.shipped),
      delivered: Boolean(this.notifications?.delivered),
      cancelled: Boolean(this.notifications?.cancelled),
    },
    templates: {
      orderPlaced: { name: this.templates?.orderPlaced?.name || "", language: this.templates?.orderPlaced?.language || "en" },
      shipped: { name: this.templates?.shipped?.name || "", language: this.templates?.shipped?.language || "en" },
      delivered: { name: this.templates?.delivered?.name || "", language: this.templates?.delivered?.language || "en" },
      cancelled: { name: this.templates?.cancelled?.name || "", language: this.templates?.cancelled?.language || "en" },
    },
    accessTokenSet: Boolean(this.accessToken),
    accessTokenHint: maskTail(this.accessToken),
    appSecretSet: Boolean(this.appSecret),
    appSecretHint: maskTail(this.appSecret),
    verifyTokenSet: Boolean(this.verifyToken),
    verifyTokenHint: maskTail(this.verifyToken),
    lastTestSentAt: this.lastTestSentAt,
    updatedAt: this.updatedAt,
  }
}

const WhatsAppSettings = mongoose.model("WhatsAppSettings", whatsappSettingsSchema)

export default WhatsAppSettings
