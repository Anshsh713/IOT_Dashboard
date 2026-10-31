// Requires the x-api-key header on POST when API_KEY is set in the environment
module.exports = (req, res, next) => {
  const key = process.env.API_KEY;
  if (key && req.get("x-api-key") !== key) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }
  next();
};
