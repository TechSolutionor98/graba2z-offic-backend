import mongoose from "mongoose";

/**
 * One row per email this server tried to send.
 *
 * Written at the single point every message passes through, so nothing can send
 * without being recorded. "Did the customer get it, and when" is a question
 * somebody asks about one named person, and without a row per message there is
 * nothing to answer it with.
 *
 * Failures are recorded as deliberately as successes: a send that was never
 * attempted and one that was refused by the mail server look identical
 * otherwise.
 */
const emailLogSchema = new mongoose.Schema(
  {
    to: { type: String, required: true, index: true },
    subject: { type: String, default: "" },
    from: { type: String, default: "" },
    // Which mailbox it went out from -- support, order, sales, info, marketing.
    sender: { type: String, default: "" },

    status: { type: String, enum: ["sent", "failed"], required: true, index: true },
    messageId: { type: String, default: "" },
    error: { type: String, default: "" },

    // What produced it, when that is known. Free text rather than a reference:
    // a template deleted later must not erase the record of what was sent.
    source: { type: String, default: "" },
    templateName: { type: String, default: "" },
    campaign: { type: mongoose.Schema.Types.ObjectId, ref: "EmailCampaign", default: null },
  },
  { timestamps: true }
);

// The two things the report is read by: newest first, and everything sent to
// one address.
emailLogSchema.index({ createdAt: -1 });
emailLogSchema.index({ to: 1, createdAt: -1 });

const EmailLog = mongoose.model("EmailLog", emailLogSchema);

export default EmailLog;
