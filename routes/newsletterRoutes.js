import express from "express";
import NewsletterSubscriber from "../models/newsletterSubscriberModel.js";
import EmailSuppression from "../models/emailSuppressionModel.js";
import EmailTemplate from "../models/emailTemplateModel.js";
import { sendNewsletterConfirmation, sendEmail } from "../utils/emailService.js";

const router = express.Router();

// POST /api/newsletter/subscribe
router.post("/subscribe", async (req, res) => {
  try {
    const { email, preferences } = req.body;
    if (!email || !preferences || !Array.isArray(preferences) || preferences.length === 0) {
      return res.status(400).json({ message: "Email and preferences are required." });
    }
    // Upsert (update if exists, insert if not)
    const subscriber = await NewsletterSubscriber.findOneAndUpdate(
      { email },
      { $set: { preferences } },
      { upsert: true, new: true }
    );

    // Signing up here is the person asking for our email, so it clears any
    // earlier opt-out. Without this, somebody who unsubscribed once and later
    // typed their address into the subscribe box would be added to the list
    // and then silently never sent anything -- the suppression would quietly
    // outrank the thing they just asked for.
    await EmailSuppression.deleteOne({ email: String(email).trim().toLowerCase() });
    // Not awaited into the response: the person IS subscribed by this point, and
    // a mail server having a bad moment must not tell them it failed. They
    // would try again, or give up believing it did not work.
    sendNewsletterConfirmation(email, preferences).catch((e) =>
      console.error("[newsletter] subscribed, but the confirmation email failed:", e.message)
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message || "Failed to subscribe." });
  }
});

// GET /api/newsletter/subscribers
router.get("/subscribers", async (req, res) => {
  try {
    const all = await NewsletterSubscriber.find().sort({ createdAt: -1 });
    res.json(all);
  } catch (err) {
    res.status(500).json({ message: err.message || "Failed to fetch subscribers." });
  }
});

// POST /api/newsletter/bulk-send
router.post("/bulk-send", async (req, res) => {
  try {
    const { userIds, templateId, subject } = req.body;
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0 || !templateId) {
      return res.status(400).json({ message: "User IDs and template ID are required." });
    }
    const users = await NewsletterSubscriber.find({ _id: { $in: userIds } });
    const template = await EmailTemplate.findById(templateId);
    if (!template) return res.status(404).json({ message: "Template not found" });

    // Templates built in the editor no longer carry a subject -- whoever sends
    // one chooses it. Older templates still have theirs, so it stands in rather
    // than those sends suddenly going out with an empty subject line.
    const line = String(subject || "").trim() || String(template.subject || "").trim();
    if (!line) {
      return res.status(400).json({ message: "Enter a subject line before sending." });
    }
    // Send emails in parallel (could be throttled for large lists)
    await Promise.all(users.map(user => {
      let html = template.html
        .replace(/{{email}}/g, user.email)
        .replace(/{{preferences}}/g, (user.preferences || []).join(", "));
      return sendEmail(
        user.email,
        line,
        html,
        "support"
      );
    }));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message || "Failed to send emails." });
  }
});

export default router; 