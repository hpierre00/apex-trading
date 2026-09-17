// support-widget.js — Tradolux AI support chat bubble.
// Loaded automatically on every marketing page by site-chrome.js.
// Talks to netlify/functions/support-chat.js. No dependencies.
(function () {
  if (document.querySelector('.tlx-chat-bubble')) return; // avoid double-init

  var history = [];

  var bubble = document.createElement('button');
  bubble.className = 'tlx-chat-bubble';
  bubble.setAttribute('aria-label', 'Open support chat');
  bubble.textContent = '\u{1F4AC}';

  var panel = document.createElement('div');
  panel.className = 'tlx-chat-panel';
  panel.innerHTML =
    '<div class="tlx-chat-header">' +
      '<span>Tradolux Support</span>' +
      '<div style="display:flex;align-items:center;gap:10px;">' +
        '<a href="/contact.html">Talk to a human</a>' +
        '<button class="tlx-chat-close" aria-label="Close">✕</button>' +
      '</div>' +
    '</div>' +
    '<div class="tlx-chat-messages" id="tlx-messages"></div>' +
    '<div class="tlx-chat-input-row">' +
      '<input id="tlx-input" type="text" placeholder="Ask a question..." maxlength="1000" />' +
      '<button id="tlx-send">Send</button>' +
    '</div>';

  document.body.appendChild(bubble);
  document.body.appendChild(panel);

  var messagesEl = panel.querySelector('#tlx-messages');
  var inputEl = panel.querySelector('#tlx-input');
  var sendBtn = panel.querySelector('#tlx-send');
  var closeBtn = panel.querySelector('.tlx-chat-close');

  function addMessage(text, cls) {
    var el = document.createElement('div');
    el.className = 'tlx-msg ' + cls;
    el.textContent = text;
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  var greeted = false;
  bubble.addEventListener('click', function () {
    panel.classList.toggle('open');
    if (panel.classList.contains('open') && !greeted) {
      addMessage('Hi! Ask me anything about Tradolux — what it does, how signals work, or pricing.', 'bot');
      greeted = true;
    }
  });
  closeBtn.addEventListener('click', function () { panel.classList.remove('open'); });

  function send() {
    var text = inputEl.value.trim();
    if (!text) return;

    addMessage(text, 'user');
    history.push({ role: 'user', content: text });
    inputEl.value = '';
    sendBtn.disabled = true;

    fetch('/.netlify/functions/support-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, history: history }),
    })
      .then(function (res) {
        return res.json().then(function (data) { return { ok: res.ok, data: data }; });
      })
      .then(function (result) {
        if (result.ok) {
          addMessage(result.data.reply, 'bot');
          history.push({ role: 'assistant', content: result.data.reply });
        } else {
          addMessage(result.data.error || 'Something went wrong. Please try again.', 'error');
        }
      })
      .catch(function () {
        addMessage('Network error. Please try again.', 'error');
      })
      .finally(function () {
        sendBtn.disabled = false;
      });
  }

  sendBtn.addEventListener('click', send);
  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') send();
  });
})();
