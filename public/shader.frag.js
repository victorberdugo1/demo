export const FRAG = `#version 300 es
precision highp float;

uniform float uTime;
uniform vec2 uResolution;
uniform vec3 uBaseColor;
uniform vec3 uLightColor;
uniform vec3 uLightDir;
uniform float uLightIntensity;
uniform float uRoughness;
uniform float uShadowStrength;
uniform float uAmbient;

out vec4 outColor;

const vec3 CAMERA = vec3(0.0, 0.0, 3.0);
const float SPHERE_RADIUS = 1.0;

float distanceToSphere(vec3 rayDir) {
  float alongRay = dot(CAMERA, rayDir);
  float discriminant = alongRay * alongRay - (dot(CAMERA, CAMERA) - SPHERE_RADIUS * SPHERE_RADIUS);
  if (discriminant < 0.0) return -1.0;
  return -alongRay - sqrt(discriminant);
}

float missDistance(vec3 rayDir) {
  float alongRay = dot(CAMERA, rayDir);
  return sqrt(max(dot(CAMERA, CAMERA) - alongRay * alongRay, 0.0));
}

void main() {
  vec2 screen = (gl_FragCoord.xy * 2.0 - uResolution) / min(uResolution.x, uResolution.y);
  vec3 rayDir = normalize(vec3(screen, -2.0));

  float vignette = 1.0 - 0.3 * length(screen);
  vec3 background = vec3(0.10, 0.11, 0.14) * vignette;

  float hitDistance = distanceToSphere(rayDir);
  if (hitDistance < 0.0) {
    float halo = exp(-(missDistance(rayDir) - SPHERE_RADIUS) * 4.0) * 0.35;
    outColor = vec4(background + uBaseColor * halo, 1.0);
    return;
  }

  vec3 surfacePoint = CAMERA + rayDir * hitDistance;
  vec3 normal = normalize(surfacePoint);
  vec3 toLight = normalize(uLightDir);
  vec3 toViewer = -rayDir;

  float shininess = 1.0 - clamp(uRoughness, 0.0, 1.0);
  float diffuse = max(dot(normal, toLight), 0.0);
  vec3 halfway = normalize(toLight + toViewer);
  float specular = pow(max(dot(normal, halfway), 0.0), mix(4.0, 256.0, shininess * shininess)) * shininess;

  float facingLight = dot(normal, toLight);
  float shadowAmount = clamp(uShadowStrength, 0.0, 1.0) * (1.0 - smoothstep(-0.3, 0.3, facingLight));

  vec3 light = uLightColor * uLightIntensity;
  vec3 ambient = clamp(uAmbient, 0.0, 1.0) * uBaseColor;
  vec3 color = (ambient + diffuse * uBaseColor * light + specular * light) * (1.0 - shadowAmount);

  float rim = pow(1.0 - max(dot(normal, toViewer), 0.0), 3.0) * (0.2 + 0.05 * sin(uTime * 2.0));
  outColor = vec4(color + uBaseColor * rim, 1.0);
}`;
