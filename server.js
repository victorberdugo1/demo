const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const { ELEVENLABS_API_KEY, ELEVENLABS_AGENT_ID, PORT = 3000 } = process.env;
const ELEVEN_URL = 'https://api.elevenlabs.io/v1';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const VOICES = { es: 'p4zZMQfmG6U1aRDEIlF6', en: 'cdnpdcqt2HW1XtKv2f3V', ru: 'WTn2eCRCpoFAC50VD351' };
const SPEEDS = { es: 0.8 };
const PROMPT = [
  'You are a friendly, patient homework tutor for children.',
  'Explain simply with everyday examples. Do not give final answers: guide with hints, questions and small examples, and let the child take the next step.',
  'If the child is stuck, give a smaller hint or a worked example of a similar problem, then ask them to try.',
  'Encourage every attempt and celebrate progress warmly.',
  'Your reply is spoken aloud: keep it to one to three short sentences in plain conversational language, with no lists, markdown or emojis.',
  'Always reply in the same language the child speaks, and switch language when the child asks you to.',
  "Never assume the child's age, grade, curriculum or assignment; ask one short question if you need to know.",
  'Steer unrelated topics back to learning. Keep everything safe and appropriate for children.',
].join(' ');
const AGENT_CONFIG = {
  agent: {
    language: 'es',
    first_message: '¡Hola! Soy tu compañero de deberes. ¿Qué estamos aprendiendo hoy?',
    prompt: {
      prompt: PROMPT,
      built_in_tools: {
        language_detection: {
          type: 'system',
          name: 'language_detection',
          description: '',
          params: { system_tool_type: 'language_detection' },
        },
      },
    },
  },
  tts: { model_id: 'eleven_flash_v2_5', voice_id: VOICES.es, stability: 0.75, similarity_boost: 0.75, speed: SPEEDS.es },
  language_presets: Object.fromEntries(
    Object.entries(VOICES).map(([language, voice_id]) => [language, { overrides: { tts: { voice_id, speed: SPEEDS[language] ?? 1 } } }]),
  ),
};

const elevenRequest = async (url, init = {}) => {
  const response = await fetch(url, {
    ...init,
    headers: { 'xi-api-key': ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
  });
  if (!response.ok) throw new Error(`ElevenLabs ${response.status} ${await response.text()}`);
  return response.json();
};

const session = () => {
  const url = new URL(`${ELEVEN_URL}/convai/conversation/get-signed-url`);
  url.searchParams.set('agent_id', ELEVENLABS_AGENT_ID);
  return elevenRequest(url);
};

const configureAgent = () =>
  elevenRequest(`${ELEVEN_URL}/convai/agents/${ELEVENLABS_AGENT_ID}`, {
    method: 'PATCH',
    body: JSON.stringify({ conversation_config: AGENT_CONFIG }),
  });

const send = (res, status, body, type = 'application/json') => {
  res.writeHead(status, { 'Content-Type': type });
  res.end(body);
};

http
  .createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url, 'http://localhost');
      if (req.method === 'POST' && pathname === '/api/session') {
        return send(res, 200, JSON.stringify(await session()));
      }
      const file = path.join('public', pathname === '/' ? 'index.html' : pathname);
      send(res, 200, await fs.promises.readFile(file), TYPES[path.extname(file)]);
    } catch (error) {
      const status = error.code === 'ENOENT' ? 404 : 500;
      if (status === 500) console.error(req.method, req.url, error.message);
      send(res, status, JSON.stringify({ error: error.message }));
    }
  })
  .listen(PORT, () => {
    console.log(`listening on ${PORT}`);
    configureAgent()
      .then(() => console.log('agent configured'))
      .catch((error) => console.error('agent configuration failed:', error.message));
  });
