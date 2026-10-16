import mongoose from "mongoose"

// One row per customer phone number the shop is allowed to talk to on WhatsApp.
//
// A row only ever comes into existence two ways: an order was placed with this
// number on it, or the number wrote to us first. There is no third path and no
// import route -- that is what stops the shop from messaging a bought list.

const whatsappContactSchema = mongoose.Schema(
  {
    // E.164 digits, no "+" -- the form the Cloud API uses.
    phone: { type: String, required: true, unique: true, index: true },
    name: { type: String, default: "" },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    // How this number earned the right to be messaged.
    //   "order"   an order was placed with it
    //   "inbound" the customer wrote to us first
    consentSource: { type: String, enum: ["order", "inbound"], required: true },
    consentAt: { type: Date, default: Date.now },
    // The order that opened the relationship, kept so support can see where a
    // conversation came from.
    firstOrder: { type: mongoose.Schema.Types.ObjectId, ref: "Order", default: null },
    lastOrder: { type: mongoose.Schema.Types.ObjectId, ref: "Order", default: null },

    // ---- Opt-out ----
    // Permanent until the customer themselves writes in again. Checked before
    // every send, automated order notifications included.
    optedOut: { type: Boolean, default: false, index: true },
    optedOutAt: { type: Date, default: null },
    // The exact text that was read as an opt-out, so a disputed silence can be
    // explained later.
    optOutMessage: { type: String, default: "" },

    // ---- The 24-hour customer service window ----
    // Meta allows freely written replies only for 24 hours after the customer's
    // last message. This is that timestamp; everything else is derived from it.
    lastInboundAt: { type: Date, default: null },
    lastOutboundAt: { type: Date, default: null },

    // ---- Inbox bookkeeping ----
    unreadCount: { type: Number, default: 0 },
    lastMessageAt: { type: Date, default: null },
    lastMessagePreview: { type: String, default: "" },
    lastMessageDirection: { type: String, enum: ["in", "out", ""], default: "" },
  },
  { timestamps: true },
)

// The conversation list is sorted by most recent activity.
whatsappContactSchema.index({ lastMessageAt: -1 })

// True while the shop may send a freely written message. Outside it, only an
// approved template may go out.
whatsappContactSchema.methods.serviceWindowExpiresAt = function serviceWindowExpiresAt() {
  if (!this.lastInboundAt) return null
  return new Date(new Date(this.lastInboundAt).getTime() + 24 * 60 * 60 * 1000)
}

whatsappContactSchema.methods.isWithinServiceWindow = function isWithinServiceWindow() {
  const expiry = this.serviceWindowExpiresAt()
  return Boolean(expiry && expiry.getTime() > Date.now())
}

const WhatsAppContact = mongoose.model("WhatsAppContact", whatsappContactSchema)

export default WhatsAppContact
