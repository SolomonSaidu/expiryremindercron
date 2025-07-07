const express = require("express");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");
const cron = require("node-cron");
require("dotenv").config();

const app = express();

// Firebase Admin Setup
const firebaseConfig = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
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

// Utility: Calculate days until expiry
function getDaysLeft(expiryDateStr) {
  const expiry = new Date(expiryDateStr);
  const now = new Date();
  return Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
}

// Utility: Group by user email
function groupByUser(products) {
  const userMap = {};
  products.forEach((product) => {
    if (!userMap[product.owner]) userMap[product.owner] = [];
    userMap[product.owner].push(product);
  });
  return userMap;
}

// Send grouped email
async function sendGroupedEmail(to, products) {
  const rows = products
    .map(
      (p) =>
        `<tr><td>${p.product}</td><td>${p.expiry}</td><td>${getDaysLeft(
          p.expiry
        )}</td></tr>`
    )
    .join("");

  const html = `
    <h3>DateX, Product Reminder</h3>
    <p>The following products are expiring soon:</p>
    <table border="1" cellpadding="6" cellspacing="0">
      <thead>
        <tr>
          <th>Product</th>
          <th>Expiry Date</th>
          <th>Days Left</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <b>To stop this message delete the expiring product from your dashboard.</b>
  `;

  const mailOptions = {
    from: `"Expiry Reminder" <${process.env.EMAIL_USER}>`,
    to,
    subject: `You have ${products.length} product(s) expiring soon`,
    html,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`✅ Grouped email sent to ${to}`);
  } catch (error) {
    console.error(`❌ Failed to email ${to}:`, error.message);
  }
}

// Main job
async function checkProductsAndNotify() {
  console.log("🔍 Checking for expiring products...");

  const snapshot = await db.collection("products").get();
  const reminders = [1, 6, 7, 30, 90, 180];
  const expiringProducts = [];

  snapshot.forEach((doc) => {
  const data = doc.data();

  if (!data.product || !data.expiry || !data.owner || !data.remindBefore) {
    console.warn(`⚠️ Skipping doc ${doc.id}: missing fields`);
    return;
  }

  const daysLeft = getDaysLeft(data.expiry);

  // Extract number from remindBefore string (e.g., "3days" → 3)
  const remindDays = parseInt(data.remindBefore.replace(/\D/g, ""), 10);

  if (daysLeft === remindDays) {
    expiringProducts.push({ ...data, daysLeft });
  }
});


  // Group by user and send emails
  const grouped = groupByUser(expiringProducts);
  for (const [email, products] of Object.entries(grouped)) {
    await sendGroupedEmail(email, products);
  }
}

// 🟢 Endpoint for Render + UptimeRobot to ping
app.get("/run-job", async (req, res) => {
  await checkProductsAndNotify();
  res.send("✅ Reminder check complete");
});

// ⏰ Schedule daily run at 7 AM
cron.schedule("0 7 * * *", () => {
  console.log("⏰ Running scheduled 7 AM job...");
  checkProductsAndNotify();
});

// 🔥 Start server for Render (required!)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
