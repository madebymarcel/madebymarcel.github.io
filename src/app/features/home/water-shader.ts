/** A small WebGL 1 background, with no graphics-library or asset downloads. */
const VERTEX_SHADER = `
attribute vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 uResolution;
uniform float uTime;
uniform vec2 uPointer;
uniform float uPointerStrength;
uniform vec3 uRipples[4];

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

vec2 hash2(vec2 p) {
  return vec2(hash(p), hash(p + 19.19));
}

// Voronoi boundaries make thin, organic, refracted light networks.
float causticLines(vec2 p, float t) {
  vec2 cell = floor(p);
  vec2 local = fract(p);
  float first = 8.0;
  float second = 8.0;

  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 offset = vec2(float(x), float(y));
      vec2 random = hash2(cell + offset);
      vec2 animated = 0.5 + 0.28 * sin(t * 0.26 + random * 6.2831853);
      vec2 delta = offset + animated - local;
      float distanceSquared = dot(delta, delta);
      if (distanceSquared < first) {
        second = first;
        first = distanceSquared;
      } else if (distanceSquared < second) {
        second = distanceSquared;
      }
    }
  }

  float edge = sqrt(second) - sqrt(first);
  return 1.0 - smoothstep(0.025, 0.16, edge);
}

float surfaceHeight(vec2 p, float t, float aspect) {
  vec2 warped = p + 0.13 * sin(vec2(p.y * 1.25 + t * 0.20, p.x * 0.95 - t * 0.13));
  float h = 0.0;
  h += 0.24 * sin(dot(warped, vec2(1.06, 0.30)) * 2.25 + t * 0.38);
  h += 0.16 * sin(dot(warped, vec2(-0.44, 1.1)) * 3.7 - t * 0.33);
  h += 0.072 * sin(dot(warped, vec2(0.72, 0.95)) * 6.0 + t * 0.57);
  h += 0.028 * sin(dot(warped, vec2(-1.0, 0.50)) * 11.5 - t * 0.75);

  // Touch and click pulses disturb the same surface as the ambient waves.
  for (int i = 0; i < 4; i++) {
    float age = t - uRipples[i].z;
    if (age >= 0.0 && age < 3.4) {
      vec2 center = (uRipples[i].xy - 0.5) * vec2(aspect, 1.0) * 4.0;
      float distanceToClick = length(p - center);
      float front = age * 0.93;
      float envelope = exp(-pow((distanceToClick - front) * 5.0, 2.0)) * exp(-age * 0.65);
      h += 0.11 * sin((distanceToClick - front) * 18.0) * envelope;
    }
  }

  vec2 mouse = (uPointer - 0.5) * vec2(aspect, 1.0) * 4.0;
  float mouseDistance = length(p - mouse);
  h += 0.025 * sin(mouseDistance * 19.0 - t * 3.0)
    * exp(-mouseDistance * 3.5) * uPointerStrength;
  return h;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  float aspect = uResolution.x / uResolution.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0) * 4.0;
  float t = uTime;

  float h = surfaceHeight(p, t, aspect);
  float epsilon = 0.027;
  vec2 slope = (
    vec2(
      surfaceHeight(p + vec2(epsilon, 0.0), t, aspect),
      surfaceHeight(p + vec2(0.0, epsilon), t, aspect)
    ) - h
  ) / epsilon;
  vec3 normal = normalize(vec3(-slope * 1.45, 1.0));

  // Large soft areas of dark depth and transparent-looking teal.
  float current = 0.5 + 0.5 * sin(p.x * 0.76 + sin(p.y * 0.5 - t * 0.06));
  float shadow = 0.5 + 0.5 * sin(p.y * 0.93 - p.x * 0.24 + t * 0.045);
  float depth = clamp(current * 0.52 + shadow * 0.48 + h * 0.11, 0.0, 1.0);
  vec3 color = mix(
    vec3(0.002, 0.038, 0.049),
    vec3(0.008, 0.185, 0.171),
    0.12 + depth * 0.67
  );

  // The caustic network drifts through refracted wave coordinates.
  vec2 flow = p + 0.22 * sin(vec2(p.y * 1.47 + t * 0.2, p.x * 1.14 - t * 0.13));
  flow += normal.xy * 0.17;
  float caustics = causticLines(flow * 2.0 + vec2(t * 0.065, -t * 0.037), t);
  float illuminated = smoothstep(0.18, 0.84, depth);
  color += vec3(0.012, 0.17, 0.137) * caustics * (0.21 + illuminated * 0.77);

  // A grazing light creates broken silver-green sheen and occasional warm glints.
  vec3 halfway = normalize(vec3(0.35, 0.43, 1.0));
  float sheen = pow(max(dot(normal, halfway), 0.0), 26.0);
  float glint = pow(max(dot(normal, halfway), 0.0), 145.0);
  float sunlight = smoothstep(0.25, 0.88, uv.x * 0.61 + uv.y * 0.39);
  color += vec3(0.032, 0.107, 0.112) * sheen * 0.48;
  color += mix(vec3(0.25, 0.53, 0.50), vec3(1.0, 0.83, 0.62), sunlight)
    * glint * (0.17 + sunlight * 1.3);

  // Very subtle edge darkening; the letterforms are still ordinary HTML.
  float edgeDarkening = 1.0 - 0.16 * smoothstep(0.30, 0.86, length((uv - 0.5) * vec2(1.1, 0.9)));
  color *= edgeDarkening;
  color = 1.0 - exp(-color * 1.12);
  gl_FragColor = vec4(pow(color, vec3(0.94)), 1.0);
}
`;

