// ─── Session & State ────────────────────────────────
const sessionId = crypto.randomUUID();
let isStreaming = false;

// ─── DOM refs ───────────────────────────────────────
const messagesEl = document.getElementById("messages");
const userInput  = document.getElementById("userInput");
const sendBtn    = document.getElementById("sendBtn");
const clearBtn   = document.getElementById("clearBtn");

// ─── Markdown renderer (lightweight) ────────────────
function renderMarkdown(text) {
  // Escape HTML first
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Fenced code blocks
  html = html.replace(/```[\w]*\n([\s\S]*?)```/g, (_, code) => {
    return `<pre><code>${code.trim()}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Bold + italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Headings
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm,  "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm,   "<h1>$1</h1>");

  // Horizontal rule
  html = html.replace(/^[-─]{3,}$/gm, "<hr />");

  // Blockquote (⚠️ style)
  html = html.replace(/^&gt; (.+)$/gm, "<blockquote>$1</blockquote>");

  // Unordered lists
  html = html.replace(/((?:^[-*] .+\n?)+)/gm, (match) => {
    const items = match.trim().split("\n").map(l => {
      const content = l.replace(/^[-*] /, "");
      return `<li>${content}</li>`;
    }).join("");
    return `<ul>${items}</ul>`;
  });

  // Ordered lists
  html = html.replace(/((?:^\d+\. .+\n?)+)/gm, (match) => {
    const items = match.trim().split("\n").map(l => {
      const content = l.replace(/^\d+\. /, "");
      return `<li>${content}</li>`;
    }).join("");
    return `<ol>${items}</ol>`;
  });

  // Line breaks → paragraphs
  const blocks = html.split(/\n{2,}/);
  html = blocks.map(block => {
    block = block.trim();
    if (!block) return "";
    if (/^<(h[1-6]|ul|ol|pre|blockquote|hr)/.test(block)) return block;
    // Replace single newlines within paragraphs
    block = block.replace(/\n/g, "<br />");
    return `<p>${block}</p>`;
  }).join("\n");

  return html;
}

// ─── Append a message bubble ─────────────────────────
function appendMessage(role, content, isStreaming = false) {
  const wrapper = document.createElement("div");
  wrapper.className = `message ${role}`;

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = role === "user" ? "👤" : "🏗";

  const bubble = document.createElement("div");
  bubble.className = "message-bubble";

  if (role === "assistant") {
    if (isStreaming) {
      bubble.textContent = content;
    } else {
      bubble.innerHTML = renderMarkdown(content);
    }
  } else {
    bubble.textContent = content;
  }

  wrapper.appendChild(avatar);
  wrapper.appendChild(bubble);
  messagesEl.appendChild(wrapper);
  scrollToBottom();

  return bubble; // return for streaming updates
}

// ─── Typing indicator ────────────────────────────────
function showTyping() {
  const wrapper = document.createElement("div");
  wrapper.className = "message assistant";
  wrapper.id = "typing-msg";

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = "🏗";

  const indicator = document.createElement("div");
  indicator.className = "typing-indicator";
  indicator.innerHTML = `
    <div class="typing-dot"></div>
    <div class="typing-dot"></div>
    <div class="typing-dot"></div>
  `;

  wrapper.appendChild(avatar);
  wrapper.appendChild(indicator);
  messagesEl.appendChild(wrapper);
  scrollToBottom();
  return wrapper;
}

function removeTyping() {
  const el = document.getElementById("typing-msg");
  if (el) el.remove();
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ─── Send message ────────────────────────────────────
async function sendMessage() {
  const text = userInput.value.trim();
  if (!text || isStreaming) return;

  // Remove welcome card on first message
  const welcome = document.querySelector(".welcome-card");
  if (welcome) welcome.remove();

  isStreaming = true;
  userInput.value = "";
  adjustTextarea();
  sendBtn.disabled = true;

  appendMessage("user", text);

  const typingEl = showTyping();

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, sessionId }),
    });

    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }

    removeTyping();

    // Set up streaming bubble
    let streamedText = "";
    const bubble = appendMessage("assistant", "", true);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop(); // keep incomplete line

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const event = JSON.parse(line.slice(6));
          if (event.type === "text") {
            streamedText += event.text;
            // Live update: render markdown as we stream
            bubble.innerHTML = renderMarkdown(streamedText);
            scrollToBottom();
          } else if (event.type === "error") {
            bubble.innerHTML = `<span style="color:#e05454">⚠ Error: ${event.error}</span>`;
          }
        } catch {
          // skip malformed lines
        }
      }
    }

    // Final render once complete
    bubble.innerHTML = renderMarkdown(streamedText);
    scrollToBottom();

  } catch (err) {
    removeTyping();
    appendMessage("assistant", `⚠ Something went wrong: ${err.message}. Please try again.`);
  } finally {
    isStreaming = false;
    sendBtn.disabled = userInput.value.trim() === "";
    userInput.focus();
  }
}

// ─── Clear conversation ──────────────────────────────
async function clearConversation() {
  try {
    await fetch("/api/session/clear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
  } catch { /* ignore */ }

  messagesEl.innerHTML = `
    <div class="welcome-card">
      <div class="welcome-icon">🏗</div>
      <h2 class="welcome-title">Permit & Inspection Agent</h2>
      <p class="welcome-text">
        I handle building permits and inspection scheduling for <strong>Construction with Style</strong>
        in San José, CA. Tell me what you need — pull a permit, schedule an inspection,
        or ask about requirements and fees.
      </p>
      <div class="welcome-badges">
        <span class="badge">Building Permits</span>
        <span class="badge">Inspection Scheduling</span>
        <span class="badge">Fee Estimates</span>
        <span class="badge">San José, CA</span>
      </div>
    </div>
  `;
}

// ─── Auto-resize textarea ────────────────────────────
function adjustTextarea() {
  userInput.style.height = "auto";
  userInput.style.height = Math.min(userInput.scrollHeight, 150) + "px";
}

// ─── Event listeners ─────────────────────────────────
userInput.addEventListener("input", () => {
  adjustTextarea();
  sendBtn.disabled = userInput.value.trim() === "" || isStreaming;
});

userInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

sendBtn.addEventListener("click", sendMessage);
clearBtn.addEventListener("click", clearConversation);

// Quick action buttons
document.querySelectorAll(".quick-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    if (isStreaming) return;
    userInput.value = btn.dataset.prompt;
    adjustTextarea();
    sendBtn.disabled = false;
    sendMessage();
  });
});

// Focus input on load
userInput.focus();
