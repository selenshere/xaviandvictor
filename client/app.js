// =============================
// 1) AYARLAR (sen düzenle)
// =============================

// Render backend URL'ini buraya koy (prod):
// ör: https://my-chatbot-api.onrender.com
const API_BASE =
  (location.hostname === "localhost")
    ? "http://localhost:8080"
    : "https://YOUR-RENDER-APP.onrender.com";

// Senin hazır prompt'unu buraya yapıştır (developer/system instruction).
// Kullanıcı bunu görmez; sadece modele giden "instructions".
const SYSTEM_PROMPT = `
BURAYA HAZIR PROMPTUNU COPY-PASTE YAP
`.trim();

// İstersen instruction/task metnini buradan yönetebilirsin:
const UI_INSTRUCTION_TEXT = `Lütfen görevi okuyup sağdaki sohbetten devam edin.`;
const TASK_HTML = `
  <p><strong>Görev:</strong> Buraya task metnini koy.</p>
  <ul>
    <li>Madde 1</li>
    <li>Madde 2</li>
  </ul>
`;

// =============================
// 2) STATE
// =============================
function getSessionId() {
  let sid = localStorage.getItem("session_id");
  if (!sid) {
    sid = crypto.randomUUID();
    localStorage.setItem("session_id", sid);
  }
  return sid;
}

const state = {
  sessionId: getSessionId(),
  startedAt: new Date().toISOString(),
  firstName: localStorage.getItem("firstName") || "",
  lastName: localStorage.getItem("lastName") || "",
  messages: [] // { role: 'user'|'assistant', text, ts }
};

// =============================
// 3) UI
// =============================
const elFirst = document.getElementById("firstName");
const elLast = document.getElementById("lastName");
const elChat = document.getElementById("chat");
const elMsg = document.getElementById("msg");
const elComposer = document.getElementById("composer");
const elSave = document.getElementById("saveBtn");
const elNew = document.getElementById("newBtn");
const elInstruction = document.getElementById("instructionBox");
const elTask = document.getElementById("taskBox");

elInstruction.innerHTML = `<strong>Instruction:</strong> ${UI_INSTRUCTION_TEXT}`;
elTask.innerHTML = TASK_HTML;

elFirst.value = state.firstName;
elLast.value = state.lastName;

elFirst.addEventListener("input", () => {
  state.firstName = elFirst.value.trim();
  localStorage.setItem("firstName", state.firstName);
});
elLast.addEventListener("input", () => {
  state.lastName = elLast.value.trim();
  localStorage.setItem("lastName", state.lastName);
});

function render() {
  elChat.innerHTML = "";
  for (const m of state.messages) {
    const wrap = document.createElement("div");
    wrap.className = `bubble ${m.role === "user" ? "user" : "bot"}`;
    wrap.textContent = m.text;

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = new Date(m.ts).toLocaleString("tr-TR");

    const container = document.createElement("div");
    container.appendChild(wrap);
    container.appendChild(meta);
    elChat.appendChild(container);
  }
  elChat.scrollTop = elChat.scrollHeight;
}

function requireName() {
  if (!state.firstName || !state.lastName) {
    alert("Lütfen önce isim ve soyisim girin.");
    return false;
  }
  return true;
}

function addMessage(role, text) {
  state.messages.push({ role, text, ts: new Date().toISOString() });
  render();
}

async function callChat() {
  const payload = {
    sessionId: state.sessionId,
    user: { firstName: state.firstName, lastName: state.lastName },
    systemPrompt: SYSTEM_PROMPT,
    messages: state.messages
  };

  const res = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Chat API error: ${res.status} ${txt}`);
  }

  return await res.json(); // { reply, ts }
}

// =============================
// 4) EVENTS
// =============================
elComposer.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!requireName()) return;

  const text = elMsg.value.trim();
  if (!text) return;

  elMsg.value = "";
  addMessage("user", text);

  // typing...
  const typingId = crypto.randomUUID();
  state.messages.push({ role: "assistant", text: "…", ts: new Date().toISOString(), _tmp: typingId });
  render();

  try {
    const data = await callChat();
    state.messages = state.messages.filter(m => m._tmp !== typingId);
    addMessage("assistant", data.reply);
  } catch (err) {
    state.messages = state.messages.filter(m => m._tmp !== typingId);
    addMessage("assistant", "Bir hata oluştu. Lütfen tekrar deneyin.");
    console.error(err);
  }
});

elSave.addEventListener("click", async () => {
  if (!requireName()) return;

  const payload = {
    sessionId: state.sessionId,
    startedAt: state.startedAt,
    savedAt: new Date().toISOString(),
    user: { firstName: state.firstName, lastName: state.lastName },
    messages: state.messages,
    userAgent: navigator.userAgent,
    pageUrl: location.href
  };

  try {
    const res = await fetch(`${API_BASE}/api/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Save API error: ${res.status} ${txt}`);
    }

    const data = await res.json(); // { ok:true, fileId, fileName }
    alert(`Kaydedildi ✅\nDosya: ${data.fileName}`);
  } catch (err) {
    console.error(err);
    alert("Kaydetme sırasında hata oldu.");
  }
});

elNew.addEventListener("click", () => {
  if (!confirm("Yeni bir oturum başlatılsın mı? (Eski mesajlar silinir)")) return;
  state.sessionId = crypto.randomUUID();
  localStorage.setItem("session_id", state.sessionId);
  state.startedAt = new Date().toISOString();
  state.messages = [];
  render();
});

render();
