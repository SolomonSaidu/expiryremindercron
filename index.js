const admin = require("firebase-admin");
const nodemailer = require("nodemailer");
const cron = require("node-cron");
require("dotenv").config();

// Firebase Admin Setup
const firebaseConfig = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
};

if (!firebaseConfig.projectId || !firebaseConfig.clientEmail || !firebaseConfig.privateKey) {
  console.error("❌ Missing Firebase credentials in .env");
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(firebaseConfig),
});
const db = admin.firestore();

// Nodemailer setup
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Calculate days until expiry
function getDaysLeft(expiryDateStr) {
  const expiry = new Date(expiryDateStr);
  const now = new Date();
  return Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
}

// Send email reminder
async function sendReminderEmail(to, product, expiry, daysLeft) {
  const mailOptions = {
    from: `"Expiry Reminder" <${process.env.EMAIL_USER}>`,
    to,
    subject: `Reminder: ${product} expires in ${daysLeft} day(s)`,
    html: `
      <h2>Heads up! Your ${product} is expiring soon</h2>
      <p><strong>Expiry Date:</strong> ${expiry}</p>
      <p>This item will expire in <strong>${daysLeft} day(s)</strong>.</p>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`✅ Email sent to ${to} for ${product}`);
  } catch (error) {
    console.error(`❌ Failed to send email to ${to}:`, error.message);
  }
}

// Main job function
async function checkProductsAndNotify() {
  const snapshot = await db.collection("products").get();
  const reminders = [1, 6, 7, 30, 90, 180];

  snapshot.forEach((doc) => {
    const data = doc.data();

    if (!data.product || !data.expiry || !data.owner) {
      console.warn(`⚠️ Skipping doc ${doc.id}: missing fields`);
      return;
    }

    const daysLeft = getDaysLeft(data.expiry);

    if (reminders.includes(daysLeft)) {
      sendReminderEmail(data.owner, data.product, data.expiry, daysLeft);
    }
  });
}

// 🟢 Run immediately on deploy
checkProductsAndNotify();

// ⏰ Schedule to run daily at 7 AM
cron.schedule("0 7 * * *", () => {
  console.log("🕖 Running 7 AM reminder job...");
  checkProductsAndNotify();
});


// ✅ Express server (Render requires this)
const express = require("express");
const app = express();

app.get("/", (req, res) => {
  res.send("🟢 Expiry Reminder Server is running.");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});
