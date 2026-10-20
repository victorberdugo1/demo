import { FRAG } from './shader.frag.js';

const DEFAULTS = {
  baseColor: [0.35, 0.55, 0.95],
  lightColor: [1, 1, 1],
  lightDir: [-0.5, 0.6, 0.7],
  lightIntensity: 1,
  roughness: 0.5,
  shadowStrength: 0.5,
  ambient: 0.2,
  animateLight: false,
};

const CHIPS = [
  {
    text: 'Make it deep blue and very shiny',
    delta: { baseColor: [0.05, 0.15, 0.8], roughness: 0.1, explanation: 'Deep blue and very shiny.' },
  },
  {
    text: 'Warm sunset light from the left, strong shadows',
    delta: {
      lightColor: [1, 0.55, 0.25],
      lightDir: [-1, 0.2, 0.4],
      shadowStrength: 0.9,
      explanation: 'Warm sunset light from the left with strong shadows.',
    },
  },
  {
    text: 'Matte emerald green, soft ambient light',
    delta: {
      baseColor: [0.08, 0.65, 0.35],
      roughness: 0.95,
      ambient: 0.55,
      shadowStrength: 0.2,
      explanation: 'Matte emerald green with soft ambient light.',
    },
  },
  {
    text: 'Gold metal, harsh light from above',
    delta: {
      baseColor: [1, 0.78, 0.3],
      roughness: 0.2,
      lightColor: [1, 0.95, 0.85],
      lightDir: [0, 1, 0.3],
      lightIntensity: 1.6,
      shadowStrength: 0.8,
      explanation: 'Polished gold under harsh overhead light.',
    },
  },
];

const VERTEX = `#version 300 es
in vec2 corner;
void main() { gl_Position = vec4(corner, 0.0, 1.0); }`;

const UNIFORMS = [
  'uTime', 'uResolution', 'uBaseColor', 'uLightColor', 'uLightDir',
  'uLightIntensity', 'uRoughness', 'uShadowStrength', 'uAmbient',
];

const $ = (id) => document.getElementById(id);

let params = structuredClone(DEFAULTS);

function setParams(next) {
  params = next;
  const round = (_, value) => (typeof value === 'number' ? Math.round(value * 100) / 100 : value);
  $('readout').textContent = Object.entries(params)
    .map(([key, value]) => `${key}: ${JSON.stringify(value, round)}`)
    .join('\n');
}

let toastTimer;
function toast(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('toast').hidden = true), 4000);
}

function startRenderer(canvas) {
  const gl = canvas.getContext('webgl2');
  if (!gl) throw new Error('WebGL2 is not supported in this browser');

  const program = gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, FRAG]]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  gl.useProgram(program);

  // Two triangles that cover the whole screen: the fragment shader then colors every pixel itself.
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const corner = gl.getAttribLocation(program, 'corner');
  gl.enableVertexAttribArray(corner);
  gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);

  const loc = Object.fromEntries(UNIFORMS.map((name) => [name, gl.getUniformLocation(program, name)]));

  const frame = (ms) => {
    const width = Math.round(innerWidth * devicePixelRatio);
    const height = Math.round(innerHeight * devicePixelRatio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, width, height);

    const spin = params.animateLight ? ms / 1000 : 0;
    const [x, y, z] = params.lightDir;
    gl.uniform1f(loc.uTime, ms / 1000);
    gl.uniform2f(loc.uResolution, width, height);
    gl.uniform3fv(loc.uBaseColor, params.baseColor);
    gl.uniform3fv(loc.uLightColor, params.lightColor);
    gl.uniform3f(loc.uLightDir, x * Math.cos(spin) + z * Math.sin(spin), y, z * Math.cos(spin) - x * Math.sin(spin));
    gl.uniform1f(loc.uLightIntensity, params.lightIntensity);
    gl.uniform1f(loc.uRoughness, params.roughness);
    gl.uniform1f(loc.uShadowStrength, params.shadowStrength);
    gl.uniform1f(loc.uAmbient, params.ambient);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const { error } = await response.json().catch(() => ({}));
    throw Object.assign(new Error(error ?? 'Request failed'), { status: response.status });
  }
  return response;
}

function offlineDelta(input) {
  const chip = CHIPS.find(({ text }) => text.toLowerCase() === input.toLowerCase());
  if (chip) return chip.delta;
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

async function speak(message) {
  try {
    const response = await postJson('/api/speak', { text: message });
    new Audio(URL.createObjectURL(await response.blob())).play();
  } catch (error) {
    toast(error.status === 503 ? 'ElevenLabs key missing: voice disabled' : error.message);
  }
}

async function runCommand(input) {
  const text = input.trim();
  if (!text) return;
  try {
    let response;
    try {
      response = await postJson('/api/command', { text, params });
    } catch (error) {
      if (error.status !== 503) throw error;
      const delta = offlineDelta(text);
      if (!delta) return toast(`${error.message}: use a preset or paste a JSON delta`);
      toast(`${error.message}: applying preset values`);
      response = await postJson('/api/command', { delta, params });
    }
    const { params: next, explanation } = await response.json();
    setParams(next);
    $('say').textContent = explanation;
    speak(explanation);
  } catch (error) {
    toast(error.message);
  }
}

const toBase64 = (blob) =>
  new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.readAsDataURL(blob);
  });

let holding = false;
let recorder;
let recognition;
let heard = '';
let heardDone = Promise.resolve();

async function transcribe(blob) {
  let text;
  try {
    ({ text } = await (await postJson('/api/transcribe', { audioBase64: await toBase64(blob) })).json());
  } catch (error) {
    toast(error.status === 503 ? 'ElevenLabs key missing: using browser speech' : `${error.message}: using browser speech`);
    await heardDone;
    text = heard;
  }
  if (!text) return toast("Didn't catch that");
  $('text').value = text;
  runCommand(text);
}

async function startTalking() {
  holding = true;
  $('mic').classList.add('live');
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    return toast('Microphone unavailable');
  }
  if (!holding) return stream.getTracks().forEach((track) => track.stop());

  const chunks = [];
  recorder = new MediaRecorder(stream);
  recorder.ondataavailable = (event) => chunks.push(event.data);
  recorder.onstop = () => {
    stream.getTracks().forEach((track) => track.stop());
    transcribe(new Blob(chunks));
  };
  recorder.start();

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  heard = '';
  recognition = SpeechRecognition ? new SpeechRecognition() : null;
  if (recognition) {
    recognition.interimResults = true;
    recognition.onresult = (event) => (heard = [...event.results].map((result) => result[0].transcript).join(' '));
    heardDone = new Promise((resolve) => (recognition.onend = resolve));
    recognition.start();
  } else {
    heardDone = Promise.resolve();
  }
}

function stopTalking() {
  holding = false;
  $('mic').classList.remove('live');
  if (recorder?.state === 'recording') recorder.stop();
  recognition?.stop();
}

for (const { text } of CHIPS) {
  const chip = document.createElement('button');
  chip.textContent = text;
  chip.onclick = () => {
    $('text').value = text;
    runCommand(text);
  };
  $('chips').append(chip);
}

$('form').onsubmit = (event) => {
  event.preventDefault();
  runCommand($('text').value);
};
$('reset').onclick = () => {
  setParams(structuredClone(DEFAULTS));
  $('say').textContent = '';
};
$('mic').onpointerdown = startTalking;
$('mic').onpointerup = stopTalking;
$('mic').onpointerleave = stopTalking;
$('mic').onpointercancel = stopTalking;

setParams(params);
try {
  startRenderer($('canvas'));
} catch (error) {
  toast(error.message);
}
