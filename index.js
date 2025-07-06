const admin = require("firebase-admin");
const nodemailer = require("nodemailer");
require("dotenv").config();

// Firebase config
const firebaseConfig = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
};

if (!firebaseConfig.projectId || !firebaseConfig.clientEmail || !firebaseConfig.privateKey) {
  console.error("❌ Missing Firebase credentials.");
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(firebaseConfig),
});
const db = admin.firestore();

// Nodemailer
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Get days left
function getDaysLeft(expiryDateStr) {
  const expiry = new Date(expiryDateStr);
  const now = new Date();
  return Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
}

// Send Email
async function sendReminderEmail(to, product, expiry, daysLeft) {
  const mailOptions = {
    from: `"Expiry Reminder" <${process.env.EMAIL_USER}>`,
    to,
    subject: `Reminder: ${product} expires in ${daysLeft} day(s)`,
    html: `
      <h2>Hey there!</h2>
      <p>Your product <strong>${product}</strong> will expire in <strong>${daysLeft} day(s)</strong>.</p>
      <p>Expiry Date: ${expiry}</p>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`✅ Email sent to ${to} for ${product}`);
  } catch (error) {
    console.error(`❌ Failed to send email to ${to}:`, error.message);
  }
}

// Main task
async function checkProductsAndNotify() {
  console.log("🔍 Checking products...");
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

// Run once when Render triggers it
checkProductsAndNotify();
