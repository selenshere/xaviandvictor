import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { google } from "googleapis";
import { Readable } from "stream";

const app = express();
app.use(express.json({ limit: "2mb" }));

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
  methods: ["GET","POST","OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));
app.options("*", cors());

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const client = new OpenAI({ apiKey: OPENAI_API_KEY });

function extractDriveId(value) {
  if (!value) return "";
  const s = String(value).trim();
  const m = s.match(/folders\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : s;
}
const DRIVE_FOLDER_ID = extractDriveId(process.env.DRIVE_FOLDER_ID);

function getServiceAccountJson() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64;

  if (raw) return JSON.parse(raw);
  if (b64) return JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_JSON_BASE64");
}

function getDriveClient() {
  const sa = getServiceAccountJson();
  const auth = new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ["https://www.googleapis.com/auth/drive.file"]
  });
  return google.drive({ version: "v3", auth });
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
        { role: "developer", content: systemPrompt },
        ...messages.map(m => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: String(m.text || "")
        }))
      ],
      temperature: 0.7
    });

    res.json({ reply: completion.choices?.[0]?.message?.content ?? "", ts: new Date().toISOString() });
  } catch (err) {
    console.error("CHAT ERROR:", err?.response?.data || err);
    res.status(500).json({ error: "chat_failed", detail: err?.response?.data?.error?.message || err?.message || String(err) });
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

    const drive = getDriveClient();

    // verify folder exists
    try {
      await drive.files.get({ fileId: DRIVE_FOLDER_ID, fields: "id,name" });
    } catch {
      return res.status(500).json({
        error: "save_failed",
        detail: "Folder not found OR not shared with service account. Set DRIVE_FOLDER_ID to ONLY the folder id (or a full folders/<id> URL)."
      });
    }

    const content = JSON.stringify(payload, null, 2);
    const media = { mimeType: "application/json", body: Readable.from([content]) };

    const file = await drive.files.create({
      requestBody: { name: fileName, parents: [DRIVE_FOLDER_ID], mimeType: "application/json" },
      media,
      fields: "id,name"
    });

    res.json({ ok: true, fileId: file.data.id, fileName: file.data.name });
  } catch (err) {
    console.error("SAVE ERROR:", err?.response?.data || err);
    res.status(500).json({ error: "save_failed", detail: err?.response?.data?.error?.message || err?.message || String(err) });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("Server running on", PORT));
