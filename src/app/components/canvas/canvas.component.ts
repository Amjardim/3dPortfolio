import { Component, OnInit, OnDestroy, PLATFORM_ID, ViewChild, ElementRef, inject } from '@angular/core';
import { DOCUMENT, isPlatformBrowser, CommonModule } from '@angular/common';

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { FlyControls } from 'three/examples/jsm/controls/FlyControls';

@Component({
  selector: 'app-canvas',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './canvas.component.html',
  styleUrls: ['./canvas.component.scss']
})
export class CanvasComponent implements OnInit, OnDestroy {
  public scene!: THREE.Scene;
  public camera!: THREE.PerspectiveCamera;
  public renderer!: THREE.WebGLRenderer;
  private readonly platformId = inject(PLATFORM_ID);
  private readonly document = inject(DOCUMENT);
  @ViewChild('container', { static: true }) private containerRef!: ElementRef<HTMLDivElement>;
  private animateHandle?: number;
  private clock = new THREE.Clock();
  private keyState: Record<string, boolean> = {};
  private baseSpeed = 2.0; // units per second
  private onResize = () => this.onWindowResize();
  private flyControls?: FlyControls;
  private videoElements: HTMLVideoElement[] = []; // Track video elements for cleanup
  private fixedHeight: number = 0; // Fixed camera height (person height)
  private sceneBounds?: { min: THREE.Vector3; max: THREE.Vector3 }; // Scene bounding box
  private maxRollAngle: number = Math.PI / 12; // Maximum roll angle (15 degrees)
  private monitors: THREE.Mesh[] = []; // Store monitor meshes for interaction
  private monitorLights: THREE.SpotLight[] = []; // Store spot lights for monitors
  private raycaster: THREE.Raycaster = new THREE.Raycaster();
  private mouse: THREE.Vector2 = new THREE.Vector2();
  private hoveredMonitor: THREE.Mesh | null = null; // Currently hovered monitor
  private focusedMonitor: THREE.Mesh | null = null; // Currently focused monitor (camera looking at it)
  private previousCameraState?: { position: THREE.Vector3; quaternion: THREE.Quaternion }; // Store previous camera state
  private isTransitioning: boolean = false; // Track if camera is transitioning
  // Music player properties
  private musicPlayerMonitor?: THREE.Mesh; // Reference to the music player monitor
  private musicPlayerCanvas?: HTMLCanvasElement; // Canvas for music player UI
  private musicPlayerTexture?: THREE.CanvasTexture; // Texture for music player
  private audioElement?: HTMLAudioElement; // Audio element for playing music
  private musicFiles: string[] = []; // List of music file paths
  private currentSongIndex: number = 0; // Current song index
  private isPlaying: boolean = false; // Play/pause state
  private buttonRegions: { name: string; x: number; y: number; width: number; height: number }[] = []; // Button click regions

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.init();
    }
  }

  private init(): void {
    const container = this.containerRef.nativeElement;

    this.camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.25, 20);
    // Set refined initial transform
    this.camera.position.set(1.11, 3.83, 8.51);
    // Set initial rotation (preserve look direction but ensure no roll)
    this.camera.quaternion.set(-0.110, 0.047, 0.005, 0.993);
    // Ensure initial roll is zero
    this.camera.rotation.z = 0;


    this.scene = new THREE.Scene();

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    container.appendChild(this.renderer.domElement);


    const loader = new GLTFLoader();
    loader.load('https://localhost:7211/models/old_computers_complete.glb', async (glb) => {
      const model = glb.scene;
      await this.renderer.compileAsync(model, this.camera, this.scene);
      this.scene.add(model);

      // Calculate scene bounding box for movement limits
      const box = new THREE.Box3().setFromObject(this.scene);
      this.sceneBounds = {
        min: box.min.clone(),
        max: box.max.clone()
      };

      // Set fixed height to floor level + person height (approximately 2.5 units above floor)
      // This ensures the camera is at eye level, not on the floor
      const personHeight = 5.5;
      this.fixedHeight = this.sceneBounds.min.y + personHeight;

      // Update camera position to the calculated person height
      this.camera.position.y = this.fixedHeight;

      // Ensure camera is upright (no roll) after positioning
      this.camera.rotation.z = 0;

      this.monitors = [];

      this.scene.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const mat = child.material as THREE.Material | THREE.Material[];

          // Handle both single and multi-material meshes
          const isMonitorMaterial =
            Array.isArray(mat)
              ? mat.some((m) => (m as any).userData?.isMonitor)
              : (mat as any).userData?.isMonitor;

          // Check both mesh and material userData
          if (child.userData?.['isMonitor'] || isMonitorMaterial) {
            this.monitors.push(child);
            // Make monitors clickable by storing original material references
            if (!child.userData['originalMaterial']) {
              child.userData['originalMaterial'] = child.material;
            }
          }
        }
      });

      //Apply different content to monitors
      if (this.monitors.length > 0 && this.monitors[0]) {
        this.applyVideoTexture(this.monitors[0], 'assets/videos/Pingpong.mp4');
        this.addMonitorLight(this.monitors[0], 0.7, 0.85, 1.0); // Slight blue tint
      }
      if (this.monitors.length > 1 && this.monitors[1]) {
        this.applyVideoTexture(this.monitors[1], 'assets/videos/NeoVSMerovingian.mp4');
        this.addMonitorLight(this.monitors[1], 1.0, 0.95, 0.8); // Slight yellow tint
      }
      if (this.monitors.length > 2 && this.monitors[2]) {
        this.applyImageTexture(this.monitors[2], 'assets/images/QRCode.png').catch(console.error);
        this.addMonitorLight(this.monitors[2], 0.8, 0.9, 1.0);
      }
      if (this.monitors.length > 3 && this.monitors[3]) {
        this.applyVideoTexture(this.monitors[3], 'assets/videos/RonaldinhoMagic.mp4');
        this.addMonitorLight(this.monitors[3], 0.75, 1.0, 0.85); // Slight green tint
      }
      if (this.monitors.length > 4 && this.monitors[4]) {
        this.applyVideoTexture(this.monitors[4], 'assets/videos/ColoredStatic.mp4');
        this.addMonitorLight(this.monitors[4], 1.0, 0.8, 0.9); // Slight pink tint
      }
      if (this.monitors.length > 5 && this.monitors[5]) {
        this.applyImageTexture(this.monitors[5], "assets/images/DontPress.png");
        this.addMonitorLight(this.monitors[5], 1.0, 0.8, 0.8); // Slight red tint
      }
      if (this.monitors.length > 6 && this.monitors[6]) {
        this.musicPlayerMonitor = this.monitors[6];
        this.initializeMusicPlayer();
        this.addMonitorLight(this.monitors[6], 0.8, 0.9, 1.0);
      }
      if (this.monitors.length > 7 && this.monitors[7]) {
        this.applyVideoTexture(this.monitors[7], 'assets/videos/Static.mp4');
        this.addMonitorLight(this.monitors[7], 0.8, 0.9, 1.0);
      }

      if (this.monitors.length > 8 && this.monitors[8]) {
        this.applyVideoTexture(this.monitors[8], 'assets/videos/Teamwork.mp4');
        this.addMonitorLight(this.monitors[8], 0.8, 0.9, 1.0);
      }

      // Setup mouse interaction for monitors
      this.setupMonitorInteraction();

      this.render();
      });

    this.flyControls = new FlyControls(this.camera, this.renderer.domElement);
    this.flyControls.movementSpeed = 5;
    this.flyControls.rollSpeed = Math.PI / 12; // Allow limited roll (Q/E keys) - about 15 degrees per second
    this.flyControls.dragToLook = true; // hold mouse to look
    this.flyControls.autoForward = false;

    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKeyDown, false);
    window.addEventListener('keyup', this.onKeyUp, false);

    this.startAnimationLoop();
  }

  /**
   * Setup mouse interaction for monitors (hover highlighting and clicking)
   */
  private setupMonitorInteraction(): void {
    const container = this.renderer.domElement;

    container.addEventListener('mousemove', this.onMouseMove);
    container.addEventListener('click', this.onMouseClick);
    container.style.cursor = 'default';
  }

  /**
   * Handle mouse move to detect hover over monitors
   */
  private onMouseMove = (event: MouseEvent): void => {
    if (this.isTransitioning || this.focusedMonitor) return; // Don't interact during transitions or when focused

    const container = this.renderer.domElement;
    const rect = container.getBoundingClientRect();

    // Calculate mouse position in normalized device coordinates
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    // Update raycaster
    this.raycaster.setFromCamera(this.mouse, this.camera);

    // Check for intersections with monitors
    const intersects = this.raycaster.intersectObjects(this.monitors, true);

    if (intersects.length > 0) {
      const intersectedMonitor = intersects[0].object as THREE.Mesh;

      if (this.hoveredMonitor !== intersectedMonitor) {
        // Remove highlight from previous monitor
        if (this.hoveredMonitor) {
          this.removeMonitorHighlight(this.hoveredMonitor);
        }

        // Add highlight to new monitor
        this.hoveredMonitor = intersectedMonitor;
        this.addMonitorHighlight(intersectedMonitor);
        container.style.cursor = 'pointer';
      }
    } else {
      // Remove highlight if not hovering over any monitor
      if (this.hoveredMonitor) {
        this.removeMonitorHighlight(this.hoveredMonitor);
        this.hoveredMonitor = null;
        container.style.cursor = 'default';
      }
    }
  };

  /**
   * Handle mouse click on monitors
   */
  private onMouseClick = (event: MouseEvent): void => {
    if (this.isTransitioning) return;

    const container = this.renderer.domElement;
    const rect = container.getBoundingClientRect();

    // Calculate mouse position in normalized device coordinates
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    // Update raycaster
    this.raycaster.setFromCamera(this.mouse, this.camera);

    // Check for intersections with monitors
    const intersects = this.raycaster.intersectObjects(this.monitors, true);

    // If clicking outside monitors and focused on music player, return to previous position
    if (intersects.length === 0 && this.focusedMonitor === this.musicPlayerMonitor) {
      this.returnToPreviousPosition();
      return;
    }

    if (intersects.length > 0) {
      const clickedMonitor = intersects[0].object as THREE.Mesh;
      const intersection = intersects[0];

      // Check if this is the music player monitor and we're focused on it
      if (clickedMonitor === this.musicPlayerMonitor && this.focusedMonitor === this.musicPlayerMonitor) {
        // Get UV coordinates from intersection (try uv first, then uv2)
        const uvCoords = (intersection as any).uv || (intersection as any).uv2;
        if (uvCoords) {
          const uv = { x: uvCoords.x, y: uvCoords.y };
          this.handleMusicPlayerClick(uv);
        }
        return; // Don't move camera when clicking buttons
      }

      if (this.focusedMonitor === clickedMonitor) {
        // Clicking the same monitor again - return to previous position
        this.returnToPreviousPosition();
      } else {
        // Clicking a new monitor - move camera to it
        this.moveCameraToMonitor(clickedMonitor);
      }
    }
  };

  /**
   * Add white border highlight to a monitor
   */
  private addMonitorHighlight(monitor: THREE.Mesh): void {
    // Create outline effect using edge geometry
    const edges = new THREE.EdgesGeometry(monitor.geometry);
    const outline = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 3 })
    );

    // Store outline reference and scale it slightly larger
    monitor.userData['outline'] = outline;
    outline.scale.set(1.02, 1.02, 1.02);
    outline.position.copy(monitor.position);
    outline.rotation.copy(monitor.rotation);
    outline.quaternion.copy(monitor.quaternion);

    // Add outline to the same parent as monitor
    if (monitor.parent) {
      monitor.parent.add(outline);
    } else {
      this.scene.add(outline);
    }
  }

  /**
   * Remove highlight from a monitor
   */
  private removeMonitorHighlight(monitor: THREE.Mesh): void {
    if (monitor.userData['outline']) {
      const outline = monitor.userData['outline'] as THREE.LineSegments;
      if (outline.parent) {
        outline.parent.remove(outline);
      }
      outline.geometry.dispose();
      (outline.material as THREE.Material).dispose();
      delete monitor.userData['outline'];
    }
  }

  /**
   * Move camera to a fixed position in front of the monitor
   */
  private moveCameraToMonitor(monitor: THREE.Mesh): void {
    if (this.isTransitioning) return;

    // Store current camera state
    this.previousCameraState = {
      position: this.camera.position.clone(),
      quaternion: this.camera.quaternion.clone()
    };

    // Calculate monitor's bounding box in world space
    monitor.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(monitor);
    const size = box.getSize(new THREE.Vector3());
    const monitorCenter = box.getCenter(new THREE.Vector3()); // Already in world coordinates

    // Get monitor's world matrix to extract its orientation
    const monitorWorldMatrix = new THREE.Matrix4();
    monitorWorldMatrix.copy(monitor.matrixWorld);

    // Extract the monitor's local Z-axis direction in world space from the matrix
    // Column 2 (index 2) is the Z-axis direction vector
    const worldZ = new THREE.Vector3();
    worldZ.setFromMatrixColumn(monitorWorldMatrix, 2);
    worldZ.normalize();

    // The screen typically faces along negative Z in local space
    // So we want to position the camera in the direction the screen faces (negative Z = front)
    // If pointing to back, use positive Z instead (invert the logic)
    const screenNormal = worldZ.clone();

    // Calculate optimal viewing distance based on monitor size
    // Use the larger dimension to ensure we can see the whole monitor
    const maxDimension = Math.max(size.x, size.y, size.z);
    const distance = maxDimension * 1.5; // Position 1.5x the monitor size away for closer viewing

    // Position camera in front of monitor (in the direction the screen faces)
    const targetPosition = monitorCenter.clone().add(screenNormal.multiplyScalar(distance));

    // Keep camera at monitor center height for straight-on viewing
    targetPosition.y = monitorCenter.y;

    // Calculate rotation to look at monitor center
    const up = new THREE.Vector3(0, 1, 0);
    const direction = monitorCenter.clone().sub(targetPosition).normalize();

    // Create a look-at matrix
    const matrix = new THREE.Matrix4().lookAt(targetPosition, monitorCenter, up);
    const targetQuaternion = new THREE.Quaternion().setFromRotationMatrix(matrix);

    // Debug logging
    console.log('Moving camera to monitor:', {
      monitorCenter,
      targetPosition,
      distance,
      size,
      screenNormal
    });

    this.focusedMonitor = monitor;
    this.isTransitioning = true;

    // Animate camera transition
    this.animateCameraToPosition(targetPosition, targetQuaternion, () => {
      this.isTransitioning = false;
      // Disable fly controls while focused on monitor
      if (this.flyControls) {
        this.flyControls.enabled = false;
      }
    });
  }

  /**
   * Return camera to previous first-person position
   */
  private returnToPreviousPosition(): void {
    if (!this.previousCameraState || this.isTransitioning) return;

    this.isTransitioning = true;

    // Animate back to previous position
    this.animateCameraToPosition(
      this.previousCameraState.position,
      this.previousCameraState.quaternion,
      () => {
        this.isTransitioning = false;
        this.focusedMonitor = null;
        this.previousCameraState = undefined;

        // Re-enable fly controls
        if (this.flyControls) {
          this.flyControls.enabled = true;
        }

        // Remove any remaining highlights
        if (this.hoveredMonitor) {
          this.removeMonitorHighlight(this.hoveredMonitor);
          this.hoveredMonitor = null;
        }
      }
    );
  }

  /**
   * Animate camera transition to target position and rotation
   */
  private animateCameraToPosition(
    targetPosition: THREE.Vector3,
    targetQuaternion: THREE.Quaternion,
    onComplete: () => void
  ): void {
    const startPosition = this.camera.position.clone();
    const startQuaternion = this.camera.quaternion.clone();
    const duration = 1000; // 1 second transition
    const startTime = Date.now();

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Easing function for smooth transition
      const easeProgress = progress * (2 - progress); // Ease-out

      // Interpolate position
      this.camera.position.lerpVectors(startPosition, targetPosition, easeProgress);

      // Interpolate rotation using quaternion slerp
      const tempQuat = new THREE.Quaternion();
      tempQuat.slerpQuaternions(startQuaternion, targetQuaternion, easeProgress);
      this.camera.quaternion.copy(tempQuat);

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        onComplete();
      }
    };

    animate();
  }

  private onWindowResize(): void {
    const container = this.containerRef.nativeElement;
    this.camera.aspect = container.clientWidth / container.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.render();
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private startAnimationLoop(): void {
    const loop = () => {
      const delta = this.clock.getDelta();
      if (this.flyControls && !this.isTransitioning && !this.focusedMonitor) {
        this.flyControls.update(delta);
        // Lock camera height to fixed person height
        this.camera.position.y = this.fixedHeight;
        // Limit roll rotation to a small range (±15 degrees)
        this.camera.rotation.z = Math.max(-this.maxRollAngle, Math.min(this.maxRollAngle, this.camera.rotation.z));
        // Clamp camera position to scene bounds
        this.constrainCameraToBounds();
      }
      if (!this.isTransitioning && !this.focusedMonitor) {
        this.updateCameraFromKeys(delta);
      }
      this.render();
      this.animateHandle = requestAnimationFrame(loop);
    };
    this.animateHandle = requestAnimationFrame(loop);
  }

  /**
   * Constrains camera movement to within the scene bounds
   */
  private constrainCameraToBounds(): void {
    if (!this.sceneBounds) return;

    const padding = 0.5; // Small padding to prevent camera from going exactly to edge
    const x = this.camera.position.x;
    const y = this.camera.position.y;
    const z = this.camera.position.z;

    // Clamp X position
    this.camera.position.x = Math.max(
      this.sceneBounds.min.x + padding,
      Math.min(this.sceneBounds.max.x - padding, x)
    );

    // Y is already locked to fixedHeight, but ensure it's within bounds
    this.camera.position.y = Math.max(
      this.sceneBounds.min.y + padding,
      Math.min(this.sceneBounds.max.y - padding, this.fixedHeight)
    );

    // Clamp Z position
    this.camera.position.z = Math.max(
      this.sceneBounds.min.z + padding,
      Math.min(this.sceneBounds.max.z - padding, z)
    );
  }

  private updateCameraFromKeys(delta: number): void {
    if (this.flyControls) {
      // FlyControls already handles WASD/EQ + mouse look; skip manual movement to avoid conflicts
      return;
    }
    const speed = this.baseSpeed * delta;

    const direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);

    const move = new THREE.Vector3();

    // Forward / Back (W / S)
    if (this.keyState['KeyW']) {
      const v = direction.clone().multiplyScalar(speed);
      this.camera.position.add(v);
      move.add(v);
    }
    if (this.keyState['KeyS']) {
      const v = direction.clone().multiplyScalar(-speed);
      this.camera.position.add(v);
      move.add(v);
    }

    // Strafe Left / Right (A / D)
    const right = new THREE.Vector3().crossVectors(direction, this.camera.up).normalize();
    if (this.keyState['KeyD']) {
      const v = right.clone().multiplyScalar(speed);
      this.camera.position.add(v);
      move.add(v);
    }
    if (this.keyState['KeyA']) {
      const v = right.clone().multiplyScalar(-speed);
      this.camera.position.add(v);
      move.add(v);
    }

    // Up / Down (Space / Shift)
    const up = this.camera.up.clone().normalize();
    if (this.keyState['Space']) {
      const v = up.clone().multiplyScalar(speed);
      this.camera.position.add(v);
      move.add(v);
    }
    if (this.keyState['ShiftLeft'] || this.keyState['ShiftRight']) {
      const v = up.clone().multiplyScalar(-speed);
      this.camera.position.add(v);
      move.add(v);
    }

    // no target to sync when using FlyControls or manual free camera
  }

  private onKeyDown = (event: KeyboardEvent) => {
    this.keyState[event.code] = true;
  };

  private onKeyUp = (event: KeyboardEvent) => {
    this.keyState[event.code] = false;
  };

  /**
   * Applies a video texture to a monitor mesh with emissive lighting
   */
  private applyVideoTexture(monitor: THREE.Mesh, videoPath: string): void {
    const video = document.createElement('video');
    video.src = videoPath;
    video.crossOrigin = 'anonymous';
    video.loop = true;
    video.muted = true; // Muted for autoplay
    video.play().catch((err) => {
      console.warn('Video autoplay failed:', err);
    });

    this.videoElements.push(video);

    const texture = new THREE.VideoTexture(video);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false; // Video textures don't need mipmaps
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.repeat.set(1, 1); // Ensure texture displays at 1:1 scale
    texture.offset.set(0, 0); // No offset

    this.applyTextureToMonitor(monitor, texture, 1.0, true); // Reduced emissive intensity for videos, isVideo flag
  }

  /**
   * Applies an image texture to a monitor mesh with emissive lighting
   */
  private async applyImageTexture(monitor: THREE.Mesh, imagePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const loader = new THREE.TextureLoader();
      loader.load(
        imagePath,
        (texture) => {
          texture.minFilter = THREE.LinearFilter;
          texture.magFilter = THREE.LinearFilter;
          texture.wrapS = THREE.ClampToEdgeWrapping;
          texture.wrapT = THREE.ClampToEdgeWrapping;
          texture.repeat.set(1, 1); // Ensure texture displays at 1:1 scale
          texture.offset.set(0, 0); // No offset
          this.applyTextureToMonitor(monitor, texture, 1.5);
          resolve();
        },
        undefined,
        (error) => {
          console.error('Error loading image texture:', error);
          reject(error);
        }
      );
    });
  }

  /**
   * Applies a text texture to a monitor mesh with emissive lighting
   */
  private applyTextTexture(
    monitor: THREE.Mesh,
    text: string,
    options: {
      fontSize?: number;
      fontColor?: string;
      bgColor?: string;
      fontFamily?: string;
      padding?: number;
      fontWeight?: string;
    } = {}
  ): void {
    const {
      fontSize = 64,
      fontColor = '#ffffff',
      bgColor = '#000000',
      fontFamily = 'Arial',
      padding = 20,
      fontWeight = 'normal'
    } = options;

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) {
      console.error('Failed to get canvas context');
      return;
    }

    // Set canvas size (square for short text phrases)
    canvas.width = 2048;
    canvas.height = 2048;

    // Fill background
    context.fillStyle = bgColor;
    context.fillRect(0, 0, canvas.width, canvas.height);

    // Configure text with bold white text
    context.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
    context.fillStyle = fontColor;
    context.textAlign = 'center'; // Center horizontally
    context.textBaseline = 'middle'; // Center vertically

    // Remove glow effect for clean white text
    context.shadowBlur = 0;

    // Word wrap function for long text
    const maxWidth = canvas.width - (padding * 2);
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';

    words.forEach((word) => {
      const testLine = currentLine + (currentLine ? ' ' : '') + word;
      const metrics = context.measureText(testLine);
      if (metrics.width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    });
    if (currentLine) {
      lines.push(currentLine);
    }

    // Handle explicit newlines (split by \n and wrap each section)
    const finalLines: string[] = [];
    lines.forEach((line) => {
      if (line.includes('\n')) {
        line.split('\n').forEach((l) => finalLines.push(l));
      } else {
        finalLines.push(line);
      }
    });

    // Draw wrapped text centered both horizontally and vertically
    const lineHeight = fontSize * 1.2; // Tighter line spacing for short phrases
    const totalHeight = finalLines.length * lineHeight;
    const startY = (canvas.height - totalHeight) / 2 + lineHeight / 2; // Center with line height offset

    finalLines.forEach((line, index) => {
      // Center each line horizontally
      context.fillText(line, canvas.width / 2, startY + index * lineHeight);
    });

    // Create texture from canvas
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.repeat.set(1, 1); // Ensure texture displays at 1:1 scale
    texture.offset.set(0, 0); // No offset

    this.applyTextureToMonitor(monitor, texture, 1.8);
  }

  /**
   * Helper method to normalize UV coordinates to full 0-1 range
   * Use this if the monitor screen UVs are mapped to a small portion of the texture
   */
  private normalizeMonitorUVs(monitor: THREE.Mesh): void {
    if (!monitor.geometry || !monitor.geometry.attributes['uv']) {
      return;
    }

    const uvAttribute = monitor.geometry.attributes['uv'] as THREE.BufferAttribute;
    const uvArray = uvAttribute.array as Float32Array;

    // Find min/max UV values
    let minU = Infinity, maxU = -Infinity;
    let minV = Infinity, maxV = -Infinity;

    for (let i = 0; i < uvArray.length; i += 2) {
      const u = uvArray[i];
      const v = uvArray[i + 1];
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }

    // If UVs are in a small range, scale them to full 0-1 range
    const uRange = maxU - minU;
    const vRange = maxV - minV;

    // Only normalize if the range is significantly less than 1 (indicating zoomed UVs)
    if (uRange > 0.01 && uRange < 0.95 && vRange > 0.01 && vRange < 0.95) {
      for (let i = 0; i < uvArray.length; i += 2) {
        const u = uvArray[i];
        const v = uvArray[i + 1];
        // Normalize to 0-1 range
        const normalizedU = (u - minU) / uRange;
        const normalizedV = (v - minV) / vRange;
        uvArray[i] = normalizedU;
        uvArray[i + 1] = normalizedV;
      }
      uvAttribute.needsUpdate = true;
    }
  }

  /**
   * Applies a texture to a monitor mesh with emissive material
   * IMPORTANT: Clones materials to ensure each monitor has its own unique material instance
   */
  private applyTextureToMonitor(monitor: THREE.Mesh, texture: THREE.Texture, emissiveIntensity: number = 1.5, isVideo: boolean = false): void {
    const originalMaterial = monitor.material as THREE.Material | THREE.Material[];

    if (Array.isArray(originalMaterial)) {
      // Handle multi-material meshes - clone each material
      const clonedMaterials = originalMaterial.map((mat) => {
        if (mat instanceof THREE.MeshStandardMaterial || mat instanceof THREE.MeshPhysicalMaterial) {
          // Clone the material to avoid sharing between monitors
          const clonedMat = mat.clone();
          this.configureEmissiveMaterial(clonedMat, texture, emissiveIntensity, isVideo);
          return clonedMat;
        } else {
          // Convert to MeshStandardMaterial
          const newMat = new THREE.MeshStandardMaterial();
          this.configureEmissiveMaterial(newMat, texture, emissiveIntensity, isVideo);
          return newMat;
        }
      });
      monitor.material = clonedMaterials;
    } else {
      // Handle single material - clone it to avoid sharing
      if (originalMaterial instanceof THREE.MeshStandardMaterial || originalMaterial instanceof THREE.MeshPhysicalMaterial) {
        // Clone the material so each monitor has its own instance
        const clonedMat = originalMaterial.clone();
        this.configureEmissiveMaterial(clonedMat, texture, emissiveIntensity, isVideo);
        monitor.material = clonedMat;
      } else {
        // Convert to MeshStandardMaterial
        const newMat = new THREE.MeshStandardMaterial();
        this.configureEmissiveMaterial(newMat, texture, emissiveIntensity, isVideo);
        monitor.material = newMat;
      }
    }

    // Update UV mapping if needed (some models may need this)
    if (monitor.geometry) {
      monitor.geometry.computeBoundingBox();

      // Normalize UV coordinates if they're in a small range (fixes zoomed-in textures)
      this.normalizeMonitorUVs(monitor);
    }
  }

  /**
   * Configures a material with emissive properties to simulate screen glow
   */
  private configureEmissiveMaterial(
    material: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial,
    texture: THREE.Texture,
    emissiveIntensity: number,
    isVideo: boolean = false
  ): void {
    material.map = texture;
    material.emissive = new THREE.Color(0xffffff);
    material.emissiveMap = texture;
    material.emissiveIntensity = emissiveIntensity;

    // For videos, enable tone mapping to reduce brightness
    // For other content (text/images), disable tone mapping for better glow
    material.toneMapped = isVideo;

    // Reduce reflections by making the material completely matte (non-reflective)
    // This prevents other monitor lights from reflecting on the screen and blocking content
    material.roughness = 1.0; // Maximum roughness = completely matte, no gloss
    material.metalness = 0.0; // No metallic properties = no reflections

    // Increase emissive properties for better screen glow effect
    if (material instanceof THREE.MeshStandardMaterial) {
      material.needsUpdate = true;
    }
  }

  /**
   * Adds a spot light positioned at the monitor screen to illuminate the scene outward
   */
  private addMonitorLight(monitor: THREE.Mesh, r: number, g: number, b: number, intensity: number = 1, distance: number = 10): void {
    // Update monitor's world matrix to get accurate position
    monitor.updateMatrixWorld(true);

    // Calculate monitor's bounding box in world space
    const box = new THREE.Box3().setFromObject(monitor);
    const monitorCenter = box.getCenter(new THREE.Vector3());

    // Get monitor's world matrix to extract its orientation
    const monitorWorldMatrix = new THREE.Matrix4();
    monitorWorldMatrix.copy(monitor.matrixWorld);

    // Extract the monitor's local Z-axis direction in world space (screen normal)
    const worldZ = new THREE.Vector3();
    worldZ.setFromMatrixColumn(monitorWorldMatrix, 2);
    worldZ.normalize();

    // Position light at monitor center, but further behind the screen to avoid blocking content
    const lightOffsetBack = -0.5; // Increased offset behind the screen to prevent visibility
    const lightPosition = monitorCenter.clone().add(worldZ.clone().multiplyScalar(lightOffsetBack));

    // Calculate target position (light shines away from monitor in the direction it faces)
    const targetPosition = monitorCenter.clone().add(worldZ.clone().multiplyScalar(2.0));

    // Create spot light with the specified color
    // SpotLight shines in a cone from position toward target
    // Increased cone angle (Math.PI / 2 = 90 degrees), decreased decay (0.5), increased default intensity (4.0)
    const light = new THREE.SpotLight(new THREE.Color(r, g, b), intensity, distance, Math.PI / 2, 1, 0.5);
    light.position.copy(lightPosition);
    light.target.position.copy(targetPosition);

    // Update target matrix to ensure it's properly oriented
    light.target.updateMatrixWorld();

    // Add target to scene (required for SpotLight)
    this.scene.add(light.target);

    // Add light to scene
    this.scene.add(light);
    this.monitorLights.push(light);
  }

  /**
   * Initialize the music player
   */
  private initializeMusicPlayer(): void {
    // Load music files
    this.musicFiles = [
      'assets/music/Deftones - My Own Summer.mp3',
      'assets/music/Ghost.mp3',
      'assets/music/Logos.mp3',
      'assets/music/Profissional.mp3',
      'assets/music/Spybreak!.mp3'
    ];

    // Create audio element
    this.audioElement = new Audio();
    this.audioElement.addEventListener('ended', () => {
      this.nextSong();
    });

    // Create canvas for music player UI
    this.musicPlayerCanvas = document.createElement('canvas');
    this.musicPlayerCanvas.width = 2048;
    this.musicPlayerCanvas.height = 2048;

    // Draw initial UI
    this.drawMusicPlayer();

    // Create texture from canvas
    this.musicPlayerTexture = new THREE.CanvasTexture(this.musicPlayerCanvas);
    this.musicPlayerTexture.minFilter = THREE.LinearFilter;
    this.musicPlayerTexture.magFilter = THREE.LinearFilter;
    this.musicPlayerTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.musicPlayerTexture.wrapT = THREE.ClampToEdgeWrapping;

    // Apply texture to monitor
    if (this.musicPlayerMonitor) {
      this.applyTextureToMonitor(this.musicPlayerMonitor, this.musicPlayerTexture, 1.8);
    }
  }

  /**
   * Draw the music player UI with buttons
   */
  private drawMusicPlayer(): void {
    if (!this.musicPlayerCanvas) return;

    const ctx = this.musicPlayerCanvas.getContext('2d');
    if (!ctx) return;

    const width = this.musicPlayerCanvas.width;
    const height = this.musicPlayerCanvas.height;

    // Clear canvas with dark blue background
    ctx.fillStyle = '#1a1a3e';
    ctx.fillRect(0, 0, width, height);

    // Draw current song name (larger title)
    const currentSong = this.musicFiles[this.currentSongIndex] || 'No song';
    const songName = currentSong.split('/').pop()?.replace('.mp3', '') || 'Unknown';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 140px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(songName, width / 2, height * 0.3);

    // Button dimensions (larger buttons)
    const buttonSize = 280;
    const buttonY = height / 2;
    const centerX = width / 2;
    const spacing = 400;

    // Clear button regions
    this.buttonRegions = [];

    // Previous button (left)
    const prevX = centerX - spacing - buttonSize / 2;
    this.drawButton(ctx, prevX, buttonY, buttonSize, '◄◄', '#4a90e2');
    this.buttonRegions.push({
      name: 'previous',
      x: prevX - buttonSize / 2,
      y: buttonY - buttonSize / 2,
      width: buttonSize,
      height: buttonSize
    });

    // Play/Pause button (center)
    const playX = centerX;
    const playIcon = this.isPlaying ? '⏸' : '▶';
    this.drawButton(ctx, playX, buttonY, buttonSize, playIcon, '#2ecc71');
    this.buttonRegions.push({
      name: 'playpause',
      x: playX - buttonSize / 2,
      y: buttonY - buttonSize / 2,
      width: buttonSize,
      height: buttonSize
    });

    // Next button (right)
    const nextX = centerX + spacing + buttonSize / 2;
    this.drawButton(ctx, nextX, buttonY, buttonSize, '►►', '#4a90e2');
    this.buttonRegions.push({
      name: 'next',
      x: nextX - buttonSize / 2,
      y: buttonY - buttonSize / 2,
      width: buttonSize,
      height: buttonSize
    });

    // Update texture
    if (this.musicPlayerTexture) {
      this.musicPlayerTexture.needsUpdate = true;
    }
  }

  /**
   * Draw a button on the canvas
   */
  private drawButton(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, icon: string, color: string): void {
    // Draw button background
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, size / 2, 0, Math.PI * 2);
    ctx.fill();

    // Draw button border
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 8;
    ctx.stroke();

    // Draw icon
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${size * 0.5}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(icon, x, y);
  }

  /**
   * Handle click on music player buttons
   */
  private handleMusicPlayerClick(uv: { x: number; y: number }): void {
    if (!this.musicPlayerCanvas) return;

    // Convert UV coordinates to canvas coordinates
    const canvasX = uv.x * this.musicPlayerCanvas.width;
    const canvasY = (1 - uv.y) * this.musicPlayerCanvas.height; // Flip Y coordinate

    // Check which button was clicked
    for (const button of this.buttonRegions) {
      if (
        canvasX >= button.x &&
        canvasX <= button.x + button.width &&
        canvasY >= button.y &&
        canvasY <= button.y + button.height
      ) {
        switch (button.name) {
          case 'playpause':
            this.playPause();
            break;
          case 'next':
            this.nextSong();
            break;
          case 'previous':
            this.previousSong();
            break;
        }
        break;
      }
    }
  }

  /**
   * Toggle play/pause
   */
  private playPause(): void {
    if (!this.audioElement) return;

    if (this.isPlaying) {
      this.audioElement.pause();
      this.isPlaying = false;
    } else {
      if (!this.audioElement.src || this.audioElement.src.endsWith('undefined')) {
        this.loadCurrentSong();
      }
      this.audioElement.play().catch((err) => {
        console.warn('Audio play failed:', err);
      });
      this.isPlaying = true;
    }
    this.drawMusicPlayer();
  }

  /**
   * Play next song
   */
  private nextSong(): void {
    this.currentSongIndex = (this.currentSongIndex + 1) % this.musicFiles.length;
    this.loadCurrentSong();
    if (this.isPlaying) {
      this.audioElement?.play().catch((err) => {
        console.warn('Audio play failed:', err);
      });
    }
    this.drawMusicPlayer();
  }

  /**
   * Play previous song
   */
  private previousSong(): void {
    this.currentSongIndex = (this.currentSongIndex - 1 + this.musicFiles.length) % this.musicFiles.length;
    this.loadCurrentSong();
    if (this.isPlaying) {
      this.audioElement?.play().catch((err) => {
        console.warn('Audio play failed:', err);
      });
    }
    this.drawMusicPlayer();
  }

  /**
   * Load the current song
   */
  private loadCurrentSong(): void {
    if (!this.audioElement || this.musicFiles.length === 0) return;

    const songPath = this.musicFiles[this.currentSongIndex];
    this.audioElement.src = songPath;
    this.audioElement.load();
  }

  ngOnDestroy(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    // Clean up audio element
    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement.src = '';
      this.audioElement.load();
      this.audioElement = undefined;
    }

    // Clean up music player texture
    if (this.musicPlayerTexture) {
      this.musicPlayerTexture.dispose();
      this.musicPlayerTexture = undefined;
    }

    // Clean up video elements
    this.videoElements.forEach((video) => {
      video.pause();
      video.src = '';
      video.load();
    });
    this.videoElements = [];

    // Clean up monitor lights
    this.monitorLights.forEach((light) => {
      // Remove target from scene (SpotLight has a target object)
      this.scene.remove(light.target);
      this.scene.remove(light);
      light.dispose();
    });
    this.monitorLights = [];

    // Clean up monitor highlights
    this.monitors.forEach((monitor) => {
      this.removeMonitorHighlight(monitor);
    });

    // Remove mouse event listeners
    const container = this.renderer?.domElement;
    if (container) {
      container.removeEventListener('mousemove', this.onMouseMove);
      container.removeEventListener('click', this.onMouseClick);
    }

    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKeyDown, false);
    window.removeEventListener('keyup', this.onKeyUp, false);
    if (this.animateHandle) cancelAnimationFrame(this.animateHandle);
  }
}
