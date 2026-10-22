import mongoose from "mongoose";

/**
 * People who must never receive marketing email again.
 *
 * This list is absolute and it is checked at the moment each message is sent,
 * not only when an audience is built -- somebody who unsubscribes while a
 * campaign is still going out stops receiving it, which is the whole point of
 * the link. Removing an address from here is deliberately not something the
 * campaign screens can do.
 */
const emailSuppressionSchema = new mongoose.Schema(
  {
    // Stored lowercased and trimmed by the service, so a match is a plain
    // equality test and "A@b.com" cannot slip past an entry for "a@b.com".
    email: { type: String, required: true, unique: true, index: true },
    reason: {
      type: String,
      enum: ["unsubscribed", "bounced", "complaint", "manual"],
      default: "unsubscribed",
    },
    // Which campaign the person was reading when they opted out. Kept so the
    // decision can be explained later, never used to decide anything.
    campaign: { type: mongoose.Schema.Types.ObjectId, ref: "EmailCampaign", default: null },
    note: { type: String, default: "" },
  },
  { timestamps: true }
);

const EmailSuppression = mongoose.model("EmailSuppression", emailSuppressionSchema);

export default EmailSuppression;
