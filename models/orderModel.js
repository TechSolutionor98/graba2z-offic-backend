//

// ===================

import mongoose from "mongoose"

const orderSchema = mongoose.Schema(
  {
    documentType: {
      type: String,
      enum: ["order", "quotation"],
      default: "order",
      index: true,
    },
    quotationStatus: {
      type: String,
      enum: ["Draft", "Converted"],
      default: undefined,
    },
    convertedOrderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      default: null,
    },
    convertedAt: {
      type: Date,
      default: null,
    },
    sourceQuotationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      default: null,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    orderSource: {
      type: String,
      enum: ["web", "app"],
      default: "web",
    },
    orderItems: [
      {
        name: { type: String, required: true },
        quantity: { type: Number, required: true },
        image: { type: String, default: "/placeholder.svg" },
        price: { type: Number, required: true },
        product: {
          type: mongoose.Schema.Types.ObjectId,
          required: false, // Optional for protection items
          ref: "Product",
        },
        // Color variation data
        selectedColorIndex: { type: Number, default: null },
        selectedColorData: {
          color: { type: String },
          image: { type: String },
          price: { type: Number },
          offerPrice: { type: Number },
          sku: { type: String },
        },
        // DOS/Windows variation data
        selectedDosIndex: { type: Number, default: null },
        selectedDosData: {
          dosType: { type: String },
          image: { type: String },
          price: { type: Number },
          offerPrice: { type: Number },
          sku: { type: String },
        },
        // Buyer protection fields
        isProtection: { type: Boolean, default: false },
        protectionFor: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Product",
        },
        protectionData: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "BuyerProtection",
        },
      },
    ],
    shippingAddress: {
      name: { type: String },
      email: { type: String },
      phone: { type: String },
      address: { type: String },
      city: { type: String },
      state: { type: String },
      zipCode: { type: String },
    },
    deliveryType: {
      type: String,
      required: true,
      enum: ["home", "pickup"],
      default: "home",
    },
    pickupDetails: {
      phone: { type: String },
      location: { type: String },
      storeId: { type: String },
    },
    paymentMethod: {
      type: String,
      required: true,
      default: "Cash on Delivery",
      enum: ["Cash on Delivery", "Credit Card", "Debit Card", "PayPal", "Bank Transfer", "cod", "card", "tabby", "tamara"],
    },
    // Store the actual payment provider used (tabby, tamara, card, cod)
    actualPaymentMethod: {
      type: String,
      enum: ["cod", "card", "tabby", "tamara", null],
      default: null,
    },
    paymentResult: {
      id: String,
      status: String,
      update_time: String,
      email_address: String,
      // Provider-specific fields
      tamara_order_id: String,
      tamara_checkout_id: String,
      tabby_payment_id: String,
      ngenius_order_ref: String,
      event_type: String,
      authorized_amount: Object,
      capture_id: String,
      captured_amount: Object,
      webhook_data: Object,
    },
    itemsPrice: {
      type: Number,
      required: true,
      default: 0.0,
    },
    taxPrice: {
      type: Number,
      required: true,
      default: 0.0,
    },
    shippingPrice: {
      type: Number,
      required: true,
      default: 0.0,
    },
    discountAmount: {
      type: Number,
      default: 0.0,
    },
    codFee: {
      type: Number,
      default: 0.0,
    },
    codShippingFee: {
      type: Number,
      default: 0.0,
    },
    paymentCharges: [
      {
        name: { type: String },
        amount: { type: Number }
      }
    ],
    appDiscountApplied: {
      type: Boolean,
      default: false,
    },
    appDiscountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AppDiscount",
      default: null,
    },
    appDiscountName: {
      type: String,
      default: "",
    },
    appDiscountType: {
      type: String,
      enum: ["percentage", "fixed", ""],
      default: "",
    },
    appDiscountValue: {
      type: Number,
      default: 0,
    },
    appDiscountAmount: {
      type: Number,
      default: 0,
    },
    couponCode: {
      type: String,
    },
    totalPrice: {
      type: Number,
      required: true,
      default: 0.0,
    },
    isPaid: {
      type: Boolean,
      required: true,
      default: false,
    },
    paidAt: {
      type: Date,
    },
    status: {
      type: String,
      required: true,
      default: "New",
      enum: [
        "New",
        "Processing",
        "Confirmed",
        "Ready for Shipment",
        "Shipped",
        "On the Way",
        "Out for Delivery",
        "Delivered",
        "On Hold",
        "Cancelled",
        "Returned",
        "Deleted",
      ],
    },
    trackingId: {
      type: String,
    },
    estimatedDelivery: {
      type: Date,
    },
    deliveredAt: {
      type: Date,
    },
    cancelReason: {
      type: String,
    },
    notes: {
      type: String,
    },
    customerNotes: {
      type: String,
      maxlength: 500,
    },
    sellerComments: {
      type: String,
    },
    sellerMessage: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  },
)

orderSchema.post("init", function (doc) {
  if (
    (!doc.itemsPrice || doc.itemsPrice <= 0 || !doc.totalPrice || doc.totalPrice <= 0) &&
    doc.orderItems &&
    doc.orderItems.length > 0
  ) {
    let computedItemsPrice = 0
    for (const item of doc.orderItems) {
      computedItemsPrice += (Number(item.price) || 0) * (Number(item.quantity) || 1)
    }

    if (!doc.itemsPrice || doc.itemsPrice <= 0) {
      doc.itemsPrice = computedItemsPrice
    }

    if (!doc.totalPrice || doc.totalPrice <= 0) {
      const shipping = Number(doc.shippingPrice) || 0
      const tax = Number(doc.taxPrice) || 0
      const discount = Number(doc.discountAmount) || 0
      const codFee = Number(doc.codFee) || 0
      const codShipping = Number(doc.codShippingFee) || 0

      const paymentChargesTotal = Array.isArray(doc.paymentCharges)
        ? doc.paymentCharges.reduce((sum, charge) => sum + (Number(charge.amount) || 0), 0)
        : 0

      let computedTotal = computedItemsPrice + shipping + tax - discount
      if (paymentChargesTotal > 0) {
        computedTotal += paymentChargesTotal
      } else {
        computedTotal += codFee + codShipping
      }

      doc.totalPrice = Math.max(0, computedTotal)
    }
  }
})

const Order = mongoose.model("Order", orderSchema)

export default Order
