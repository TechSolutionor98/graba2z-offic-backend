import mongoose from "mongoose"

// One row per invited signup. This is the record of the relationship between two
// customers; the discounts either of them earned from it live in ReferralReward.
//
// A referral is created the moment the friend registers through a referral link and
// starts life `pending`. It only becomes `qualified` -- the point at which the referrer
// is paid -- once an order the friend placed has actually been delivered.
const referralSchema = mongoose.Schema(
  {
    referrer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // A person can only ever be referred once, by one person. The unique index below is
    // what enforces that -- deleting and re-registering with a different link cannot
    // farm rewards while the account still exists.
    referee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },

    // The code as it was typed/clicked, kept verbatim for support queries even if the
    // referrer's code is later regenerated.
    code: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      index: true,
    },

    // pending   -> friend has signed up, no delivered order yet
    // qualified -> a delivered order met the bar; the referrer has been rewarded
    // cancelled -> the qualifying order was cancelled or returned and the reward was
    //              still unspent, so it was taken back
    status: {
      type: String,
      enum: ["pending", "qualified", "cancelled"],
      default: "pending",
      index: true,
    },

    // The friend's order that tipped this referral over the line.
    qualifyingOrder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      default: null,
    },
    qualifyingOrderTotalAed: {
      type: Number,
      default: 0,
    },
    qualifiedAt: {
      type: Date,
      default: null,
    },

    // The two rewards this referral produced, if any. The friend's is minted at signup;
    // the referrer's only on qualification.
    refereeReward: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ReferralReward",
      default: null,
    },
    referrerReward: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ReferralReward",
      default: null,
    },

    // Set when a qualification could not be undone because the referrer had already
    // spent the reward. The referral is left qualified and this explains why.
    rewardAlreadySpent: {
      type: Boolean,
      default: false,
    },

    // Why no referrer reward was minted, when none was: "limit_reached",
    // "email_unverified", "below_minimum", "programme_disabled". Empty when one was.
    notRewardedReason: {
      type: String,
      default: "",
    },

    // Where the signup came from, for reporting.
    source: {
      type: String,
      enum: ["web", "app"],
      default: "web",
    },
  },
  { timestamps: true },
)

// Drives the referrer's "my invites" list.
referralSchema.index({ referrer: 1, createdAt: -1 })
referralSchema.index({ referrer: 1, status: 1 })

const Referral = mongoose.model("Referral", referralSchema)

export default Referral
