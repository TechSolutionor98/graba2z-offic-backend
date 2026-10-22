import mongoose from "mongoose";

export const AUDIENCE_SOURCES = ["users", "newsletter", "callbacks", "bulk"];

/**
 * One send to a chosen audience.
 *
 * The HTML is copied onto the campaign when it starts going out rather than
 * read from the template at send time: a template edited halfway through a
 * campaign would otherwise mean two different emails went out under one name,
 * with no record of which person got which.
 */
const emailCampaignSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    // Required only once the campaign leaves draft -- see the route. A campaign
    // being put together is allowed to be incomplete.
    subject: { type: String, default: "" },
    preheader: { type: String, default: "" },

    template: { type: mongoose.Schema.Types.ObjectId, ref: "EmailTemplate", default: null },
    // Frozen copy. Empty until the campaign is sent.
    html: { type: String, default: "" },

    audience: {
      sources: [{ type: String, enum: AUDIENCE_SOURCES }],
      // "all" sends to everyone in the chosen lists; "pick" sends only to the
      // addresses below. An empty picked list in pick mode means nobody, which
      // is why the two are stored separately rather than inferred from whether
      // anything was ticked.
      mode: { type: String, enum: ["all", "pick"], default: "all" },
      picked: [{ type: String }],
      // Narrowing applied when the audience is gathered. Absent means "everyone
      // in the chosen sources".
      onlyVerifiedUsers: { type: Boolean, default: false },
      excludeAdmins: { type: Boolean, default: true },
    },

    status: {
      type: String,
      enum: ["draft", "sending", "paused", "sent", "failed"],
      default: "draft",
      index: true,
    },

    // Written as the send progresses so a half-finished campaign can be read
    // honestly rather than looking the same as one that never started.
    stats: {
      total: { type: Number, default: 0 },
      sent: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
      skipped: { type: Number, default: 0 },
    },

    // Messages per minute. Kept per campaign because the sensible number
    // depends on the mailbox provider's limit, which is not ours to guess.
    throttlePerMinute: { type: Number, default: 30, min: 1, max: 600 },

    // Which mailbox it goes out from. The list is SENDER_MAILBOXES in
    // utils/emailService.js; a key whose credentials are missing falls back to
    // support at send time rather than failing.
    sender: {
      type: String,
      enum: ["support", "order", "sales", "info", "marketing"],
      default: "support",
    },

    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    lastError: { type: String, default: "" },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

const EmailCampaign = mongoose.model("EmailCampaign", emailCampaignSchema);

export default EmailCampaign;
