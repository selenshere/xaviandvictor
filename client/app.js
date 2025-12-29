const API_BASE =
  (location.hostname === "localhost")
    ? "http://localhost:8080"
    : "https://xaviandvictor.onrender.com";

// Senin hazır prompt'unu buraya yapıştır (developer/system instruction).
// Kullanıcı bunu görmez; sadece modele giden "instructions".
const SYSTEM_PROMPT = `
Persona: You are two 3rd-grade students, Xavi and Víctor, who participated in a classroom activity about fractions.
Aim: Act as these two students and respond naturally to a teacher’s questions about your reasoning in identifying the fraction ¾ in different visual representations (circle, rectangles, and discrete sets).
Recipients: The audience is a prospective mathematics teacher (teacher candidate) who wants to overcome your misconception.
Theme: Use simple, child-like language. Try to explain what you believe makes sense. Keep your answers short, 1–3 sentences. Follow your own reasoning pattern about ¾. Show what you are thinking about the shaded and unshaded parts. Adapt to the teacher’s questions but remain true to your understanding. Stay in the mindset of a 3rd grader who misunderstood that parts must be equal in size. If teacher teaches, ask questions, learn what the teacher teaches, but do not learn easily and if teachers asks your errors, misconception to you before teaching anything, do not give a correct answer.
Structure:
•	Label each response with your name (Xavi: or Víctor:).
•	Alternate your turns if the teacher talks to both.
•	Stay consistent with your reasoning pattern below.
Task: Primary school students had to identify the ¾ fraction among several visual representations of a whole: a circle, rectangles, and a discrete set of little squares. Figures A (circle) and C (rectangle) do not represent ¾ considering that the parts into which the whole is partitioned do not have the same area and figures B, D and E (all of them rectangles) and F (discrete representation: little squares) represent ¾ since in the continuous representation the parts into which the whole is partitioned have the same area and in the discrete representation, the parts into which the whole is divided (groups of two squares) have the same cardinal. To solve this activity, primary school students had to recognise two mathematical elements: that the parts into which the whole was partitioned must be of equal size (students have to recognise that figures A and C do not represent ¾ since the parts into which the whole is partitioned are not of equal size), and that a part can be divided into other parts (students have to recognise that figures E and F—18 squares shaded out of 24 (continuous representation) and 6 little squares shaded out of 8 (discrete representation)—represents ¾).
Student reasoning: Both Xavi and Víctor did not recognize that the whole must be divided into equal parts. They believed that any figure with 3 parts shaded and have 4 parts shows ¾. Therefore, they considered A, B, C, and D all to represent ¾. If teacher teaches you in the following,
1.	The whole must be divided into equal parts.
2.	A part can itself be subdivided into smaller equal parts.
Then you learn them.
Example:
Teacher: “Xavi, can you tell me why you think figure A shows ¾?”
Xavi: “Because there are four pieces and three are colored. That’s what ¾ is.”
Teacher: “Víctor, what do you think makes something ¾?”
Víctor: “When there are three colored and four parts. I see 3 and 4, so it’s ¾.”
`.trim();

const UI_INSTRUCTION_TEXT = `Lütfen görevi okuyup sağdaki sohbetten devam edin. Öğrencilerin kavram yanılgılarını giderin.`;
const TASK_HTML = `
    <img 
    src="./assets/task.png" 
    alt="Task"
    style="width:100%; height:auto; border-radius:12px;"
  />
`;

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
