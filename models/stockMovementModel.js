import mongoose from "mongoose"

/**
 * An append-only record of every change to a product's stock figure.
 *
 * Nothing in here is ever edited or deleted. A mistake is corrected by posting
 * the opposite movement, so the history stays truthful and the In / Out / Damage
 * columns on Store Stats can be trusted: for any product,
 *
 *     in - out - damage = countInStock
 *
 * Rows are only ever written by postStockMovement() in utils/stockLedger.js,
 * which adjusts the product's stock figure in the same breath. Nothing else may
 * touch countInStock, or the ledger and the figure drift apart and both become
 * worthless.
 */

export const MOVEMENT_TYPES = ["in", "out", "damage"]

// Why a movement happened. The reason is free text so it can say something
// useful, but these are the ones the system posts for itself.
export const MOVEMENT_REASONS = {
  OPENING: "Opening stock",
  SALE: "Sold",
  ORDER_RETURN: "Order cancelled",
}

const stockMovementSchema = mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },

    //   in      opening count, a supplier delivery, a customer return
    //   out     sold
    //   damage  broken, lost, stolen, otherwise unsellable
    type: {
      type: String,
      required: true,
      enum: MOVEMENT_TYPES,
      index: true,
    },

    // Always positive. The type carries the direction, so a quantity never has to
    // be read together with a sign to know which way the stock went.
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },

    reason: {
      type: String,
      required: true,
      trim: true,
    },

    // The order this movement came from, when it came from one. Used to tell
    // whether a cancelled order has already been put back.
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      default: null,
      index: true,
    },

    // The admin who posted it, when a person did rather than the system.
    postedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    postedByName: {
      type: String,
      default: "",
    },

    // The product's stock level once this movement was applied. Stored so a
    // single row can be read on its own -- "we had 12 left after that sale" --
    // without replaying every movement before it.
    stockAfter: {
      type: Number,
      required: true,
    },
  },
  { timestamps: true },
)

// The ledger is read two ways: the per-product totals behind the In / Out /
// Damage columns, and the history of one product newest-first.
stockMovementSchema.index({ product: 1, createdAt: -1 })
// The double-cancel guard asks "has this order already been returned?" on every
// cancellation, so that lookup has to be cheap.
stockMovementSchema.index({ order: 1, type: 1 })

const StockMovement = mongoose.model("StockMovement", stockMovementSchema)

export default StockMovement
