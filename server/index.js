import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import { Storage } from "@google-cloud/storage";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import path from "path";
import crypto from "crypto";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
const GCS_BUCKET = process.env.GCS_BUCKET || "samplebucket1";
const GCS_PUBLIC_BASE = process.env.GCS_PUBLIC_BASE || "https://storage.googleapis.com";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "db.json");

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
if (!existsSync(DB_PATH)) {
  writeFileSync(DB_PATH, JSON.stringify({ dealers: {} }, null, 2), "utf-8");
}

function loadDb() {
  return JSON.parse(readFileSync(DB_PATH, "utf-8"));
}
function saveDb(db) {
  writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf-8");
}

function nowIso() {
  return new Date().toISOString();
}

function requireAuth(req, res, next) {
  const token = (req.headers.authorization || "").replace("Bearer ", "").trim();
  if (!token) return res.status(401).json({ error: "Missing token" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    return next();
  } catch (e) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

function requireDealerScope(req, res, next) {
  const dealerId = req.params.dealerId;
  if (!req.user || req.user.dealerId !== dealerId) {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}

function makeVehicleId() {
  return "veh_" + crypto.randomBytes(6).toString("hex");
}

const storage = new Storage(); // uses GOOGLE_APPLICATION_CREDENTIALS in env (recommended)
const bucket = storage.bucket(GCS_BUCKET);

/** ---------------- AUTH ---------------- **/
app.post("/api/auth/login", (req, res) => {
  const { dealerId, pin } = req.body || {};
  if (!dealerId || !pin) return res.status(400).json({ error: "dealerId and pin required" });

  const db = loadDb();
  const dealer = db.dealers?.[dealerId];
  if (!dealer || dealer.pin !== String(pin)) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = jwt.sign(
    { dealerId: dealer.dealerId, name: dealer.name },
    JWT_SECRET,
    { expiresIn: "8h" }
  );

  res.json({ token, dealer: { dealerId: dealer.dealerId, name: dealer.name } });
});

/** ---------------- DEALER: VEHICLES ---------------- **/
app.get("/api/dealers/:dealerId/vehicles", requireAuth, requireDealerScope, (req, res) => {
  const db = loadDb();
  const dealer = db.dealers?.[req.params.dealerId];
  const vehicles = Object.values(dealer?.vehicles || {});
  res.json({ vehicles });
});

app.post("/api/dealers/:dealerId/vehicles", requireAuth, requireDealerScope, (req, res) => {
  const { title, make, model, year, price, status, notes } = req.body || {};

  const db = loadDb();
  const dealer = db.dealers?.[req.params.dealerId];
  if (!dealer) return res.status(404).json({ error: "Dealer not found" });

  const vehicleId = makeVehicleId();
  const vehicle = {
    vehicleId,
    dealerId: dealer.dealerId,
    title: title || "",
    make: make || "",
    model: model || "",
    year: Number(year) || null,
    price: Number(price) || 0,
    status: status || "Draft",
    notes: notes || "",
    media: { images: [], videos: [] },
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  dealer.vehicles = dealer.vehicles || {};
  dealer.vehicles[vehicleId] = vehicle;

  saveDb(db);
  res.json({ vehicle });
});

app.patch("/api/dealers/:dealerId/vehicles/:vehicleId", requireAuth, requireDealerScope, (req, res) => {
  const db = loadDb();
  const dealer = db.dealers?.[req.params.dealerId];
  const v = dealer?.vehicles?.[req.params.vehicleId];
  if (!v) return res.status(404).json({ error: "Vehicle not found" });

  const patch = req.body || {};
  const allowed = ["title", "make", "model", "year", "price", "status", "notes", "media"];
  for (const k of allowed) {
    if (k in patch) v[k] = patch[k];
  }
  v.updatedAt = nowIso();

  saveDb(db);
  res.json({ vehicle: v });
});

/** ---------------- DEALER: LOGS (stub) ---------------- **/
app.get("/api/dealers/:dealerId/logs", requireAuth, requireDealerScope, (req, res) => {
  const db = loadDb();
  const dealer = db.dealers?.[req.params.dealerId];
  res.json({ logs: dealer?.logs || [] });
});

/** ---------------- SIGNED UPLOAD URL ---------------- **/
app.post("/api/dealers/:dealerId/vehicles/:vehicleId/uploads/sign", requireAuth, requireDealerScope, async (req, res) => {
  const { type, filename, contentType } = req.body || {};
  const dealerId = req.params.dealerId;
  const vehicleId = req.params.vehicleId;

  if (!type || !filename || !contentType) {
    return res.status(400).json({ error: "type, filename, contentType required" });
  }

  if (!["image", "video"].includes(type)) {
    return res.status(400).json({ error: "type must be image or video" });
  }

  const safeName = filename.replace(/[^\w.\-]+/g, "_");
  const folder = type === "image" ? "images/original" : "videos/original";
  const objectKey = `dealers/${dealerId}/vehicles/${vehicleId}/${folder}/${Date.now()}_${safeName}`;

  try {
    const file = bucket.file(objectKey);
    const [url] = await file.getSignedUrl({
      version: "v4",
      action: "write",
      expires: Date.now() + 10 * 60 * 1000, // 10 min
      contentType
    });

    const publicUrl = `${GCS_PUBLIC_BASE}/${GCS_BUCKET}/${objectKey}`;
    res.json({ url, objectKey, publicUrl });
  } catch (e) {
    res.status(500).json({ error: "Failed to sign upload", details: e?.message || String(e) });
  }
});

/** ---------------- PUBLIC: INVENTORY ---------------- **/
app.get("/api/public/vehicles", (req, res) => {
  const { dealerId } = req.query || {};
  const db = loadDb();

  let vehicles = [];
  if (dealerId) {
    const dealer = db.dealers?.[dealerId];
    vehicles = Object.values(dealer?.vehicles || {});
  } else {
    // all dealers
    for (const d of Object.values(db.dealers || {})) {
      vehicles.push(...Object.values(d.vehicles || {}));
    }
  }

  // only published in public storefront
  vehicles = vehicles.filter(v => String(v.status).toLowerCase() === "published");

  res.json({ vehicles });
});

app.get("/health", (_, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
  console.log(`Bucket: ${GCS_BUCKET}`);
});
