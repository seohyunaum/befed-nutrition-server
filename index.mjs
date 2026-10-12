import { createApp } from "./app.mjs";
const port = Number(process.env.PORT || 3001);
createApp({ apiKey: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL || "gemini-3.1-flash-lite" }).listen(port, "0.0.0.0", () => {
  console.log(`Nutrition server running on port ${port}`);
  if (!process.env.GEMINI_API_KEY) console.log("Set GEMINI_API_KEY in server/.env.local to enable estimates.");
});
