const cloudinary = require("../config/cloudinary");
const Message = require("../models/Message");

function extractPublicId(url) {
  try {
    const match = url.match(/\/upload\/(?:v\d+\/)?(.+)\.[a-z]+$/i);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

async function deleteCloudinaryImages(publicIds) {
  for (let i = 0; i < publicIds.length; i += 100) {
    const batch = publicIds.slice(i, i + 100);
    await cloudinary.api.delete_resources(batch, { invalidate: true });
    console.log(`[Cleanup] Deleted ${batch.length} Cloudinary image(s)`);
  }
}

// Called immediately when a message with an image is manually deleted
async function deleteImageForMessage(imageUrl) {
  if (!imageUrl) return;
  const publicId = extractPublicId(imageUrl);
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId, { invalidate: true });
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
