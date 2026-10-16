import mongoose from "mongoose"

// Every message in or out, in the order it happened. This is both the inbox's
// history and the audit trail for why a given customer was written to.

const whatsappMessageSchema = mongoose.Schema(
  {
    contact: { type: mongoose.Schema.Types.ObjectId, ref: "WhatsAppContact", required: true, index: true },
    phone: { type: String, required: true, index: true },
    direction: { type: String, enum: ["in", "out"], required: true },

    //   text        a freely written message (only valid inside the 24h window)
    //   template    an approved template, the only thing allowed outside it
    //   interactive a button tap coming back from a template
    //   system      a note this app wrote for the record, never sent to WhatsApp
    type: { type: String, enum: ["text", "template", "interactive", "system"], default: "text" },
    body: { type: String, default: "" },
    templateName: { type: String, default: "" },

    // Meta's own message id. Unique so a webhook Meta retries cannot be processed
    // twice -- which, for a Confirm/Cancel tap, would mean acting on it twice.
    //
    // The default is undefined, not null: a sparse index skips documents that are
    // missing the field, but an explicit null is a value like any other, so
    // default:null would make the second id-less message collide with the first.
    wamid: { type: String, default: undefined, index: true, unique: true, sparse: true },

    status: {
      type: String,
      enum: ["queued", "sent", "delivered", "read", "failed", "received", "skipped"],
      default: "queued",
    },
    error: { type: String, default: "" },

    // Set on an automated order notification, so the history explains itself.
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order", default: null },
    event: { type: String, default: "" },
    // The admin who typed an outbound reply. Null for automated messages.
    sentBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    // The raw webhook fragment, kept for support when a message behaves oddly.
    raw: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true },
)

whatsappMessageSchema.index({ contact: 1, createdAt: -1 })

const WhatsAppMessage = mongoose.model("WhatsAppMessage", whatsappMessageSchema)

export default WhatsAppMessage
