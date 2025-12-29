import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { google } from "googleapis";
import { Readable } from "stream";

const app = express();
app.use(express.json({ limit: "2mb" }));

// CORS
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.length === 0) return cb(null, true);
    return cb(null, ALLOWED_ORIGINS.includes(origin));
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));
app.options("*", cors());

// OpenAI
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const client = new OpenAI({ apiKey: OPENAI_API_KEY });

// Drive (OAuth)
function extractDriveId(value) {
  if (!value) return "";
  let s = String(value).trim();
  const m = s.match(/folders\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  s = s.split("?")[0].split("&")[0].trim();
  return s;
}
const DRIVE_FOLDER_ID = extractDriveId(process.env.DRIVE_FOLDER_ID);

function getDriveClientOAuth() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Missing GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / GOOGLE_OAUTH_REFRESH_TOKEN");
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });

  return google.drive({ version: "v3", auth: oauth2 });
}

function safeFilePart(s) {
  return String(s || "")
    .trim()
    .replace(/[^À-ɏ\w\- ]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 60);
}

app.get("/health", (req, res) => res.json({ ok: true }));

app.post("/api/chat", async (req, res) => {
  try {
    const { systemPrompt, messages } = req.body || {};
    if (!OPENAI_API_KEY) return res.status(500).json({ error: "OPENAI_API_KEY missing" });
    if (!systemPrompt) return res.status(400).json({ error: "systemPrompt missing" });
    if (!Array.isArray(messages)) return res.status(400).json({ error: "messages missing" });

    const completion = await client.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        // ✅ persona kilidi
        { role: "system", content: systemPrompt },
        ...messages.map(m => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: String(m.text || "")
        }))
      ],
      temperature: 0.3
    });

    res.json({ reply: completion.choices?.[0]?.message?.content ?? "", ts: new Date().toISOString() });
  } catch (err) {
    console.error("CHAT ERROR:", err);
    res.status(500).json({ error: "chat_failed", detail: err?.message || String(err) });
  }
});

app.post("/api/save", async (req, res) => {
  try {
    const payload = req.body || {};
    const { user, sessionId, savedAt } = payload;

    if (!DRIVE_FOLDER_ID) return res.status(500).json({ error: "DRIVE_FOLDER_ID missing_or_invalid" });
    if (!sessionId) return res.status(400).json({ error: "sessionId missing" });
    if (!user?.firstName || !user?.lastName) return res.status(400).json({ error: "user missing" });

    const first = safeFilePart(user.firstName);
    const last = safeFilePart(user.lastName);
    const stamp = safeFilePart((savedAt || new Date().toISOString()).replace(/[:.]/g, "-"));
    const fileName = `${first}_${last}_${stamp}_${sessionId}.json`;

    const drive = getDriveClientOAuth();

    // klasör erişimi kontrol
    await drive.files.get({
      fileId: DRIVE_FOLDER_ID,
      fields: "id,name"
    });

    const content = JSON.stringify(payload, null, 2);
    const media = { mimeType: "application/json", body: Readable.from([content]) };

    const file = await drive.files.create({
      requestBody: { name: fileName, parents: [DRIVE_FOLDER_ID], mimeType: "application/json" },
      media,
      fields: "id,name"
    });

    res.json({ ok: true, fileId: file.data.id, fileName: file.data.name });
  } catch (err) {
    console.error("SAVE ERROR:", err);
    res.status(500).json({ error: "save_failed", detail: err?.message || String(err) });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("Server running on", PORT));
