import express from "express"
import cors from "cors"
import dotenv from "dotenv"
import connectDB from "./config/db.js"
import config from "./config/config.js"
import { notFound, errorHandler } from "./middleware/errorMiddleware.js"

import googleMerchantRoutes from "./routes/googleMerchantRoutes.js"
import sitemapRoutes from './routes/sitemapRoutes.js'

// Routes
import userRoutes from "./routes/userRoutes.js"
import productRoutes from "./routes/productRoutes.js"
import orderRoutes from "./routes/orderRoutes.js"
import uploadRoutes from "./routes/uploadRoutes.js"
import categoryRoutes from "./routes/categoryRoutes.js"
import subCategoryRoutes from "./routes/subCategoryRoutes.js"
import brandRoutes from "./routes/brandRoutes.js"
import colorRoutes from "./routes/colorRoutes.js"
import sizeRoutes from "./routes/sizeRoutes.js"
import unitRoutes from "./routes/unitRoutes.js"
import volumeRoutes from "./routes/volumeRoutes.js"
import warrantyRoutes from "./routes/warrantyRoutes.js"
import taxRoutes from "./routes/taxRoutes.js"
import deliveryChargeRoutes from "./routes/deliveryChargeRoutes.js"
import couponRoutes from "./routes/couponRoutes.js"
import bannerRoutes from "./routes/bannerRoutes.js"
import blogRoutes from "./routes/blogRoutes.js"
import blogCategoryRoutes from "./routes/blogCategoryRoutes.js"
import blogTopicRoutes from "./routes/blogTopicRoutes.js"
import blogRatingRoutes from "./routes/blogRatingRoutes.js"
import settingsRoutes from "./routes/settingsRoutes.js"
import wishlistRoutes from "./routes/wishlistRoutes.js"
import requestCallbackRoutes from "./routes/requestCallbackRoutes.js"
import paymentRoutes from "./routes/paymentRoutes.js"
import adminRoutes from "./routes/adminRoutes.js"
import emailTemplateRoutes from "./routes/emailTemplateRoutes.js"
import newsletterRoutes from "./routes/newsletterRoutes.js"
import tamaraAdminRoutes from "./routes/tamaraAdminRoutes.js"
import { captureRawBody, webhookRateLimit, authenticateWebhook } from "./middleware/webhookMiddleware.js"
import appRoutes from "./routes/appRoutes.js"
import mobileApiRoutes from "./routes/mobileApiRoutes.js"
import reviewRoutes from "./routes/reviewRoutes.js"
import adminReviewRoutes from "./routes/adminReviewRoutes.js"
import priceAdjustmentRoutes from "./routes/priceAdjustmentRoutes.js"

dotenv.config()

// Connect to database
connectDB()

const app = express()

// CORS configuration
app.use(cors({
  origin: [
    'https://www.graba2z.ae',
    'https://www.grabatoz.ae',
    'http://localhost:3000'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin'],
  exposedHeaders: ['WWW-Authenticate', 'Server-Authorization'],
  maxAge: 86400,
  credentials: true,
  optionsSuccessStatus: 200
}));

app.options("*", (req, res) => {
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.send();
});

// Serve static files from uploads directory
app.use('/uploads', express.static('uploads'));

// Add logging for static file requests
app.use('/uploads', (req, res, next) => {
  console.log('📁 Static file request:', req.path);
  next();
});

// Apply webhook middleware before body parser for webhook routes
app.use("/api/payment/tamara/webhook", captureRawBody, webhookRateLimit, authenticateWebhook)

// Body parser middleware
app.use(express.json({ limit: "50mb" }))
app.use(express.urlencoded({ extended: true, limit: "50mb" }))

// Routes
app.use("/api/users", userRoutes)
app.use("/api/products", productRoutes)
app.use("/api/orders", orderRoutes)
app.use("/api/upload", uploadRoutes)
app.use("/api/categories", categoryRoutes)
app.use("/api/subcategories", subCategoryRoutes)
app.use("/api/brands", brandRoutes)
app.use("/api/colors", colorRoutes)
app.use("/api/sizes", sizeRoutes)
app.use("/api/units", unitRoutes)
app.use("/api/volumes", volumeRoutes)
app.use("/api/warranty", warrantyRoutes)
app.use("/api/tax", taxRoutes)
app.use("/api/delivery-charges", deliveryChargeRoutes)
app.use("/api/coupons", couponRoutes)
app.use("/api/banners", bannerRoutes)
app.use("/api/blogs", blogRoutes)
app.use("/api/blog-categories", blogCategoryRoutes)
app.use("/api/blog-topics", blogTopicRoutes)
app.use("/api/blog-ratings", blogRatingRoutes)
app.use("/api/settings", settingsRoutes)
app.use("/api/wishlist", wishlistRoutes)
app.use("/api/request-callback", requestCallbackRoutes)
app.use("/api/payment", paymentRoutes)
app.use("/api/admin", adminRoutes)
app.use("/api/email-templates", emailTemplateRoutes)
app.use("/api/newsletter", newsletterRoutes)


app.use("/api/price-adjustment", priceAdjustmentRoutes)
// @@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@


app.use("/api/google-merchant", googleMerchantRoutes)
app.use('/api/app', appRoutes)
app.use('/api/mobile', mobileApiRoutes)


// Add review routes
app.use("/api/reviews", reviewRoutes)
app.use("/api/admin/reviews", adminReviewRoutes)



app.use('/', sitemapRoutes)   

// Health check route
app.get("/", (req, res) => {
  res.json({
    message: "GrabA2Z API is running!",
    version: "1.0.0",
    environment: config.NODE_ENV,
  })
})

// Add a simple test route
app.get('/api/test', (req, res) => {
  res.json({ 
    message: 'Server working!', 
    time: new Date(),
    uploadsPath: './uploads'
  });
});

// Error handling middleware
app.use(notFound)
app.use(errorHandler)

const PORT = config.PORT

app.listen(PORT, () => {
  console.log(`Server running in ${config.NODE_ENV} mode on port ${PORT}`)
})

