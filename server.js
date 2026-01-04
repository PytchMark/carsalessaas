const express = require("express");
const path = require("path");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { Storage } = require("@google-cloud/storage");

const app = express();
const PORT = process.env.PORT || 8080;
const root = __dirname;

// ========= Config (ENV VARS) =========
// For demo/test you asked:
// admin username/password can be env vars, with fallbacks for local testing
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "adminpytch";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "123456";

// JWT secret MUST be set in Cloud Run (Secret Manager recommended)
// If you don't set it, it will generate one at runtime (tokens break on restart)
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex");

// Your bucket name
const MEDIA_BUCKET = process.env.MEDIA_BUCKET || "samplemedia1";

// Signed URL expiration (seconds)
const SIGNED_URL_TTL_SECONDS = Number(process.env.SIGNED_URL_TTL_SECONDS || 10 * 60); // 10 mins

// ========= Middleware =========
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.removeHeader("Accept-CH");
  res.removeHeader("Critical-CH");
  next();
});

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// Serve static from repo root
app.use(express.static(root, { extensions: ["html"] }));

// ========= In-memory MVP store (replace with Firestore later) =========
/**
 * dealers map:
 * dealerId -> {
 *   dealerId,
 *   name,
 *   passcode,   // MVP plaintext. Replace with hashing ASAP.
 *   createdAt
 * }
 */
const dealers = new Map();

// Seed a demo dealer so you can test immediately
// dealer login “dealerpytch / 123456” (as requested)
dealers.set("dealerpytch", {
  dealerId: "dealerpytch",
  name: "Demo Dealer",
  passcode: "123456",
  createdAt: new Date().toISOString(),
});

// ========= Auth helpers =========
function issueToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "12h" });
}

function requireAdmin(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ ok: false, error: "Missing token" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== "admin") return res.status(403).json({ ok: false, error: "Admin only" });
    req.user = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ ok: false, error: "Invalid/expired token" });
  }
}

function requireDealer(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ ok: false, error: "Missing token" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== "dealer") return res.status(403).json({ ok: false, error: "Dealer only" });
    req.user = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ ok: false, error: "Invalid/expired token" });
  }
}

// ========= Cloud Storage =========
const storage = new Storage();

// Ensure object paths are consistent
function buildObjectPath({ dealerId, vehicleId, kind, filename }) {
  // kind examples: "photos", "videos", "viewings"
  const safeKind = (kind || "photos").replace(/[^a-zA-Z0-9_-]/g, "");
  const safeDealer = String(dealerId || "").replace(/[^a-zA-Z0-9_-]/g, "");
  const safeVehicle = String(vehicleId || "").replace(/[^a-zA-Z0-9_-]/g, "");
  const safeName = String(filename || "").replace(/[^a-zA-Z0-9._-]/g, "");
  return `dealers/${safeDealer}/vehicles/${safeVehicle}/${safeKind}/${Date.now()}_${safeName}`;
}

// ========= API =========

// Health check (nice for Cloud Run)
app.get("/healthz", (req, res) => res.status(200).send("ok"));

// --- Admin login ---
app.post("/api/admin/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ ok: false, error: "username + password required" });
  }
  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ ok: false, error: "invalid credentials" });
  }

  const token = issueToken({ role: "admin", username });
  return res.json({ ok: true, token });
});

// --- Dealer login (so dealer portal can authenticate too) ---
app.post("/api/dealer/login", (req, res) => {
  const { dealerId, passcode } = req.body || {};
  if (!dealerId || !passcode) {
    return res.status(400).json({ ok: false, error: "dealerId + passcode required" });
  }

  const dealer = dealers.get(dealerId);
  if (!dealer || dealer.passcode !== passcode) {
    return res.status(401).json({ ok: false, error: "invalid dealer credentials" });
  }

  const token = issueToken({ role: "dealer", dealerId });
  return res.json({ ok: true, token, dealer: { dealerId: dealer.dealerId, name: dealer.name } });
});

// --- Dealers: list ---
app.get("/api/admin/dealers", requireAdmin, (req, res) => {
  const list = Array.from(dealers.values()).map(d => ({
    dealerId: d.dealerId,
    name: d.name,
    createdAt: d.createdAt,
  }));
  res.json({ ok: true, dealers: list });
});

