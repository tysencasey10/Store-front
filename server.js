const crypto = require("crypto");
const path = require("path");
const express = require("express");
const session = require("express-session");
const mongoose = require("mongoose");
const { faker } = require("@faker-js/faker");
const Product = require("./models/Product");
const User = require("./models/User");
const Order = require("./models/Order");
const Review = require("./models/Review");

const app = express();
const PORT = process.env.PORT || 3001;
const PRODUCT_COUNT = 25;
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/storefront_db";

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    name: "storefront.sid",
    secret: process.env.SESSION_SECRET || "storefront-session-dev-secret",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 },
  })
);

function cartItemCount(sessionCart) {
  if (!sessionCart) return 0;
  return Object.values(sessionCart).reduce((a, b) => a + b, 0);
}

async function buildCartLines(req) {
  const cart = req.session.cart || {};
  const ids = Object.keys(cart);
  const lines = [];
  let total = 0;

  for (const productID of ids) {
    const qty = cart[productID];
    if (qty <= 0) continue;
    const p = await Product.findOne({ productID }).lean();
    if (!p) continue;
    const price = Number(p.price);
    const lineTotal = price * qty;
    total += lineTotal;
    lines.push({
      productID,
      name: p.name,
      price,
      quantity: qty,
      lineTotal,
      stock: typeof p.quantity === "number" ? p.quantity : 0,
      image: p.image,
      description: p.description || "",
    });
  }

  return { lines, total };
}

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/login");
  }
  return next();
}

/**
 * Renders stars in half-star steps. Averages are rounded to the nearest 0.5
 * before mapping to full / half / empty stars (see readme.txt).
 */
function starsFromAverage(avg) {
  if (avg == null || Number.isNaN(Number(avg))) {
    return { display: null, full: 0, half: false, empty: 5 };
  }
  const roundedHalf = Math.round(Number(avg) * 2) / 2;
  const clamped = Math.min(5, Math.max(0, roundedHalf));
  const full = Math.floor(clamped);
  const hasHalf = clamped - full >= 0.5 && full < 5;
  const empty = 5 - full - (hasHalf ? 1 : 0);
  return { display: clamped, full, half: hasHalf, empty };
}

app.use((req, res, next) => {
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  res.locals.cartItemCount = cartItemCount(req.session.cart);
  res.locals.currentUser = req.session.user || null;
  res.locals.starsFromAverage = starsFromAverage;
  next();
});

async function connectDb() {
  await mongoose.connect(MONGODB_URI, {
    serverSelectionTimeoutMS: 8000,
  });
  console.log("Connected to MongoDB");
}

app.get("/", (req, res) => {
  if (!req.session.user) {
    return res.redirect("/login");
  }
  return res.render("index");
});

app.get("/login", (req, res) => {
  if (req.session.user) {
    return res.redirect("/");
  }
  return res.render("login");
});

app.post("/login", async (req, res) => {
  const username = (req.body.username || "").trim();
  if (!username) {
    return res.render("login-error", {
      message: "Please enter a username.",
    });
  }

  const user = await User.findOne({ username }).lean();
  if (!user) {
    return res.render("login-error", {
      message: "Unable to find a user by that username.",
    });
  }

  req.session.user = { username: user.username };
  return res.redirect("/");
});

app.get("/create_user", (req, res) => {
  if (req.session.user) {
    return res.redirect("/");
  }
  return res.render("register");
});

app.post("/create_user", async (req, res) => {
  const username = (req.body.username || "").trim();
  if (!username) {
    return res.render("register-error", {
      message: "Please enter a username.",
    });
  }

  const existing = await User.findOne({ username }).lean();
  if (existing) {
    return res.render("register-error", {
      message: "A user by that username already exists",
    });
  }

  await User.create({ username });
  req.session.user = { username };
  return res.redirect("/");
});

