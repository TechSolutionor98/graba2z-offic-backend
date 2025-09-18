//

// ===================

import mongoose from "mongoose"

const orderSchema = mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    orderItems: [
      {
        name: { type: String, required: true },
        quantity: { type: Number, required: true },
        image: { type: String, required: true },
        price: { type: Number, required: true },
        product: {
          type: mongoose.Schema.Types.ObjectId,
          required: true,
          ref: "Product",
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
      enum: ["Cash on Delivery", "Credit Card", "Debit Card", "PayPal", "Bank Transfer"],
    },
    paymentResult: {
      id: String,
      status: String,
      update_time: String,
      email_address: String,
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
  },
  {
    timestamps: true,
  },
)

const Order = mongoose.model("Order", orderSchema)

export default Order
