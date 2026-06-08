const cloudinary = require("../config/cloudinary");
const Message = require("../models/Message");

function extractPublicId(url) {
  try {
    // Matches both legacy /upload/ URLs and new /authenticated/ signed URLs.
    // Public IDs are always under the watch-together/ folder.
    const match = url.match(/(watch-together\/[^.?/]+)\.[a-zA-Z0-9]+/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

async function deleteCloudinaryImages(publicIds) {
  for (let i = 0; i < publicIds.length; i += 100) {
    const batch = publicIds.slice(i, i + 100);
    // Delete authenticated assets (new) and upload assets (legacy) in one pass.
    // delete_resources returns { not found } for wrong-type assets rather than throwing.
    await cloudinary.api.delete_resources(batch, { type: "authenticated", invalidate: true });
    await cloudinary.api.delete_resources(batch, { type: "upload", invalidate: true });
    console.log(`[Cleanup] Deleted ${batch.length} Cloudinary image(s)`);
  }
}

// Called immediately when a message with an image is manually deleted.
// Stamps imageCleanedAt only after confirmed deletion so the cron can retry on failure.
async function deleteImageForMessage(imageUrl, messageId = null) {
  if (!imageUrl) return;
  const publicId = extractPublicId(imageUrl);
  if (!publicId) return;
  try {
    // Both calls are needed to handle the transition from public upload assets to
    // authenticated assets. destroy() resolves with { result: "not found" } for the
    // wrong type rather than throwing, so both calls are always safe.
    await cloudinary.uploader.destroy(publicId, { type: "authenticated", invalidate: true });
    await cloudinary.uploader.destroy(publicId, { type: "upload", invalidate: true });
    if (messageId) {
      await Message.findByIdAndUpdate(messageId, { imageCleanedAt: new Date() });
    }
  } catch (err) {
    console.error("[Cleanup] Failed to delete Cloudinary image:", err.message);
  }
}

// Hourly sweep — finds messages with images that have been cleaned already
// (imageCleanedAt is null) and are older than 23h, to beat MongoDB TTL at 24h
async function cleanupExpiredImages() {
  try {
    const cutoff = new Date(Date.now() - 23 * 60 * 60 * 1000);

    const messages = await Message.find({
      imageUrl: { $ne: null },
      imageCleanedAt: null,
      createdAt: { $lt: cutoff },
    }).lean();

    if (!messages.length) return;

    const publicIds = messages.map((m) => extractPublicId(m.imageUrl)).filter(Boolean);
    if (!publicIds.length) return;

    await deleteCloudinaryImages(publicIds);

    // Mark as cleaned so subsequent hourly runs skip them
    await Message.updateMany(
      { _id: { $in: messages.map((m) => m._id) } },
      { imageCleanedAt: new Date() }
    );
  } catch (err) {
    console.error("[Cleanup] Image cleanup error:", err.message);
  }
}

function startImageCleanup() {
  cleanupExpiredImages();
  setInterval(cleanupExpiredImages, 60 * 60 * 1000);
}

module.exports = { startImageCleanup, deleteImageForMessage };
