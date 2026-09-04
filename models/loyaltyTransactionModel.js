import mongoose from "mongoose"

// Append-only ledger of every point movement. This is the audit trail; the spendable
// balance is the denormalised counter on the user document (User.loyaltyPoints), which is
// only ever moved with an atomic $inc alongside a row written here.
//
// `points` is signed: positive credits the customer, negative debits them.
const loyaltyTransactionSchema = mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      default: null,
      index: true,
    },

    type: {
      type: String,
      enum: [
        "earn", // points from a purchase
        "redeem", // points spent at checkout
        "refund", // spent points returned when an order is cancelled
        "reverse", // an award taken back because the order was cancelled or returned
        "expire", // points aged out
        "adjust", // manual admin credit or debit
      ],
      required: true,
    },

    // pending   -> earned but not yet spendable (order has not reached the award status)
    // confirmed -> counted in the spendable balance
    // cancelled -> a pending award that will never pay out
    status: {
      type: String,
      enum: ["pending", "confirmed", "cancelled"],
      default: "confirmed",
      index: true,
    },

    // Signed. Positive credits, negative debits.
    points: {
      type: Number,
      required: true,
    },
    // The user's spendable balance immediately after this row was applied. Null for rows
    // that did not touch the balance (a pending or cancelled award).
    balanceAfter: {
      type: Number,
      default: null,
    },

    // AED value this row represented, for reporting.
    amountAed: {
      type: Number,
      default: 0,
    },
    // The rates in force when this row was written, so history stays readable after the
    // admin changes the programme.
    rateSnapshot: {
      earnPointsPerAed: { type: Number, default: null },
      redeemPointsPerAed: { type: Number, default: null },
    },

    description: {
      type: String,
      default: "",
    },
    // Set on manual adjustments so there is always a reason on record.
    adminNote: {
      type: String,
      default: "",
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    expiresAt: {
      type: Date,
      default: null,
    },

    // Whether the customer has been shown the "you earned points" dialog for this row.
    // Set false on creation, flipped once the dialog has been acknowledged, so the
    // announcement happens exactly once however many times they reload the site.
    announcedToUser: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
)

loyaltyTransactionSchema.index({ user: 1, createdAt: -1 })
// Drives the "anything to announce?" check on every page load, so it must be an index hit.
loyaltyTransactionSchema.index({ user: 1, type: 1, status: 1, announcedToUser: 1 })
loyaltyTransactionSchema.index({ status: 1, expiresAt: 1 })
// One earn row and one redeem row per order, so a retried award cannot pay out twice.
loyaltyTransactionSchema.index(
  { order: 1, type: 1 },
  { unique: true, partialFilterExpression: { order: { $type: "objectId" } } },
)

const LoyaltyTransaction = mongoose.model("LoyaltyTransaction", loyaltyTransactionSchema)

export default LoyaltyTransaction
