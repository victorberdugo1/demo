const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const { GEMMA_API_KEY, ELEVENLABS_API_KEY, PORT = 3000 } = process.env;

const GEMMA_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemma-4-31b-it:generateContent';
const ELEVEN_URL = 'https://api.elevenlabs.io/v1';
const VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb';
const FILE_TYPES = { '.html': 'text/html', '.js': 'text/javascript' };

const SYSTEM_PROMPT = [
  'You are a shader parameter translator.',
  'Only return fields the user asked to change.',
  'Never invent colors the user did not mention.',
  'Colors are [r, g, b] with each value 0..1.',
  'lightDir points from the sphere toward the light: +x is right, +y is up, +z is toward the viewer.',
  'Set animateLight to true only if the user asks for the light to move.',
  'explanation is one short sentence describing what changed, written in the same language as the command.',
].join(' ');

const nullable = (schema) => ({ ...schema, nullable: true });
const vec3 = nullable({ type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 });
const number = nullable({ type: 'number' });

const SCHEMA = {
  type: 'object',
  properties: {
    baseColor: vec3,
    lightColor: vec3,
    lightDir: vec3,
    lightIntensity: number,
    roughness: number,
    shadowStrength: number,
    ambient: number,
    animateLight: nullable({ type: 'boolean' }),
    explanation: { type: 'string' },
  },
  required: ['explanation'],
};

async function askGemma(text, params) {
  const response = await fetch(GEMMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMMA_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: `Current params: ${JSON.stringify(params)}\nCommand: ${text}` }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: SCHEMA,
        thinkingConfig: { thinkingLevel: 'minimal' },
      },
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    const { error } = await response.json().catch(() => ({}));
    throw new Error(`Gemma ${response.status}: ${error?.message ?? 'request failed'}`);
  }
  const { candidates } = await response.json();
  const parts = candidates?.[0]?.content?.parts ?? [];
  return JSON.parse(parts.filter((part) => !part.thought).map((part) => part.text).join(''));
}

const routes = {
  '/api/command': async ({ text, params }) => {
    const { explanation, ...changes } = await askGemma(text, params);
    const accepted = Object.entries(changes).filter(([key, value]) => value != null && key in params);
    return { params: { ...params, ...Object.fromEntries(accepted) }, explanation };
  },

  '/api/speak': async ({ text }) => {
    const response = await fetch(`${ELEVEN_URL}/text-to-speech/${VOICE_ID}`, {
      method: 'POST',
      headers: { 'xi-api-key': ELEVENLABS_API_KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: 'eleven_flash_v2_5' }),
    });
    if (!response.ok) throw new Error(`ElevenLabs request failed (${response.status})`);
    return Buffer.from(await response.arrayBuffer());
  },

  '/api/transcribe': async ({ audioBase64 }) => {
    const form = new FormData();
    form.append('model_id', 'scribe_v2');
    form.append('file', new Blob([Buffer.from(audioBase64, 'base64')]), 'audio.webm');
    const response = await fetch(`${ELEVEN_URL}/speech-to-text`, {
      method: 'POST',
      headers: { 'xi-api-key': ELEVENLABS_API_KEY },
      body: form,
    });
    if (!response.ok) throw new Error(`ElevenLabs request failed (${response.status})`);
    return { text: (await response.json()).text };
  },
};

const send = (res, status, body, type = 'application/json') => {
  res.writeHead(status, { 'Content-Type': type });
  res.end(body);
};

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}

http
  .createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url, 'http://localhost');
      if (req.method === 'POST' && routes[pathname]) {
        const result = await routes[pathname](await readJson(req));
        return Buffer.isBuffer(result) ? send(res, 200, result, 'audio/mpeg') : send(res, 200, JSON.stringify(result));
      }
      const file = path.join('public', pathname === '/' ? 'index.html' : pathname);
      send(res, 200, await fs.promises.readFile(file), FILE_TYPES[path.extname(file)]);
    } catch (error) {
      const status = error.code === 'ENOENT' ? 404 : 500;
      if (status !== 404) console.error(req.method, req.url, error.message);
      send(res, status, JSON.stringify({ error: error.message }));
    }
  })
  .listen(PORT, () => console.log(`listening on ${PORT}`));