interface Ripple {
  x: number;
  y: number;
  startedAt: number;
}

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  gl.deleteShader(shader);
  return null;
}

/** Start the animated background, returning the cleanup function for route changes. */
export function startWaterShader(canvas: HTMLCanvasElement): () => void {
  const gl = canvas.getContext('webgl', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'low-power',
  });
  if (!gl) {
    canvas.style.display = 'none';
    return () => {};
  }

  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  if (!vertex || !fragment) {
    if (vertex) gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
    canvas.style.display = 'none';
    return () => {};
  }

  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    canvas.style.display = 'none';
    return () => {};
  }
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    canvas.style.display = 'none';
    return () => {};
  }

  const buffer = gl.createBuffer();
  if (!buffer) {
    gl.deleteProgram(program);
    canvas.style.display = 'none';
    return () => {};
  }
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'aPosition');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const resolutionLocation = gl.getUniformLocation(program, 'uResolution');
  const timeLocation = gl.getUniformLocation(program, 'uTime');
  const pointerLocation = gl.getUniformLocation(program, 'uPointer');
  const pointerStrengthLocation = gl.getUniformLocation(program, 'uPointerStrength');
  const ripplesLocation = gl.getUniformLocation(program, 'uRipples[0]');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const rings: Ripple[] = [];
  const rippleUniform = new Float32Array(12);
  const pointer = { x: 0.5, y: 0.5, strength: 0 };
  const startedAt = performance.now();
  let frame = 0;
  let destroyed = false;
  let contextLost = false;

  const resize = () => {
    if (destroyed || contextLost) return;
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const maxPixels = 1_600_000;
    const scale = Math.min(
      window.devicePixelRatio || 1,
      bounds.width < 768 ? 1.25 : 1.5,
      Math.sqrt(maxPixels / (bounds.width * bounds.height)),
    );
    const width = Math.max(1, Math.floor(bounds.width * scale));
    const height = Math.max(1, Math.floor(bounds.height * scale));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    }
  };

  const render = (timestamp: number) => {
    frame = 0;
    if (destroyed || contextLost || document.hidden) return;
    if (canvas.width === 0 || canvas.height === 0) return;
    const time = reducedMotion.matches ? 0 : (timestamp - startedAt) / 1000;
    for (let i = 0; i < 4; i++) {
      const ring = rings[i];
      rippleUniform[i * 3] = ring?.x ?? 0.5;
      rippleUniform[i * 3 + 1] = ring?.y ?? 0.5;
      rippleUniform[i * 3 + 2] = ring?.startedAt ?? -100;
    }
    gl.useProgram(program);
    gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
    gl.uniform1f(timeLocation, time);
    gl.uniform2f(pointerLocation, pointer.x, pointer.y);
    gl.uniform1f(pointerStrengthLocation, reducedMotion.matches ? 0 : pointer.strength);
    gl.uniform3fv(ripplesLocation, rippleUniform);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    pointer.strength *= 0.94;
    if (!reducedMotion.matches) frame = requestAnimationFrame(render);
  };

  const stop = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  };
  const refreshAnimation = () => {
    stop();
    if (destroyed || contextLost || document.hidden) return;
    frame = requestAnimationFrame(render);
  };

  const eventPosition = (event: PointerEvent): { x: number; y: number } | null => {
    const rect = canvas.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom ||
      rect.width === 0 ||
      rect.height === 0
    ) {
      return null;
    }
    return {
      x: (event.clientX - rect.left) / rect.width,
      y: 1 - (event.clientY - rect.top) / rect.height,
    };
  };

  const onMove = (event: PointerEvent) => {
    if (reducedMotion.matches) return;
    const position = eventPosition(event);
    if (!position) return;
    pointer.x = position.x;
    pointer.y = position.y;
    pointer.strength = 1;
  };
  const onDown = (event: PointerEvent) => {
    if (reducedMotion.matches) return;
    const position = eventPosition(event);
    if (!position) return;
    rings.unshift({ ...position, startedAt: (performance.now() - startedAt) / 1000 });
    rings.length = Math.min(rings.length, 4);
  };
  const onLost = (event: Event) => {
    event.preventDefault();
    contextLost = true;
    canvas.style.visibility = 'hidden';
    stop();
  };

  const observer = new ResizeObserver(() => {
    resize();
    if (reducedMotion.matches) refreshAnimation();
  });
  resize();
  observer.observe(canvas);
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerdown', onDown, { passive: true });
  document.addEventListener('visibilitychange', refreshAnimation);
  reducedMotion.addEventListener('change', refreshAnimation);
  canvas.addEventListener('webglcontextlost', onLost);
  refreshAnimation();

  return () => {
    destroyed = true;
    stop();
    observer.disconnect();
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerdown', onDown);
    document.removeEventListener('visibilitychange', refreshAnimation);
    reducedMotion.removeEventListener('change', refreshAnimation);
    canvas.removeEventListener('webglcontextlost', onLost);
    if (!contextLost) {
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    }
  };
}
