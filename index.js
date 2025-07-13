const express = require("express");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");
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

// Helper: Days until expiry
function getDaysLeft(expiryDateStr) {
  const expiry = new Date(expiryDateStr);
  const now = new Date();
  return Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
}

// Format today
function getTodayKey() {
  return new Date().toISOString().split("T")[0];
}

// Group products by user email
function groupByUser(products) {
  const userMap = {};
  products.forEach((p) => {
    if (!userMap[p.owner]) userMap[p.owner] = [];
    userMap[p.owner].push(p);
  });
  return userMap;
}

// Send HTML email
async function sendGroupedEmail(to, products) {
  const rows = products
    .map((p) => `<tr><td>${p.product}</td><td>${p.expiry}</td><td>${getDaysLeft(p.expiry)}</td></tr>`)
    .join("");

  const html = `
    <h3>📦 Expiry Reminder</h3>
    <p>The following products are expiring soon:</p>
    <table border="1" cellpadding="6" cellspacing="0">
      <thead><tr><th>Product</th><th>Expiry Date</th><th>Days Left</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p><i>To stop this message, delete the expiring product from your dashboard.</i></p>
  `;

  try {
    await transporter.sendMail({
      from: `"DateX Reminder" <no-reply@solomondev.com>`,
      to,
      subject: `⏰ ${products.length} product(s) expiring soon`,
      html,
    });
    console.log(`✅ Email sent to ${to}`);
  } catch (error) {
    console.error(`❌ Failed to send to ${to}: ${error.message}`);
  }
}

// Has job already run today?
async function jobAlreadyRanToday() {
  const todayKey = getTodayKey();
  const ref = db.collection("meta").doc("lastReminder");
  const doc = await ref.get();

  if (doc.exists && doc.data().date === todayKey) {
    console.log("⏭️ Email already sent today. Skipping...");
    return true;
  }

  await ref.set({ date: todayKey });
  return false;
}

// 🔁 Main logic
async function checkProductsAndNotify() {
  console.log("🔍 Checking for expiring products...");

  if (await jobAlreadyRanToday()) return;

  const snapshot = await db.collection("products").get();
  const expiringProducts = [];

  snapshot.forEach((doc) => {
    const data = doc.data();
    if (!data.product || !data.expiry || !data.owner || !data.remindBefore) return;

    const daysLeft = getDaysLeft(data.expiry);
    const remindDays = parseInt(data.remindBefore.replace(/\D/g, ""), 10);

    if (daysLeft === remindDays) {
      expiringProducts.push({ ...data, daysLeft });
    }
  });

  const grouped = groupByUser(expiringProducts);
  for (const [email, products] of Object.entries(grouped)) {
    await sendGroupedEmail(email, products);
  }

  console.log("✅ Reminder job finished.");
}

// 🟢 Route to trigger the job manually or by cron-job.org
app.get("/run-job", async (req, res) => {
  await checkProductsAndNotify();
  res.send("✅ Reminder check complete");
});

// 🔥 Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
