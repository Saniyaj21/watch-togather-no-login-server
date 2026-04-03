/**
 * Simple per-socket rate limiter.
 * Returns a function that returns true if the event should be allowed.
 */
function createSocketRateLimiter(maxPerWindow, windowMs) {
  const counters = new Map();

  return (socketId) => {
    const now = Date.now();
    let entry = counters.get(socketId);

    if (!entry || now - entry.start > windowMs) {
      entry = { start: now, count: 0 };
      counters.set(socketId, entry);
    }

    entry.count++;
    if (entry.count > maxPerWindow) return false;
    return true;
  };
}

// Chat: max 10 messages per 10 seconds
const chatLimiter = createSocketRateLimiter(10, 10000);

// Video control: max 20 events per 10 seconds
const videoLimiter = createSocketRateLimiter(20, 10000);

// Pagination: max 10 requests per 60 seconds
const paginationLimiter = createSocketRateLimiter(10, 60000);

module.exports = { chatLimiter, videoLimiter, paginationLimiter };