// --- Dealers: create ---
app.post("/api/admin/dealers", requireAdmin, (req, res) => {
  const { dealerId, name, passcode } = req.body || {};
  if (!dealerId || !passcode) {
    return res.status(400).json({ ok: false, error: "dealerId + passcode required" });
  }
  if (dealers.has(dealerId)) {
    return res.status(409).json({ ok: false, error: "dealer already exists" });
  }

  const rec = {
    dealerId,
    name: name || dealerId,
    passcode,
    createdAt: new Date().toISOString(),
  };
  dealers.set(dealerId, rec);

  res.json({ ok: true, dealer: { dealerId: rec.dealerId, name: rec.name, createdAt: rec.createdAt } });
});

// --- Reset dealer passcode ---
app.post("/api/admin/reset-passcode", requireAdmin, (req, res) => {
  const { dealerId, newPasscode } = req.body || {};
  if (!dealerId || !newPasscode) {
    return res.status(400).json({ ok: false, error: "dealerId + newPasscode required" });
  }
  const dealer = dealers.get(dealerId);
  if (!dealer) return res.status(404).json({ ok: false, error: "dealer not found" });

  dealer.passcode = newPasscode;
  dealers.set(dealerId, dealer);

  res.json({ ok: true });
});

// --- Signed upload URL (BEST for Cloud Run) ---
// Dealer requests a signed URL, then the browser uploads directly to GCS.
// Body: { vehicleId, kind, filename, contentType }
app.post("/api/dealer/upload-url", requireDealer, async (req, res) => {
  try {
    const dealerId = req.user.dealerId;
    const { vehicleId, kind, filename, contentType } = req.body || {};

    if (!vehicleId || !filename || !contentType) {
      return res.status(400).json({ ok: false, error: "vehicleId + filename + contentType required" });
    }

    const objectPath = buildObjectPath({ dealerId, vehicleId, kind, filename });
    const bucket = storage.bucket(MEDIA_BUCKET);
    const file = bucket.file(objectPath);

    const expires = Date.now() + SIGNED_URL_TTL_SECONDS * 1000;

    // v4 signed URL for PUT upload
    const [url] = await file.getSignedUrl({
      version: "v4",
      action: "write",
      expires,
      contentType,
    });

    // Public URL (if your bucket is private, you'll serve via signed READ URLs later)
    const gcsUri = `gs://${MEDIA_BUCKET}/${objectPath}`;

    res.json({
      ok: true,
      upload: {
        url,
        method: "PUT",
        headers: { "Content-Type": contentType },
        objectPath,
        gcsUri,
      },
    });
  } catch (err) {
    console.error("upload-url error", err);
    res.status(500).json({ ok: false, error: "failed to create signed url" });
  }
});

// (Optional) Signed READ URL for private bucket browsing later
// Query: ?objectPath=dealers/.../file.jpg
app.get("/api/media/read-url", requireDealer, async (req, res) => {
  try {
    const objectPath = req.query.objectPath;
    if (!objectPath) return res.status(400).json({ ok: false, error: "objectPath required" });

    // Simple safety: dealer can only read within their own prefix
    const dealerPrefix = `dealers/${req.user.dealerId}/`;
    if (!String(objectPath).startsWith(dealerPrefix)) {
      return res.status(403).json({ ok: false, error: "not allowed" });
    }

    const bucket = storage.bucket(MEDIA_BUCKET);
    const file = bucket.file(objectPath);
    const expires = Date.now() + SIGNED_URL_TTL_SECONDS * 1000;

    const [url] = await file.getSignedUrl({
      version: "v4",
      action: "read",
      expires,
    });

    res.json({ ok: true, url });
  } catch (err) {
    console.error("read-url error", err);
    res.status(500).json({ ok: false, error: "failed to create read url" });
  }
});

// ========= App routes (NO redirects, slash or no slash) =========
function serveAppIndex(appName) {
  return (req, res) => res.sendFile(path.join(root, "apps", appName, "index.html"));
}

app.get("/", serveAppIndex("storefront"));
app.get(["/apps/storefront", "/apps/storefront/"], serveAppIndex("storefront"));
app.get(["/apps/admin", "/apps/admin/"], serveAppIndex("admin"));
app.get(["/apps/dealer", "/apps/dealer/"], serveAppIndex("dealer"));

// 404
app.use((req, res) => res.status(404).send("Not Found"));

app.listen(PORT, () => console.log(`carsalessaas running on :${PORT}`));

