import mongoose from "mongoose";

/**
 * One person on one campaign.
 *
 * A row per recipient rather than a counter, because "did this customer get it,
 * and what happened" is a question somebody will ask about one named person,
 * and a counter cannot answer it. It is also what makes a stopped campaign
 * resumable without sending anyone a second copy.
 */
const campaignRecipientSchema = new mongoose.Schema(
  {
    campaign: { type: mongoose.Schema.Types.ObjectId, ref: "EmailCampaign", required: true, index: true },
    email: { type: String, required: true },
    name: { type: String, default: "" },
    // Which list the address came from. First one wins when somebody appears in
    // several -- see collectAudience.
    source: { type: String, default: "" },

    status: {
      type: String,
      enum: ["pending", "sent", "failed", "skipped"],
      default: "pending",
      index: true,
    },
    error: { type: String, default: "" },
    messageId: { type: String, default: "" },
    sentAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// The guarantee that one person gets one copy. It holds even if the audience is
// rebuilt, the campaign is resumed, or two sends overlap: the second write for
// the same address is rejected by the database rather than by whichever piece
// of code happened to remember.
campaignRecipientSchema.index({ campaign: 1, email: 1 }, { unique: true });

const CampaignRecipient = mongoose.model("CampaignRecipient", campaignRecipientSchema);

export default CampaignRecipient;