app.post("/logout", requireLogin, (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

app.get("/generate-data", requireLogin, async (_req, res) => {
  const count = PRODUCT_COUNT;
  for (let i = 0; i < count; i += 1) {
    const productID = faker.string.uuid();
    const doc = {
      name: faker.commerce.productName(),
      price: Number(faker.commerce.price()),
      description: faker.lorem.paragraph(),
      productID,
      image: faker.image.url({ width: 320, height: 200 }),
      manufacturer: faker.company.name(),
      quantity: faker.number.int({ min: 1, max: 10 }),
    };

    await Product.replaceOne({ productID: doc.productID }, doc, {
      upsert: true,
    });
  }

  res.render("generate-success", { insertedOrUpdated: count });
});

app.get("/show_catalog", requireLogin, async (_req, res) => {
  const products = await Product.find()
    .sort({ name: 1 })
    .limit(PRODUCT_COUNT)
    .lean();

  const stats = await Review.aggregate([
    {
      $group: {
        _id: "$productID",
        avgRating: { $avg: "$rating" },
        reviewCount: { $sum: 1 },
      },
    },
  ]);

  const statMap = new Map(
    stats.map((s) => [s._id, { avgRating: s.avgRating, reviewCount: s.reviewCount }])
  );

  const productsWithReviews = products.map((p) => {
    const s = statMap.get(p.productID);
    return {
      ...p,
      reviewAvg: s ? s.avgRating : null,
      reviewCount: s ? s.reviewCount : 0,
    };
  });

  res.render("catalog", { products: productsWithReviews });
});

app.post("/cart/add", requireLogin, async (req, res) => {
  const productID = req.body.productID;

  const p = await Product.findOne({ productID }).lean();
  if (!p) {
    req.session.flash = { type: "error", text: "Product not found." };
    return res.redirect("/show_catalog");
  }

  const stock = typeof p.quantity === "number" ? p.quantity : 0;

  if (stock === 0) {
    req.session.flash = { type: "error", text: "Out of stock." };
    return res.redirect("/show_catalog");
  }

  req.session.cart = req.session.cart || {};
  const inCart = req.session.cart[productID] || 0;
  if (inCart + 1 > stock) {
    req.session.flash = {
      type: "error",
      text: `Only ${stock} in stock for "${p.name}".`,
    };
    return res.redirect("/show_catalog");
  }

  req.session.cart[productID] = inCart + 1;
  req.session.flash = { type: "ok", text: `Added "${p.name}" to your cart.` };
  return res.redirect("/show_catalog");
});

app.get("/cart", requireLogin, (_req, res) => {
  res.redirect(302, "/show_cart");
});

app.get("/show_cart", requireLogin, async (req, res) => {
  const { lines, total } = await buildCartLines(req);
  res.render("show_cart", { lines, total });
});

app.post("/cart/remove", requireLogin, (req, res) => {
  const { productID } = req.body;
  if (req.session.cart && req.session.cart[productID]) {
    req.session.cart[productID] -= 1;
    if (req.session.cart[productID] <= 0) {
      delete req.session.cart[productID];
    }
  }
  const back = req.body.returnTo === "checkout" ? "/checkout" : "/show_cart";
  res.redirect(back);
});

app.get("/checkout", requireLogin, async (req, res) => {
  const { lines, total } = await buildCartLines(req);
  const notice = req.session.checkoutNotice || null;
  delete req.session.checkoutNotice;
  res.render("checkout", {
    lines,
    total,
    checkoutNotice: notice,
  });
});

app.post("/checkout", requireLogin, async (req, res) => {
  const cart = req.session.cart || {};
  const productIDs = Object.keys(cart).filter((id) => cart[id] > 0);

  if (productIDs.length === 0) {
    req.session.flash = {
      type: "error",
      text: "Your cart is empty; add something first.",
    };
    return res.redirect("/show_cart");
  }

  const issues = [];
  const itemNames = [];
  let allOk = true;
  const adjusted = { ...cart };
  const purchasedLines = [];

  for (const pid of productIDs) {
    const requested = cart[pid];
    const p = await Product.findOne({ productID: pid });
    if (!p) {
      delete adjusted[pid];
      issues.push("Removed unknown item from your cart.");
      allOk = false;
      continue;
    }
    const stock = typeof p.quantity === "number" ? p.quantity : 0;
    if (requested > stock) {
      allOk = false;
      itemNames.push(p.name);
      if (stock === 0) {
        delete adjusted[pid];
        issues.push(`"${p.name}" is out of stock; removed from your cart.`);
      } else {
        adjusted[pid] = stock;
        issues.push(`"${p.name}": only ${stock} left; your cart was reduced to match.`);
      }
      continue;
    }

    const unitPrice = Number(p.price);
    purchasedLines.push({
      productID: pid,
      name: p.name,
      unitPrice,
      quantity: requested,
      total: unitPrice * requested,
      itemNotes: "",
    });
  }

  if (!allOk) {
    req.session.cart = adjusted;
    req.session.checkoutNotice = {
      summary:
        "We're sorry, there was insufficient quantity for the following items. Quantities in cart have been adjusted and/or items have been removed.",
      itemNames,
      detailLines: issues,
    };
    return res.redirect("/checkout");
  }

  for (const pid of productIDs) {
    const requested = cart[pid];
    await Product.updateOne(
      { productID: pid },
      { $inc: { quantity: -requested } }
    );
  }

  await Order.create({
    orderID: crypto.randomUUID(),
    username: req.session.user.username,
    createdAt: new Date(),
    items: purchasedLines,
    total: purchasedLines.reduce((sum, item) => sum + item.total, 0),
  });

  req.session.cart = {};
  req.session.flash = {
    type: "success",
    text: "Thank you. Inventory is updated and your order was saved.",
  };
  return res.redirect("/checkout");
});

app.get("/past_orders", requireLogin, async (req, res) => {
  const username = req.session.user.username;
  const orders = await Order.find({ username }).sort({ createdAt: -1 }).lean();

  const orderIDs = orders.map((o) => o.orderID);
  const reviews = await Review.find({
    username,
    orderID: { $in: orderIDs },
  }).lean();

  const reviewMap = new Map();
  for (const rev of reviews) {
    reviewMap.set(`${rev.orderID}::${rev.productID}`, rev);
  }

  const ordersWithReviews = orders.map((order) => ({
    ...order,
    items: order.items.map((item) => ({
      ...item,
      review: reviewMap.get(`${order.orderID}::${item.productID}`) || null,
    })),
  }));

  res.render("past_orders", { orders: ordersWithReviews });
});

app.post("/past_orders/review", requireLogin, async (req, res) => {
  const orderID = (req.body.orderID || "").trim();
  const productID = (req.body.productID || "").trim();
  const ratingRaw = req.body.rating;
  const reviewText = (req.body.reviewText || "").trim();

  const rating = parseInt(String(ratingRaw), 10);
  if (!orderID || !productID || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    req.session.flash = { type: "error", text: "Please choose a rating from 1 to 5." };
    return res.redirect("/past_orders");
  }

  const order = await Order.findOne({
    orderID,
    username: req.session.user.username,
  }).lean();

  if (!order) {
    req.session.flash = { type: "error", text: "Order not found." };
    return res.redirect("/past_orders");
  }

  const line = order.items.find((i) => i.productID === productID);
  if (!line) {
    req.session.flash = { type: "error", text: "That item is not part of this order." };
    return res.redirect("/past_orders");
  }

  try {
    await Review.create({
      orderID,
      productID,
      username: req.session.user.username,
      rating,
      reviewText: reviewText.slice(0, 4000),
    });
  } catch (err) {
    if (err && err.code === 11000) {
      req.session.flash = {
        type: "error",
        text: "This item already has a review for this order.",
      };
      return res.redirect("/past_orders");
    }
    throw err;
  }

  return res.redirect("/past_orders");
});

connectDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Storefront listening on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Failed to start:", err);
    console.error(
      "\nCould not reach MongoDB. Start MongoDB locally, or set MONGODB_URI to your Atlas (or other) connection string.\n"
    );
    process.exit(1);
  });
