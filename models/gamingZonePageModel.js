import mongoose from 'mongoose';

const gamingZonePageSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    metaTitle: {
      type: String,
      default: "",
      trim: true,
    },
    metaDescription: {
      type: String,
      default: "",
      trim: true,
    },
    canonicalUrl: {
      type: String,
      default: "",
      trim: true,
    },
    seoTitle: {
      type: String,
      default: "",
      trim: true,
    },
    seoDescription: {
      type: String,
      default: "",
      trim: true,
    },
    seoKeywords: {
      type: String,
      default: "",
      trim: true,
    },
    seoCanonicalUrl: {
      type: String,
      default: "",
      trim: true,
    },
    seoRobots: {
      type: String,
      default: "index, follow",
      enum: ["index, follow", "noindex, follow", "index, nofollow", "noindex, nofollow"],
    },
    customSchema: {
      type: String,
      default: "",
    },
    ogTitle: {
      type: String,
      default: "",
      trim: true,
    },
    ogDescription: {
      type: String,
      default: "",
      trim: true,
    },
    ogImage: {
      type: String,
      default: "",
      trim: true,
    },
    heroImage: {
      type: String,
      default: '',
    },
    cardImages: [
      {
        image: {
          type: String,
          default: '',
        },
        order: {
          type: Number,
          default: 1,
        },
      }
    ],
    isActive: {
      type: Boolean,
      default: true,
    },
    order: {
      type: Number,
      default: 1,
      min: 1,
    },
  },
  {
    timestamps: true,
  }
);

// Validate max 3 card images
gamingZonePageSchema.pre('save', function(next) {
  if (this.cardImages && this.cardImages.length > 3) {
    next(new Error('Maximum 3 card images allowed'));
  } else {
    next();
  }
});

const GamingZonePage = mongoose.model('GamingZonePage', gamingZonePageSchema);

export default GamingZonePage;
