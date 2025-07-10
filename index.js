const admin = require("firebase-admin");
const nodemailer = require("nodemailer");
require("dotenv").config();

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

// Nodemailer (Brevo SMTP) setup
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,       // smtp.gmail.com
  port: process.env.EMAIL_PORT,       // 587
  secure: true,                      // must be false for port 587
  auth: {
    user: process.env.EMAIL_USER,     // your Gmail address
    pass: process.env.EMAIL_PASS,     // your app password
  },
});


transporter.verify(function (error, success) {
  if (error) {
    console.log("❌ SMTP Error:", error);
  } else {
    console.log("✅ SMTP is ready to send messages!");
  }
});



// Utility: Get days until expiry
function getDaysLeft(expiryDateStr) {
  const expiry = new Date(expiryDateStr);
  const now = new Date();
  return Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
}

// Group products by user email
function groupByUser(products) {
  const userMap = {};
  products.forEach((product) => {
    if (!userMap[product.owner]) userMap[product.owner] = [];
    userMap[product.owner].push(product);
  });
  return userMap;
}

// Send grouped email in HTML table
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
    <h3>📦 Expiry Reminder</h3>
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
    <p><i>To stop getting this message, delete the expiring product from your dashboard.</i></p>
  `;

  const mailOptions = {
    from: `"DateX Reminder" <no-reply@solomondev.com>`,
    to,
    subject: `⏰ You have ${products.length} product(s) expiring soon`,
    html,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`✅ Email sent to ${to}`);
  } catch (error) {
    console.error(`❌ Error sending to ${to}:`, error.message);
  }
}

// Main job
async function checkProductsAndNotify() {
  console.log("🔍 Checking for expiring products...");

  const snapshot = await db.collection("products").get();
  const expiringProducts = [];

  snapshot.forEach((doc) => {
    const data = doc.data();

    if (!data.product || !data.expiry || !data.owner || !data.remindBefore) {
      console.warn(`⚠️ Skipping doc ${doc.id}: missing fields`);
      return;
    }

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
}

// ✅ Entry point: only run when file is directly executed
if (require.main === module) {
  checkProductsAndNotify()
    .then(() => {
      console.log("✅ Reminder job finished.");
      process.exit(0);
    })
    .catch((err) => {
      console.error("❌ Job failed:", err);
      process.exit(1);
    });
}
