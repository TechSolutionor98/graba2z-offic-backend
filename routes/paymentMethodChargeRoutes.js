import express from "express"
import { protect, admin } from "../middleware/authMiddleware.js"
import {
  getPaymentCharges,
  getActivePaymentCharges,
  getPaymentChargeById,
  createPaymentCharge,
  updatePaymentCharge,
  deletePaymentCharge,
} from "../controllers/paymentMethodChargeController.js"

const router = express.Router()

router.route("/").get(getPaymentCharges).post(protect, admin, createPaymentCharge)
router.route("/active").get(getActivePaymentCharges)
router
  .route("/:id")
  .get(protect, admin, getPaymentChargeById)
  .put(protect, admin, updatePaymentCharge)
  .delete(protect, admin, deletePaymentCharge)

export default router
