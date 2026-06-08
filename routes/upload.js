const express = require("express");
const multer = require("multer");
const cloudinary = require("../config/cloudinary");

// Pre-generated at upload time — on-the-fly transforms are not allowed on authenticated assets
const EAGER_TRANSFORMATION = [{ width: 1200, height: 1200, crop: "limit", quality: "auto" }];

// Signed URL expires 2h beyond the 24h message TTL so images are always accessible
// while the message exists. The Cloudinary cleanup cron deletes assets at the 23h mark anyway.
const SIGNED_URL_TTL_SECONDS = 26 * 60 * 60;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only images are allowed"));
    }
    cb(null, true);
  },
});

const router = express.Router();

router.post("/", upload.single("image"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No image provided" });

  try {
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: "watch-together",
          type: "authenticated",
          eager: EAGER_TRANSFORMATION,
          eager_async: false,
        },
        (err, data) => (err ? reject(err) : resolve(data))
      );
      stream.end(req.file.buffer);
    });

    const expiresAt = Math.floor(Date.now() / 1000) + SIGNED_URL_TTL_SECONDS;
    const signedUrl = cloudinary.url(result.public_id, {
      sign_url: true,
      type: "authenticated",
      transformation: EAGER_TRANSFORMATION,
      expires_at: expiresAt,
      secure: true,
      format: result.format,
      version: result.version,
    });

    res.json({ url: signedUrl });
  } catch (err) {
    console.error("[Cloudinary] Upload error:", err);
    res.status(500).json({ error: "Upload failed" });
  }
});

module.exports = router;
