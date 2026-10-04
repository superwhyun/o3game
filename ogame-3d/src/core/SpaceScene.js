/**
 * Three.js 3D Space Scene - OPTIMIZED for Battery Life
 * Reduced FPS, lower resolution, fewer particles
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

export class SpaceScene {
  constructor(container) {
    this.container = container;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.composer = null;
    this.animationId = null; // Track RAF ID for thorough stopping
    this.planet = null;
    this.stars = null;
    this.nebula = null;
    this.particles = null;
    this.lasers = [];
    this.explosions = [];
    
    this.clock = new THREE.Clock();
    this.mouse = new THREE.Vector2();
    this.targetRotation = new THREE.Vector2();
    
    // Performance settings
    this.targetFPS = 30; // Cap at 30fps for battery saving
    this.frameInterval = 1000 / this.targetFPS;
    this.lastFrameTime = 0;
    this.isVisible = true;
    this.isBatterySaving = false; // Automatic battery saving
    this.isEnergySavingMode = false; // Manual energy saving mode
    this.paused = false;
    
    // Reduced quality for mobile/low-power
    this.pixelRatio = Math.min(window.devicePixelRatio, 1.5);
    
    this.init();
    this.setupVisibilityTracking();
    this.setupBatterySaving();
  }
  
  init() {
    // Scene setup
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x0a0a0f, 0.015);
    
    // Camera
    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    this.camera.position.set(0, 0, 15);
    
    // Renderer - OPTIMIZED
    this.renderer = new THREE.WebGLRenderer({
      antialias: false, // Disable AA for performance
      alpha: true,
      powerPreference: 'low-power', // Prefer low power GPU
      stencil: false,
      depth: true
    });
    
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.toneMapping = THREE.NoToneMapping; // Simpler tone mapping
    
    this.container.appendChild(this.renderer.domElement);
    
    // Post-processing - LOWER QUALITY
    this.setupPostProcessing();
    
    // Create scene elements - REDUCED COUNTS
    this.createStars();
    this.createNebula();
    this.createPlanet();
    this.createParticles();
    this.createLighting();
    
    // Event listeners
    window.addEventListener('resize', () => this.onResize());
    document.addEventListener('mousemove', (e) => this.onMouseMove(e));
    
    // Start animation loop with FPS cap
    this.animate(0);
  }
  
  setupPostProcessing() {
    const renderPass = new RenderPass(this.scene, this.camera);
    
    // Lower resolution bloom for performance
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(
        Math.floor(window.innerWidth * 0.5), // Half resolution
        Math.floor(window.innerHeight * 0.5)
      ),
      0.8,  // Reduced strength
      0.3,  // Reduced radius
      0.3   // Higher threshold (less work)
    );
    
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(renderPass);
    this.composer.addPass(bloomPass);
    this.bloomPass = bloomPass;
  }
  
  createStars() {
    // REDUCED: 3000 -> 1000 stars
    const starCount = 1000;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);
    
    const colorPalette = [
      new THREE.Color(0xffffff),
      new THREE.Color(0xaaaaff),
      new THREE.Color(0xffaaaa)
    ];
    
    for (let i = 0; i < starCount; i++) {
      const i3 = i * 3;
      const radius = 50 + Math.random() * 100;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      
      positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      positions[i3 + 2] = radius * Math.cos(phi);
      
      const color = colorPalette[Math.floor(Math.random() * colorPalette.length)];
      colors[i3] = color.r;
      colors[i3 + 1] = color.g;
      colors[i3 + 2] = color.b;
    }
    
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    
    // SIMPLIFIED material - no custom shader
    const material = new THREE.PointsMaterial({
      size: 0.15,
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      sizeAttenuation: true
    });
    
    this.stars = new THREE.Points(geometry, material);
    this.scene.add(this.stars);
  }
  
  createNebula() {
    // Reduced to 2 sprites instead of 3
    const nebulaGroup = new THREE.Group();
    const nebulaColors = [
      { color: 0x4facfe, opacity: 0.12, scale: 40 },
      { color: 0xa855f7, opacity: 0.08, scale: 45 }
    ];
    
    nebulaColors.forEach((nebula) => {
      const canvas = document.createElement('canvas');
      canvas.width = 128; // Reduced from 256
      canvas.height = 128;
      const ctx = canvas.getContext('2d');
      
      const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      const color = new THREE.Color(nebula.color);
      gradient.addColorStop(0, `rgba(${color.r * 255}, ${color.g * 255}, ${color.b * 255}, 1)`);
      gradient.addColorStop(0.5, `rgba(${color.r * 255}, ${color.g * 255}, ${color.b * 255}, 0.3)`);
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 128, 128);
      
      const texture = new THREE.CanvasTexture(canvas);
      const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        opacity: nebula.opacity,
        blending: THREE.AdditiveBlending
      });
      
      const sprite = new THREE.Sprite(material);
      sprite.scale.set(nebula.scale, nebula.scale, 1);
      sprite.position.set(
        (Math.random() - 0.5) * 30,
        (Math.random() - 0.5) * 20,
        (Math.random() - 0.5) * 20 - 20
      );
      
      nebulaGroup.add(sprite);
    });
    
    this.nebula = nebulaGroup;
    this.scene.add(nebulaGroup);
  }
  
  createPlanet() {
    const planetGroup = new THREE.Group();
    const radius = 3;
    
    // Simplified texture - lower resolution
    const canvas = document.createElement('canvas');
    canvas.width = 256; // Reduced from 512
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    
    const gradient = ctx.createLinearGradient(0, 0, 0, 128);
    gradient.addColorStop(0, '#1a365d');
    gradient.addColorStop(0.3, '#2563eb');
    gradient.addColorStop(0.5, '#059669');
    gradient.addColorStop(0.7, '#059669');
    gradient.addColorStop(1, '#1a365d');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 128);
    
    // Fewer clouds
    for (let i = 0; i < 50; i++) { // Reduced from 200
      const x = Math.random() * 256;
      const y = Math.random() * 128;
      ctx.fillStyle = `rgba(255, 255, 255, 0.08)`;
      ctx.beginPath();
      ctx.arc(x, y, Math.random() * 20 + 10, 0, Math.PI * 2);
      ctx.fill();
    }
    
    const texture = new THREE.CanvasTexture(canvas);
    
    // Lower geometry detail
    const geometry = new THREE.SphereGeometry(radius, 32, 32); // Reduced from 64,64
    const material = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.9,
      metalness: 0.1
    });
    
    const planet = new THREE.Mesh(geometry, material);
    planetGroup.add(planet);
    
    // Simplified atmosphere
    const atmosphereGeometry = new THREE.SphereGeometry(radius * 1.12, 16, 16);
    const atmosphereMaterial = new THREE.MeshBasicMaterial({
      color: 0x4facfe,
      transparent: true,
      opacity: 0.15,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending
    });
    
    const atmosphere = new THREE.Mesh(atmosphereGeometry, atmosphereMaterial);
    planetGroup.add(atmosphere);
    
    // Ring
    const ringGeometry = new THREE.RingGeometry(radius * 1.4, radius * 2.2, 64); // Reduced from 128
    const ringCanvas = document.createElement('canvas');
    ringCanvas.width = 64;
    ringCanvas.height = 1;
    const ringCtx = ringCanvas.getContext('2d');
    const ringGradient = ringCtx.createLinearGradient(0, 0, 64, 0);
    ringGradient.addColorStop(0, 'rgba(79, 172, 254, 0)');
    ringGradient.addColorStop(0.2, 'rgba(79, 172, 254, 0.3)');
    ringGradient.addColorStop(0.5, 'rgba(200, 169, 106, 0.45)');
    ringGradient.addColorStop(0.8, 'rgba(79, 172, 254, 0.3)');
    ringGradient.addColorStop(1, 'rgba(79, 172, 254, 0)');
    ringCtx.fillStyle = ringGradient;
    ringCtx.fillRect(0, 0, 64, 1);
    
    const ringTexture = new THREE.CanvasTexture(ringCanvas);
    const ringMaterial = new THREE.MeshBasicMaterial({
      map: ringTexture,
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending
    });
    
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.rotation.x = Math.PI / 2.2;
    planetGroup.add(ring);
    
    this.planet = planetGroup;
    this.planetMesh = planet;
    this.atmosphere = atmosphere;
    this.ring = ring;
    
    this.scene.add(planetGroup);
  }
  
  createParticles() {
    // REDUCED: 200 -> 80 particles
    const particleCount = 80;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    
    for (let i = 0; i < particleCount; i++) {
      const i3 = i * 3;
      const angle = Math.random() * Math.PI * 2;
      const radius = 4 + Math.random() * 3;
      const height = (Math.random() - 0.5) * 2;
      
      positions[i3] = Math.cos(angle) * radius;
      positions[i3 + 1] = height;
      positions[i3 + 2] = Math.sin(angle) * radius;
    }
    
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    
    const material = new THREE.PointsMaterial({
      color: 0x00f5ff,
      size: 0.05,
      transparent: true,
      opacity: 0.5
    });
    
    this.particles = new THREE.Points(geometry, material);
    this.scene.add(this.particles);
  }
  
  createLighting() {
    // Reduced lights
    const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
    this.scene.add(ambientLight);
    
    const sunLight = new THREE.DirectionalLight(0xffffff, 1.2);
    sunLight.position.set(10, 5, 10);
    this.scene.add(sunLight);
    
    const rimLight = new THREE.DirectionalLight(0x4facfe, 0.5);
    rimLight.position.set(-10, 0, -5);
    this.scene.add(rimLight);
    
    this.lights = { ambientLight, sunLight, rimLight };
  }
  
  createLaser(startPos, endPos, color = 0x00f5ff) {
    const geometry = new THREE.BufferGeometry().setFromPoints([startPos, endPos]);
    const material = new THREE.LineBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.7
    });
    
    const laser = new THREE.Line(geometry, material);
    this.scene.add(laser);
    
    const laserObj = { line: laser, created: Date.now(), duration: 200 };
    this.lasers.push(laserObj);
    
    setTimeout(() => {
      this.scene.remove(laser);
      this.lasers = this.lasers.filter(l => l !== laserObj);
    }, laserObj.duration);
    
    return laserObj;
  }
  
  createExplosion(position, size = 1) {
    // REDUCED particles: 50 -> 25
    const particleCount = 25;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const velocities = [];
    
    for (let i = 0; i < particleCount; i++) {
      const i3 = i * 3;
      positions[i3] = position.x;
      positions[i3 + 1] = position.y;
      positions[i3 + 2] = position.z;
      
      velocities.push({
        x: (Math.random() - 0.5) * 0.15 * size,
        y: (Math.random() - 0.5) * 0.15 * size,
        z: (Math.random() - 0.5) * 0.15 * size
      });
    }
    
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    
    const material = new THREE.PointsMaterial({
      color: 0xff6600,
      size: 0.08 * size,
      transparent: true,
      opacity: 0.9
    });
    
    const explosion = new THREE.Points(geometry, material);
    this.scene.add(explosion);
    
    const explosionObj = {
      mesh: explosion,
      velocities: velocities,
      created: Date.now(),
      duration: 800,
      geometry: geometry
    };
    
    this.explosions.push(explosionObj);
    return explosionObj;
  }
  
  updateExplosions() {
    const now = Date.now();
    this.explosions = this.explosions.filter(exp => {
      const age = now - exp.created;
      if (age > exp.duration) {
        this.scene.remove(exp.mesh);
        return false;
      }
      
      const positions = exp.geometry.attributes.position.array;
      for (let i = 0; i < exp.velocities.length; i++) {
        const i3 = i * 3;
        const vel = exp.velocities[i];
        positions[i3] += vel.x;
        positions[i3 + 1] += vel.y;
        positions[i3 + 2] += vel.z;
      }
      
      exp.geometry.attributes.position.needsUpdate = true;
      exp.mesh.material.opacity = 0.9 * (1 - age / exp.duration);
      return true;
    });
  }
  
  // BATTERY & VISIBILITY MANAGEMENT
  setupVisibilityTracking() {
    document.addEventListener('visibilitychange', () => {
      this.isVisible = !document.hidden;
      if (this.isVisible) {
        console.log('👁️ Tab visible - Starting 3D loop');
        this.lastFrameTime = performance.now();
        if (!this.paused) {
          this.startLoop();
        } else if (this.isEnergySavingMode) {
          this.renderFrame();
        }
      } else {
        console.log('🌑 Tab hidden - Stopping 3D loop for battery saving');
        this.stopLoop();
      }
    });
  }

  startLoop() {
    if (this.animationId || !this.isVisible || this.paused || this.isEnergySavingMode) return;
    this.lastFrameTime = performance.now();
    this.animate(this.lastFrameTime);
  }

  stopLoop() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  /**
   * Manual Energy Saving Mode toggle
   */
  setEnergySavingMode(enabled) {
    if (this.isEnergySavingMode === enabled) return;
    this.isEnergySavingMode = enabled;
    
    if (enabled) {
      this.targetFPS = 15; // Further reduce FPS
      this.renderer.setPixelRatio(1.0); // Drop to standard resolution
      
      // Disable bloom pass for performance
      if (this.composer && this.composer.passes.length > 1) {
        this.savedPasses = [...this.composer.passes];
        this.composer.passes = [this.composer.passes[0]]; // Keep only RenderPass
      }

      this.renderFrame();
      this.stopLoop();
      
      console.log('🔋 Energy Saving Mode (MANUAL) - ON');
    } else {
      this.targetFPS = 30; // Return to optimized 30fps
      this.renderer.setPixelRatio(this.pixelRatio);
      
      // Re-enable bloom pass
      if (this.savedPasses) {
        this.composer.passes = this.savedPasses;
      }

      if (this.isVisible && !this.paused) {
        this.startLoop();
      }
      
      console.log('⚡ Energy Saving Mode (MANUAL) - OFF');
    }
    
    this.frameInterval = 1000 / this.targetFPS;
    this.onResize(); // Force re-render with new pixel ratio
  }
  
  setupBatterySaving() {
    // Check battery status if available
    if ('getBattery' in navigator) {
      navigator.getBattery().then(battery => {
        this.updateBatteryMode(battery);
        
        battery.addEventListener('levelchange', () => this.updateBatteryMode(battery));
        battery.addEventListener('chargingchange', () => this.updateBatteryMode(battery));
      });
    }
    
    // Also listen for device orientation (mobile hint)
    if (window.matchMedia('(pointer: coarse)').matches) {
      this.enableBatterySaving();
    }
  }
  
  updateBatteryMode(battery) {
    if (battery.level < 0.2 && !battery.charging) {
      this.enableBatterySaving();
    } else if (battery.charging) {
      this.disableBatterySaving();
    }
  }
  
  enableBatterySaving() {
    if (this.isBatterySaving) return;
    this.isBatterySaving = true;
    this.targetFPS = 20; // Even lower FPS
    this.frameInterval = 1000 / this.targetFPS;
    
    // Reduce bloom quality further
    if (this.bloomPass) {
      this.bloomPass.strength = 0.5;
      this.bloomPass.radius = 0.2;
    }
    
    console.log('🔋 Battery saving mode enabled');
  }
  
  disableBatterySaving() {
    if (!this.isBatterySaving) return;
    this.isBatterySaving = false;
    this.targetFPS = 30;
    this.frameInterval = 1000 / this.targetFPS;
    
    if (this.bloomPass) {
      this.bloomPass.strength = 0.8;
      this.bloomPass.radius = 0.3;
    }
    
    console.log('⚡ Performance mode enabled');
  }
  
  onMouseMove(event) {
    this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    this.targetRotation.x = this.mouse.y * 0.1;
    this.targetRotation.y = this.mouse.x * 0.1;
  }
  
  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setSize(
      Math.floor(window.innerWidth * 0.5),
      Math.floor(window.innerHeight * 0.5)
    );

    if (this.isEnergySavingMode) {
      this.renderFrame();
    }
  }

  renderFrame() {
    if (!this.scene || !this.camera || !this.composer) return;
    this.camera.lookAt(0, 0, 0);
    this.composer.render();
  }
  
  // FPS CAPPED ANIMATION LOOP
  animate(currentTime) {
    this.animationId = requestAnimationFrame((time) => this.animate(time));
    
    // Skip if tab is hidden OR manually paused
    if (!this.isVisible || this.paused || this.isEnergySavingMode) return;
    
    // FPS limiting
    const elapsed = currentTime - this.lastFrameTime;
    if (elapsed < this.frameInterval) return;
    this.lastFrameTime = currentTime - (elapsed % this.frameInterval);
    
    const time = this.clock.getElapsedTime();
    
    // Slower animations when battery saving
    const animSpeed = this.isBatterySaving ? 0.5 : 1;
    
    if (this.planetMesh) {
      this.planetMesh.rotation.y += 0.001 * animSpeed;
    }
    
    if (this.ring) {
      this.ring.rotation.z += 0.0003 * animSpeed;
    }
    
    if (this.stars) {
      this.stars.rotation.y += 0.00005 * animSpeed;
    }
    
    if (this.particles) {
      this.particles.rotation.y += 0.001 * animSpeed;
    }
    
    // Camera parallax (only update every 2nd frame in battery mode)
    if (!this.isBatterySaving || Math.floor(time * 30) % 2 === 0) {
      this.camera.position.x += (this.targetRotation.y * 2 - this.camera.position.x) * 0.05;
      this.camera.position.y += (this.targetRotation.x * 2 - this.camera.position.y) * 0.05;
      this.camera.lookAt(0, 0, 0);
    }
    
    this.updateExplosions();
    
    // Render
    this.renderFrame();
  }

  pause() {
    if (this.paused) return;
    this.paused = true;
    this.stopLoop();
    console.log('⏸️ SpaceScene Paused (Admin Mode)');
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.lastFrameTime = performance.now();
    if (!this.isEnergySavingMode && this.isVisible) {
      this.startLoop();
    } else if (this.isEnergySavingMode) {
      this.renderFrame();
    }
    console.log('▶️ SpaceScene Resumed');
  }
  
  destroy() {
    window.removeEventListener('resize', () => this.onResize());
    document.removeEventListener('mousemove', (e) => this.onMouseMove(e));
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }
}
