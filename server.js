const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");

const PORT = 5173;
const certDir = path.join(__dirname, "certs");
const keyPath = path.join(certDir, "localhost-key.pem");
const certPath = path.join(certDir, "localhost.pem");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml"
};

const readFileSafe = (filePath) => {
  try {
    return fs.readFileSync(filePath);
  } catch {
    return null;
  }
};

const serveFile = (req, res) => {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  const safePath = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = path.join(__dirname, safePath);

  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  const fileBuffer = readFileSafe(filePath);
  if (!fileBuffer) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes[ext] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": contentType });
  res.end(fileBuffer);
};

if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
  console.error("Missing HTTPS certs.");
  console.error("Generate them with mkcert into ./certs:");
  console.error(
    "mkcert -key-file certs/localhost-key.pem -cert-file certs/localhost.pem localhost 127.0.0.1 ::1"
  );
  process.exit(1);
}

https
  .createServer(
    {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath)
    },
    serveFile
  )
  .listen(PORT, () => {
    console.log(`HTTPS server running at https://localhost:${PORT}/`);
  });
