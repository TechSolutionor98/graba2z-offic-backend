import mongoose from "mongoose"

// A single-use discount locked to one customer, produced by the referral programme.
//
// It is deliberately not a Coupon: a coupon is a shared public code anyone can type,
// whereas this is personal, cannot be guessed, is spent exactly once, and has to be
// reversible when the order that earned it is cancelled. Keeping it separate also means
// the referral programme can never accidentally widen what a coupon does.
//
// The rate is copied in at creation rather than read from ReferralSettings at spend
// time, so changing the programme never silently changes what a customer was promised.
const referralRewardSchema = mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    referral: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Referral",
      required: true,
    },
    // Which side of the referral this reward paid.
    role: {
      type: String,
      enum: ["referee", "referrer"],
      required: true,
    },

    // ---- The offer, snapshotted ----
    discountType: {
      type: String,
      enum: ["percentage", "fixed"],
      required: true,
    },
    discountValue: {
      type: Number,
      required: true,
      min: 0,
    },
    // AED ceiling on a percentage discount (0 = none).
    maxDiscountAed: {
      type: Number,
      default: 0,
    },
    // Order must be worth at least this much for the reward to apply.
    minOrderAed: {
      type: Number,
      default: 0,
    },
    // Referee welcome rewards may be restricted to the customer's first order.
    firstOrderOnly: {
      type: Boolean,
      default: false,
    },

    // active    -> spendable
    // used      -> spent on `order`
    // expired   -> aged out unspent
    // cancelled -> withdrawn because the qualifying order was cancelled or returned
    status: {
      type: String,
      enum: ["active", "used", "expired", "cancelled"],
      default: "active",
      index: true,
    },

    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      default: null,
    },
    usedAt: {
      type: Date,
      default: null,
    },
    // What it actually took off, in AED. Recorded so reporting does not have to
    // recompute a percentage against a historic basket.
    discountAppliedAed: {
      type: Number,
      default: 0,
    },

    expiresAt: {
      type: Date,
      default: null,
    },

    description: {
      type: String,
      default: "",
    },
  },
  { timestamps: true },
)

// The customer's "my rewards" list and the checkout lookup.
referralRewardSchema.index({ user: 1, status: 1, createdAt: -1 })
referralRewardSchema.index({ status: 1, expiresAt: 1 })
// One reward per side per referral, so a retried qualification cannot mint two.
referralRewardSchema.index({ referral: 1, role: 1 }, { unique: true })

const ReferralReward = mongoose.model("ReferralReward", referralRewardSchema)

export default ReferralReward
