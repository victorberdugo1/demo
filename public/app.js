import { Conversation } from 'https://cdn.jsdelivr.net/npm/@elevenlabs/client@1.30.0/+esm';

const $ = (id) => document.getElementById(id);
const GREETING = 'Hi there! I am your homework buddy. What are we learning today?';
const STATUS = {
  idle: 'Tap the microphone and ask me anything!',
  connecting: 'Connecting…',
  listening: 'Listening… go ahead, I am ready.',
  speaking: 'Here is my answer!',
};
const ERRORS = {
  mic: 'Microphone unavailable. Please allow microphone access.',
  connect: 'I could not connect right now. Please try again in a few seconds.',
  session: 'Something went wrong. Please try again.',
};
const CHIPS = ['Help me with my homework', 'What is a fraction?', 'Why is the sky blue?'];
const turns = [];
let conversation;
let starting = false;

function setState(state, message = STATUS[state]) {
  document.body.dataset.state = state;
  $('status').textContent = message;
}

function render() {
  $('log').replaceChildren(...turns.map(({ role, text }) => Object.assign(document.createElement('li'), { className: role, textContent: text })));
  $('log').scrollTop = $('log').scrollHeight;
  $('subtitle').textContent = turns.findLast((turn) => turn.role === 'model')?.text ?? GREETING;
}

async function startConversation() {
  if (conversation || starting) return;
  starting = true;
  setState('connecting');
  try {
    const { signed_url: signedUrl } = await (await fetch('/api/session', { method: 'POST' })).json();
    conversation = await Conversation.startSession({
      signedUrl,
      onConnect: () => setState('listening'),
      onDisconnect: () => {
        conversation = undefined;
        if (document.body.dataset.state !== 'error') setState('idle');
      },
      onModeChange: ({ mode }) => setState(mode),
      onMessage: ({ message, source }) => {
        turns.push({ role: source === 'user' ? 'user' : 'model', text: message });
        render();
      },
      onError: () => setState('error', ERRORS.session),
    });
  } catch (error) {
    setState('error', error.name === 'NotAllowedError' ? ERRORS.mic : ERRORS.connect);
  } finally {
    starting = false;
  }
}

async function ask(text) {
  const message = text.trim();
  if (!message) return;
  await startConversation();
  if (!conversation) return;
  turns.push({ role: 'user', text: message });
  $('text').value = '';
  render();
  conversation.sendUserMessage(message);
}

async function toggleConversation() {
  if (conversation) return conversation.endSession();
  await startConversation();
}

for (const text of CHIPS) {
  $('chips').append(Object.assign(document.createElement('button'), { className: 'chip', textContent: text, onclick: () => ask(text) }));
}
$('form').onsubmit = (event) => {
  event.preventDefault();
  ask($('text').value);
};
$('mic').onclick = toggleConversation;
$('clear').onclick = () => {
  turns.length = 0;
  render();
  conversation?.endSession();
};
render();
