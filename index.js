// index.js
const express = require("express");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");
require("dotenv").config();
const app = express();
const PORT = process.env.PORT || 3000;

// Firebase Admin Setup
const firebaseConfig = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
};

if (!firebaseConfig.projectId || !firebaseConfig.clientEmail || !firebaseConfig.privateKey) {
  console.error("❌ Firebase credentials missing");
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(firebaseConfig),
});
const db = admin.firestore();

// Nodemailer Setup
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Utility: calculate days left
const getDaysLeft = (expiryDateStr) => {
  const expiry = new Date(expiryDateStr);
  const now = new Date();
  return Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
};

// Send Reminder Email
const sendReminderEmail = async (to, product, expiry, daysLeft) => {
  const mailOptions = {
    from: `"Expiry Reminder" <${process.env.EMAIL_USER}>`,
    to,
    subject: `Reminder: ${product} expires in ${daysLeft} day(s)`,
    html: `
      <h3>Heads up! Your <strong>${product}</strong> is expiring soon</h3>
      <p><strong>Expiry Date:</strong> ${expiry}</p>
      <p>This product will expire in <strong>${daysLeft} day(s)</strong>.</p>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`✅ Email sent to ${to} for ${product}`);
  } catch (err) {
    console.error(`❌ Failed to email ${to}:`, err.message);
  }
};

// Main Job
async function checkProductsAndNotify() {
  console.log("🔍 Checking products...");
  const snapshot = await db.collection("products").get();
  const reminders = [1, 6, 7, 30, 90, 180];

  snapshot.forEach((doc) => {
    const data = doc.data();
    if (!data.product || !data.expiry || !data.owner) {
      console.warn(`⚠️ Skipping doc ${doc.id} due to missing fields`);
      return;
    }

    const daysLeft = getDaysLeft(data.expiry);
    if (reminders.includes(daysLeft)) {
      sendReminderEmail(data.owner, data.product, data.expiry, daysLeft);
    }
  });
}

// Ping route for UptimeRobot
app.get("/run-job", async (req, res) => {
  await checkProductsAndNotify();
  res.send("✅ Reminder job executed");
});

// Optional root route
app.get("/", (req, res) => {
  res.send("🟢 Expiry Reminder is alive!");
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});
