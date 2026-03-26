const crypto = require("crypto");

const generateRoomId = () => {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
};

module.exports = generateRoomId;
