(function (root) {
  "use strict";
  const Graphics = typeof module !== "undefined" && module.exports ? require("./graphics.js") : root.PocketGraphics;
  const World = typeof module !== "undefined" && module.exports ? require("./world.js") : root.PocketWorld;

  function selectPreset(game, presets) {
    return presets.find(preset => preset.match.title === game.cartridge.title
      && preset.match.color === game.color && preset.match.cartridgeType === game.cartridge.type
      && (preset.match.revision === undefined || preset.match.revision === game.cartridge.rom[0x14c])
      && (preset.match.checksum === undefined
        || preset.match.checksum === (game.cartridge.rom[0x14e] << 8 | game.cartridge.rom[0x14f]))) || null;
  }
  function validateCamera(camera) {
    for (const [key, min, max] of [["yaw", -45, 45], ["pitch", -35, 35], ["zoom", 0.5, 1.3],
      ["thickness", 0, 16], ["light", 0, 1]]) {
      if (!Number.isFinite(camera[key]) || camera[key] < min || camera[key] > max) {
        throw new Error(`Reglage 2.5D invalide : ${key}.`);
      }
    }
  }
  function buildScene(game, preset, thickness) {
    if (!Number.isFinite(thickness) || thickness < 0 || thickness > 16) throw new Error("Epaisseur 2.5D invalide.");
    const textures = Graphics.scene(game), vertices = [];
    const terrain = preset.terrain?.(game);
    if (terrain?.active && terrain.screenMap) Graphics.mapWindow(game, textures);
    if (terrain?.active && terrain.overlay) Graphics.overlay(game, textures, terrain.overlay);
    const scale = thickness / 8;
    function quad(points, uv, shade = 1) {
      for (const index of [0, 1, 2, 0, 2, 3]) {
        const point = points[index], tex = uv[index];
        vertices.push(point[0] - 80, 72 - point[1], point[2], tex[0], tex[1], shade);
      }
    }
    let tiles = 0;
    if ((game.io[0x40] & 128) && (game.color || (game.io[0x40] & 1))) {
      const sx = terrain?.screenMap ? 0 : game.io[0x43], sy = terrain?.screenMap ? 0 : game.io[0x42];
      const map = terrain?.screenMap ? (game.io[0x40] & 0x40 ? 0x1c00 : 0x1800)
        : game.io[0x40] & 8 ? 0x1c00 : 0x1800;
      for (let y = -(sy & 7); y < 144; y += 8) for (let x = -(sx & 7); x < 160; x += 8) {
        const tx = (x + sx) & 255, ty = (y + sy) & 255;
        const index = map + (ty >> 3) * 32 + (tx >> 3);
        const tile = game.vram[index], attr = game.color ? game.vram[8192 + index] : 0;
        const key = `${game.color && (attr & 8) ? 1 : 0}:${tile}`;
        const cell = (ty >> 3) * 32 + (tx >> 3);
        if (terrain?.active && terrain.overlay?.[Math.max(0, y) * 160 + Math.max(0, x)]) continue;
        if (terrain?.active && terrain.hidden[cell]) continue;
        const depth = terrain ? terrain.active ? terrain.depths[cell] * scale : 0 : preset.tileDepths[key] ?? 0;
        const limit = terrain ? 64 : 32;
        if (!Number.isFinite(depth) || depth < -limit || depth > limit) throw new Error(`Profondeur de tuile invalide : ${key}.`);
        const z = preset.backgroundDepth + depth;
        const left = Math.max(0, x), top = Math.max(0, y), right = Math.min(160, x + 8), bottom = Math.min(144, y + 8);
        const u0 = textures.screenSpace ? left / 160 : (tx + left - x) / 256;
        const v0 = textures.screenSpace ? top / 144 : (ty + top - y) / 256;
        const u1 = textures.screenSpace ? right / 160 : (tx + right - x) / 256;
        const v1 = textures.screenSpace ? bottom / 144 : (ty + bottom - y) / 256;
        const uv = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
        quad([[left, top, z], [right, top, z], [right, bottom, z], [left, bottom, z]], uv);
        if (thickness && (!terrain || terrain.active)) {
          const back = terrain ? Math.min(preset.backgroundDepth, z) - 2 : z - thickness;
          const mid = [[(u0 + u1) / 2, (v0 + v1) / 2]];
          const sideUV = [mid[0], mid[0], mid[0], mid[0]];
          quad([[left, top, back], [right, top, back], [right, top, z], [left, top, z]], sideUV, 0.75);
          quad([[left, bottom, z], [right, bottom, z], [right, bottom, back], [left, bottom, back]], sideUV, 0.45);
          quad([[left, top, z], [left, bottom, z], [left, bottom, back], [left, top, back]], sideUV, 0.55);
          quad([[right, top, back], [right, bottom, back], [right, bottom, z], [right, top, z]], sideUV, 0.65);
        }
        tiles++;
      }
    }
    const background = new Float32Array(vertices);
    vertices.length = 0;
    if ((game.io[0x40] & 128) && preset.raisedSprites && terrain?.active) {
      const { labels, components } = Graphics.spriteComponents(textures.sprites);
      // Horizontal runs preserve the captured alpha mask without overlapping character quads.
      for (let y = 0; y < 144; y++) for (let x = 0; x < 160;) {
        const id = labels[y * 160 + x];
        if (id < 0) { x++; continue; }
        const left = x;
        while (x < 160 && labels[y * 160 + x] === id) x++;
        const zTop = preset.spriteDepth + (components[id].bottom - y) * scale;
        const zBottom = zTop - scale;
        quad([[left, y, zTop], [x, y, zTop], [x, y + 1, zBottom], [left, y + 1, zBottom]],
          [[left / 160, y / 144], [x / 160, y / 144], [x / 160, (y + 1) / 144], [left / 160, (y + 1) / 144]]);
      }
    } else if (game.io[0x40] & 128) {
      quad([[0, 0, preset.spriteDepth], [160, 0, preset.spriteDepth],
        [160, 144, preset.spriteDepth], [0, 144, preset.spriteDepth]], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    }
    return { textures, background, sprites: new Float32Array(vertices), tiles, terrain };
  }

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.gl = canvas.getContext("webgl", { alpha: false, antialias: false, preserveDrawingBuffer: true });
      if (!this.gl) throw new Error("WebGL indisponible. Le rendu 2D reste accessible.");
      this.resources = [];
      try {
        const gl = this.gl;
        const vertex = this.shader(gl.VERTEX_SHADER, `
          attribute vec3 aPosition;
          attribute vec2 aUV;
          attribute float aShade;
          uniform vec4 uCamera;
          uniform float uHUD;
          uniform vec2 uOrigin;
          varying vec2 vUV;
          varying float vShade;
          void main() {
            vUV = aUV;
            vShade = aShade;
            if (uHUD > 0.5) {
              gl_Position = vec4(aPosition.x / 80.0, aPosition.y / 72.0, 0.0, 1.0);
            } else {
              float cy = cos(uCamera.x), sy = sin(uCamera.x);
              float cp = cos(uCamera.y), sp = sin(uCamera.y);
              vec3 position = aPosition + vec3(-uOrigin.x, uOrigin.y, 0.0);
              vec3 p;
              if (uCamera.w > 0.5) {
                p = vec3(cy*position.x - sy*position.y, sy*position.x + cy*position.y, position.z);
              } else {
                p = vec3(cy*position.x + sy*position.z, position.y, -sy*position.x + cy*position.z);
              }
              p = vec3(p.x, cp*p.y - sp*p.z, sp*p.y + cp*p.z);
              float w = 320.0 - p.z;
              gl_Position = vec4(p.x * 320.0 * uCamera.z / 80.0,
                p.y * 320.0 * uCamera.z / 72.0, 1.3333333*w - 233.33333, w);
            }
          }`);
        const fragment = this.shader(gl.FRAGMENT_SHADER, `
          precision mediump float;
          uniform sampler2D uTexture;
          uniform float uLight;
          varying vec2 vUV;
          varying float vShade;
          void main() {
            vec4 pixel = texture2D(uTexture, vUV);
            if (pixel.a < 0.5) discard;
            gl_FragColor = vec4(pixel.rgb * mix(1.0, vShade, uLight), 1.0);
          }`);
        this.program = gl.createProgram();
        if (!this.program) throw new Error("Creation du programme WebGL impossible.");
        this.resources.push(["program", this.program]);
        gl.attachShader(this.program, vertex); gl.attachShader(this.program, fragment);
        gl.linkProgram(this.program);
        if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.program) || "Liaison WebGL impossible.");
        this.buffers = Array.from({ length: 5 }, () => {
          const buffer = gl.createBuffer();
          if (!buffer) throw new Error("Creation du buffer WebGL impossible.");
          this.resources.push(["buffer", buffer]);
          return buffer;
        });
        this.uploadedVertices = new Map();
        this.textures = Array.from({ length: 5 }, () => {
          const texture = gl.createTexture();
          if (!texture) throw new Error("Creation de texture WebGL impossible.");
          this.resources.push(["texture", texture]);
          gl.bindTexture(gl.TEXTURE_2D, texture);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          return texture;
        });
        this.uniforms = Object.fromEntries(["uCamera", "uHUD", "uLight", "uTexture", "uOrigin"].map(name => [name, gl.getUniformLocation(this.program, name)]));
        this.uploadedTextures = new Map();
        this.attributes = Object.fromEntries(["aPosition", "aUV", "aShade"].map(name => [name, gl.getAttribLocation(this.program, name)]));
        this.hud = new Float32Array([
          -80, 72, 0, 0, 0, 1, 80, 72, 0, 1, 0, 1, 80, -72, 0, 1, 1, 1,
          -80, 72, 0, 0, 0, 1, 80, -72, 0, 1, 1, 1, -80, -72, 0, 0, 1, 1,
        ]);
      } catch (error) { this.dispose(); throw error; }
    }
    shader(type, source) {
      const gl = this.gl, shader = gl.createShader(type);
      if (!shader) throw new Error("Creation de shader WebGL impossible.");
      this.resources.push(["shader", shader]);
      gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || "Compilation WebGL impossible.");
      return shader;
    }
    draw(vertices, slot, image) {
      const gl = this.gl;
      const texture = this.textures[slot], buffer = this.buffers[slot];
      gl.bindTexture(gl.TEXTURE_2D, texture);
      if (this.uploadedTextures.get(texture) !== image) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, image.width, image.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, image.pixels);
        this.uploadedTextures.set(texture, image);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      if (this.uploadedVertices.get(buffer) !== vertices) {
        gl.bufferData(gl.ARRAY_BUFFER, vertices, slot === 0 || slot === 2 || slot === 4 ? gl.STATIC_DRAW : gl.DYNAMIC_DRAW);
        this.uploadedVertices.set(buffer, vertices);
      }
      for (const [name, size, offset] of [["aPosition", 3, 0], ["aUV", 2, 12], ["aShade", 1, 20]]) {
        const location = this.attributes[name];
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, size, gl.FLOAT, false, 24, offset);
      }
      gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 6);
    }
    render(game, preset, camera, mode = "2.5d") {
      validateCamera(camera);
      const gl = this.gl;
      if (gl.isContextLost()) throw new Error("Contexte WebGL perdu. Revenez en 2D puis réessayez.");
      const world = mode === "3d" ? World.build(game, preset, camera.thickness) : null;
      const scene = world?.active ? world : buildScene(game, preset, camera.thickness);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clearColor(...(world?.active ? world.clearColor : [0.04, 0.07, 0.06, 1]));
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
      gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
      gl.useProgram(this.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(this.uniforms.uTexture, 0);
      gl.uniform2f(this.uniforms.uOrigin, ...(world?.active ? world.origin : [0, 0]));
      if (scene.terrain && !scene.terrain.active) {
        gl.disable(gl.DEPTH_TEST);
        gl.uniform1f(this.uniforms.uHUD, 1);
        gl.uniform1f(this.uniforms.uLight, 0);
        this.draw(this.hud, 4, { width: 160, height: 144, pixels: game.pixels });
      } else {
        gl.uniform4f(this.uniforms.uCamera, camera.yaw * Math.PI / 180,
          (camera.pitch - (world?.active ? world.pitchOffset : 0)) * Math.PI / 180,
          camera.zoom * (world?.active ? world.zoomFactor : 1), world?.active ? 1 : 0);
        gl.uniform1f(this.uniforms.uHUD, 0);
        gl.uniform1f(this.uniforms.uLight, camera.light);
        this.draw(scene.background, 0, scene.textures.background);
        if (world?.active) this.draw(scene.models, 2, scene.material);
        if (world?.active && scene.shadows.length) this.draw(scene.shadows, 3, scene.shadowMaterial);
        this.draw(scene.sprites, 1, scene.textures.sprites);
        gl.disable(gl.DEPTH_TEST);
        gl.uniform1f(this.uniforms.uHUD, 1);
        gl.uniform1f(this.uniforms.uLight, 0);
        if (game.io[0x40] & 128) this.draw(this.hud, 4, scene.textures.window);
      }
      const error = gl.getError();
      if (error !== gl.NO_ERROR) throw new Error(`Erreur WebGL : ${error}.`);
      return { tiles: scene.tiles, detail: world?.active ? world.detail
        : world ? scene.terrain && !scene.terrain.active ? `3D : ${scene.terrain.reason}` : world.reason
          : scene.terrain?.reason };
    }
    dispose() {
      for (const [kind, resource] of this.resources) {
        const method = { shader: "deleteShader", program: "deleteProgram", buffer: "deleteBuffer", texture: "deleteTexture" }[kind];
        this.gl[method](resource);
      }
      this.resources.length = 0;
      this.uploadedVertices?.clear();
      this.uploadedTextures?.clear();
    }
  }
  const api = { selectPreset, validateCamera, buildScene, Renderer };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PocketScene = api;
})(globalThis);
