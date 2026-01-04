const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8080;

const root = __dirname;

// (0) Body parsing for APIs (needed next)
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// (1) Avoid Chrome ERR_TOO_MANY_ACCEPT_CH_RESTARTS style issues
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.removeHeader("Accept-CH");
  res.removeHeader("Critical-CH");
  next();
});

// (2) Static files
app.use(express.static(root, { extensions: ["html"] }));

// Optional: ignore favicon 404 spam
app.get("/favicon.ico", (req, res) => res.status(204).end());

// Helper to serve app index files consistently (no trailing slash required)
function serveAppIndex(appName) {
  return (req, res) =>
    res.sendFile(path.join(root, "apps", appName, "index.html"));
}

// Default landing (no redirect)
app.get("/", serveAppIndex("storefront"));

// Serve BOTH with and without trailing slash (no redirects)
app.get(["/apps/storefront", "/apps/storefront/"], serveAppIndex("storefront"));
app.get(["/apps/admin", "/apps/admin/"], serveAppIndex("admin"));
app.get(["/apps/dealer", "/apps/dealer/"], serveAppIndex("dealer"));

// 404
app.use((req, res) => res.status(404).send("Not Found"));

app.listen(PORT, () => console.log(`carsalessaas running on :${PORT}`));

