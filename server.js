const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8080;

const root = __dirname;

// Serve static assets from repo
app.use(express.static(root, { extensions: ["html"] }));

// Convenience routes (adjust as your structure grows)
app.get("/", (req, res) => {
  // Default landing: customer storefront (change if you want)
  res.redirect("/apps/storefront/");
});

app.get("/apps/admin", (req, res) => res.redirect("/apps/admin/"));
app.get("/apps/dealer", (req, res) => res.redirect("/apps/dealer/"));
app.get("/apps/storefront", (req, res) => res.redirect("/apps/storefront/"));

// If folders exist, serve their index.html
app.get("/apps/admin/", (req, res) => res.sendFile(path.join(root, "apps", "admin", "index.html")));
app.get("/apps/dealer/", (req, res) => res.sendFile(path.join(root, "apps", "dealer", "index.html")));
app.get("/apps/storefront/", (req, res) => res.sendFile(path.join(root, "apps", "storefront", "index.html")));

// SPA-friendly fallback: if you later add routing, keep this.
app.use((req, res) => res.status(404).send("Not Found"));

app.listen(PORT, () => console.log(`carsalessaas running on :${PORT}`));
