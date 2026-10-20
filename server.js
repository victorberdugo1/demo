const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const { GEMMA_API_KEY, ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID = '21m00Tcm4TlvDq8ikWAM', PORT = 3000 } = process.env;

const GEMMA_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemma-4-26b-a4b-it:generateContent';
const ELEVEN_URL = 'https://api.elevenlabs.io/v1';
const FILE_TYPES = { '.html': 'text/html', '.js': 'text/javascript' };

const SYSTEM_PROMPT = [
  'You are a shader parameter translator.',
  'Only return fields the user asked to change.',
  'Never invent colors the user did not mention.',
  'Colors are [r, g, b] with each value 0..1.',
  'lightDir points from the sphere toward the light: +x is right, +y is up, +z is toward the viewer.',
  'Set animateLight to true only if the user asks for the light to move.',
  'explanation is one short sentence describing what changed.',
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

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const keyMissing = (name) => new HttpError(503, `${name} key missing`);

async function askGemma(text, params) {
  const response = await fetch(GEMMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMMA_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: `Current params: ${JSON.stringify(params)}\nCommand: ${text}` }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA },
    }),
  });
  if (!response.ok) throw new Error(`Gemma request failed (${response.status})`);
  const { candidates } = await response.json();
  const parts = candidates?.[0]?.content?.parts ?? [];
  return JSON.parse(parts.filter((part) => !part.thought).map((part) => part.text).join(''));
}

const routes = {
  '/api/command': async ({ text, params, delta: givenDelta }) => {
    if (!givenDelta && !GEMMA_API_KEY) throw keyMissing('Gemma');
    try {
      const { explanation, ...changes } = givenDelta ?? (await askGemma(text, params));
      const accepted = Object.entries(changes).filter(([key, value]) => value != null && key in params);
      return { params: { ...params, ...Object.fromEntries(accepted) }, explanation };
    } catch (error) {
      throw new HttpError(502, error instanceof SyntaxError ? "Couldn't parse command" : error.message);
    }
  },

  '/api/speak': async ({ text }) => {
    if (!ELEVENLABS_API_KEY) throw keyMissing('ElevenLabs');
    const response = await fetch(`${ELEVEN_URL}/text-to-speech/${ELEVENLABS_VOICE_ID}`, {
      method: 'POST',
      headers: { 'xi-api-key': ELEVENLABS_API_KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: 'eleven_flash_v2_5' }),
    });
    if (!response.ok) throw new HttpError(502, `ElevenLabs request failed (${response.status})`);
    return Buffer.from(await response.arrayBuffer());
  },

  '/api/transcribe': async ({ audioBase64 }) => {
    if (!ELEVENLABS_API_KEY) throw keyMissing('ElevenLabs');
    const form = new FormData();
    form.append('model_id', 'scribe_v2');
    form.append('file', new Blob([Buffer.from(audioBase64, 'base64')]), 'audio.webm');
    const response = await fetch(`${ELEVEN_URL}/speech-to-text`, {
      method: 'POST',
      headers: { 'xi-api-key': ELEVENLABS_API_KEY },
      body: form,
    });
    if (!response.ok) throw new HttpError(502, `ElevenLabs request failed (${response.status})`);
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
      const file = path.join('public', pathname === '/' ? 'index.html' : path.normalize(pathname));
      send(res, 200, await fs.promises.readFile(file), FILE_TYPES[path.extname(file)]);
    } catch (error) {
      const status = error.status ?? (error.code === 'ENOENT' ? 404 : 500);
      send(res, status, JSON.stringify({ error: error.message }));
    }
  })
  .listen(PORT);
