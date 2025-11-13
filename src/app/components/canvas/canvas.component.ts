import { Component, OnInit, OnDestroy, PLATFORM_ID, ViewChild, ElementRef, inject } from '@angular/core';
import { DOCUMENT, isPlatformBrowser, CommonModule } from '@angular/common';

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { FlyControls } from 'three/examples/jsm/controls/FlyControls';

// Constants
const CAMERA_CONFIG = {
  FOV: 45,
  NEAR: 0.25,
  FAR: 20,
  INITIAL_POSITION: { x: 1.11, y: 3.83, z: 8.51 },
  INITIAL_QUATERNION: { x: -0.110, y: 0.047, z: 0.005, w: 0.993 }
} as const;

const MOVEMENT_CONFIG = {
  BASE_SPEED: 2.0,
  MAX_ROLL_ANGLE: Math.PI / 12, // 15 degrees
  PERSON_HEIGHT: 5.5,
  BOUNDS_PADDING: 0.5
} as const;

const RENDERER_CONFIG = {
  TONE_MAPPING: THREE.ACESFilmicToneMapping,
  TONE_MAPPING_EXPOSURE: 1
} as const;

const TRANSITION_CONFIG = {
  DURATION: 1000, // 1 second
  EASING: (t: number) => t * (2 - t) // Ease-out
} as const;

const TEXTURE_CONFIG = {
  CANVAS_SIZE: 2048,
  DEFAULT_EMISSIVE_INTENSITY: 1.5,
  VIDEO_EMISSIVE_INTENSITY: 1.0,
  TEXT_EMISSIVE_INTENSITY: 1.8
} as const;

const MONITOR_LIGHT_CONFIG = {
  DEFAULT_INTENSITY: 1,
  DEFAULT_DISTANCE: 10,
  CONE_ANGLE: Math.PI / 2,
  PENUMBRA: 1,
  DECAY: 0.5,
  OFFSET_BACK: -0.5,
  TARGET_DISTANCE: 2.0
} as const;

const CAMERA_POSITION_CONFIG = {
  MONITOR_DISTANCE_MULTIPLIER: 1.5,
  CLIPBOARD_VERTICAL_OFFSET_MULTIPLIER: 1.4,
  CLIPBOARD_LATERAL_OFFSET_MULTIPLIER: 0.4
} as const;

interface MonitorConfig {
  index: number;
  type: 'video' | 'image' | 'music';
  path: string;
  lightColor: { r: number; g: number; b: number };
}

interface ButtonRegion {
  name: 'playpause' | 'next' | 'previous';
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CameraState {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

interface MaterialWithUserData extends THREE.Material {
  userData: {
    isMonitor?: boolean;
    [key: string]: unknown;
  };
}

interface IntersectionWithUV extends THREE.Intersection {
  uv?: THREE.Vector2;
  uv2?: THREE.Vector2;
}

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
  private onResize = () => this.onWindowResize();
  private flyControls?: FlyControls;

  // Scene state
  private fixedHeight = 0;
  private sceneBounds?: { min: THREE.Vector3; max: THREE.Vector3 };

  // Interaction state
  private monitors: THREE.Mesh[] = [];
  private monitorLights: THREE.SpotLight[] = [];
  private highlightTargets: THREE.Mesh[] = [];
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private hoveredObject: THREE.Mesh | null = null;
  private focusedMonitor: THREE.Mesh | null = null;
  private focusedClipboard: THREE.Mesh | null = null;
  private previousCameraState?: CameraState;
  private isTransitioning = false;

  // Clipboard state
  private clipboardPageMesh?: THREE.Mesh;
  private clipboardInteractiveMesh?: THREE.Mesh;
  private clipboardMeshGroup: THREE.Mesh[] = [];
  private clipboardPageUp?: THREE.Vector3;
  private readonly clipboardTextContent = `Project Notes
- Polish 3D workspace
- Refine monitor interactions
- Record portfolio walkthrough`;

  // Music player state
  private musicPlayerMonitor?: THREE.Mesh;
  private musicPlayerCanvas?: HTMLCanvasElement;
  private musicPlayerTexture?: THREE.CanvasTexture;
  private audioElement?: HTMLAudioElement;
  private readonly musicFiles = [
    'assets/music/Deftones - My Own Summer.mp3',
    'assets/music/Ghost.mp3',
    'assets/music/Logos.mp3',
    'assets/music/Profissional.mp3',
    'assets/music/Spybreak!.mp3'
  ];
  private currentSongIndex = 0;
  private isPlaying = false;
  private buttonRegions: ButtonRegion[] = [];

  // Resource cleanup
  private videoElements: HTMLVideoElement[] = [];

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.init();
    }
  }

  private init(): void {
    const container = this.containerRef.nativeElement;

    this.camera = new THREE.PerspectiveCamera(
      CAMERA_CONFIG.FOV,
      container.clientWidth / container.clientHeight,
      CAMERA_CONFIG.NEAR,
      CAMERA_CONFIG.FAR
    );
    this.camera.position.set(
      CAMERA_CONFIG.INITIAL_POSITION.x,
      CAMERA_CONFIG.INITIAL_POSITION.y,
      CAMERA_CONFIG.INITIAL_POSITION.z
    );
    this.camera.quaternion.set(
      CAMERA_CONFIG.INITIAL_QUATERNION.x,
      CAMERA_CONFIG.INITIAL_QUATERNION.y,
      CAMERA_CONFIG.INITIAL_QUATERNION.z,
      CAMERA_CONFIG.INITIAL_QUATERNION.w
    );
    this.camera.rotation.z = 0;

    this.scene = new THREE.Scene();

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.toneMapping = RENDERER_CONFIG.TONE_MAPPING;
    this.renderer.toneMappingExposure = RENDERER_CONFIG.TONE_MAPPING_EXPOSURE;
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

      // Set fixed height to floor level + person height
      this.fixedHeight = this.sceneBounds.min.y + MOVEMENT_CONFIG.PERSON_HEIGHT;

      // Update camera position to the calculated person height
      this.camera.position.y = this.fixedHeight;

      // Ensure camera is upright (no roll) after positioning
      this.camera.rotation.z = 0;

      this.monitors = [];
      this.highlightTargets = [];
      this.clipboardMeshGroup = [];
      this.clipboardPageMesh = undefined;
      this.clipboardInteractiveMesh = undefined;
      this.clipboardPageUp = undefined;

      const highlightObjectNames = new Set(['Button']);
      const foundHighlightNames = new Set<string>();

      this.scene.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const mat = child.material as THREE.Material | THREE.Material[];

          // Handle both single and multi-material meshes
          const isMonitorMaterial = Array.isArray(mat)
            ? mat.some((m) => (m as MaterialWithUserData).userData?.isMonitor)
            : (mat as MaterialWithUserData).userData?.isMonitor;

          // Check both mesh and material userData
          if (child.userData?.['isMonitor'] || isMonitorMaterial) {
            this.monitors.push(child);
            if (!this.highlightTargets.includes(child)) {
              this.highlightTargets.push(child);
            }
            // Make monitors clickable by storing original material references
            if (!child.userData['originalMaterial']) {
              child.userData['originalMaterial'] = child.material;
            }
          }

          if (highlightObjectNames.has(child.name)) {
            if (!this.highlightTargets.includes(child)) {
              this.highlightTargets.push(child);
            }
            foundHighlightNames.add(child.name);
          }

          if (child.name === 'page_page_0') {
            this.clipboardPageMesh = child;
            child.updateMatrixWorld(true);
            this.clipboardPageUp = this.computeMeshTextureUp(child) ?? undefined;

            const meshAncestors: THREE.Mesh[] = [];
            let ancestor: THREE.Object3D | null = child.parent ?? null;
            while (ancestor) {
              if (ancestor instanceof THREE.Mesh) {
                meshAncestors.push(ancestor);
              }
              ancestor = ancestor.parent ?? null;
            }

            const namePattern = /(clip|board)/i;
            const namedAncestor = meshAncestors.find((mesh) => namePattern.test(mesh.name));
            const outermostMesh = meshAncestors.length > 0 ? meshAncestors[meshAncestors.length - 1] : undefined;
            const interactive = namedAncestor ?? outermostMesh;

            this.clipboardInteractiveMesh = interactive ?? child;

            child.userData = {
              ...child.userData,
              isClipboard: true
            };
            this.clipboardInteractiveMesh.userData = {
              ...this.clipboardInteractiveMesh.userData,
              isClipboard: true
            };

            const interactionTargets = new Set<THREE.Mesh>();
            interactionTargets.add(child);
            if (this.clipboardInteractiveMesh) {
              interactionTargets.add(this.clipboardInteractiveMesh);
            }
            this.clipboardMeshGroup = Array.from(interactionTargets);

            if (!this.highlightTargets.includes(child)) {
              this.highlightTargets.push(child);
            }
          }
        }
      });

      highlightObjectNames.forEach((name) => {
        if (!foundHighlightNames.has(name)) {
          console.warn(`Highlight target not found: ${name}`);
        }
      });

      // Apply different content to monitors
      const monitorConfigs: MonitorConfig[] = [
        { index: 0, type: 'video', path: 'assets/videos/Pingpong.mp4', lightColor: { r: 0.7, g: 0.85, b: 1.0 } },
        { index: 1, type: 'video', path: 'assets/videos/NeoVSMerovingian.mp4', lightColor: { r: 1.0, g: 0.95, b: 0.8 } },
        { index: 2, type: 'image', path: 'assets/images/QRCode.png', lightColor: { r: 0.8, g: 0.9, b: 1.0 } },
        { index: 3, type: 'video', path: 'assets/videos/RonaldinhoMagic.mp4', lightColor: { r: 0.75, g: 1.0, b: 0.85 } },
        { index: 4, type: 'video', path: 'assets/videos/ColoredStatic.mp4', lightColor: { r: 1.0, g: 0.8, b: 0.9 } },
        { index: 5, type: 'image', path: 'assets/images/DontPress.png', lightColor: { r: 1.0, g: 0.8, b: 0.8 } },
        { index: 6, type: 'music', path: '', lightColor: { r: 0.8, g: 0.9, b: 1.0 } },
        { index: 7, type: 'video', path: 'assets/videos/Static.mp4', lightColor: { r: 0.8, g: 0.9, b: 1.0 } },
        { index: 8, type: 'video', path: 'assets/videos/Teamwork.mp4', lightColor: { r: 0.8, g: 0.9, b: 1.0 } }
      ];

      this.setupMonitors(monitorConfigs);

      if (this.clipboardPageMesh) {
        this.applyTextTexture(this.clipboardPageMesh, this.clipboardTextContent, {
          fontSize: 120,
          fontColor: '#2f2b1d',
          bgColor: '#f5f0e1',
          fontFamily: 'Segoe UI',
          fontWeight: '600',
          padding: 240,
          emissiveIntensity: 0 // No light emission - just regular material like paper
        });
      }

      // Setup mouse interaction for monitors
      this.setupMonitorInteraction();

      this.render();
      });

    this.flyControls = new FlyControls(this.camera, this.renderer.domElement);
    this.flyControls.movementSpeed = 5;
    this.flyControls.rollSpeed = MOVEMENT_CONFIG.MAX_ROLL_ANGLE;
    this.flyControls.dragToLook = true;
    this.flyControls.autoForward = false;

    window.addEventListener('resize', this.onResize);

    this.startAnimationLoop();
  }

  /**
   * Setup monitors with their content and lighting
   */
  private setupMonitors(configs: MonitorConfig[]): void {
    for (const config of configs) {
      const monitor = this.monitors[config.index];
      if (!monitor) continue;

      if (config.type === 'music') {
        this.musicPlayerMonitor = monitor;
        this.initializeMusicPlayer();
      } else if (config.type === 'video') {
        this.applyVideoTexture(monitor, config.path);
      } else if (config.type === 'image') {
        this.applyImageTexture(monitor, config.path).catch(console.error);
      }

      this.addMonitorLight(monitor, config.lightColor.r, config.lightColor.g, config.lightColor.b);
    }
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
    if (this.isTransitioning || this.focusedMonitor || this.focusedClipboard) return; // Don't interact during transitions or when focused

    const container = this.renderer.domElement;
    const rect = container.getBoundingClientRect();

    // Calculate mouse position in normalized device coordinates
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    // Update raycaster
    this.raycaster.setFromCamera(this.mouse, this.camera);

    // Check for intersections with highlight targets (monitors, clipboard, and named objects)
    const intersects = this.raycaster.intersectObjects(this.highlightTargets, true);

    if (intersects.length > 0) {
      const intersectedObject = intersects[0].object as THREE.Mesh;
      const highlightTarget = this.resolveHighlightTarget(intersectedObject);

      if (highlightTarget && this.hoveredObject !== highlightTarget) {
        // Remove highlight from previous object
        if (this.hoveredObject) {
          this.removeMonitorHighlight(this.hoveredObject);
        }

        // Add highlight to new object
        this.hoveredObject = highlightTarget;
        this.addMonitorHighlight(highlightTarget);
        container.style.cursor = 'pointer';
      }
    } else {
      // Remove highlight if not hovering over any object
      if (this.hoveredObject) {
        this.removeMonitorHighlight(this.hoveredObject);
        this.hoveredObject = null;
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

    // Check for intersections with interactive targets (monitors + clipboard)
    const interactiveTargets: THREE.Object3D[] = [...this.monitors];
    if (this.clipboardMeshGroup.length > 0) {
      interactiveTargets.push(...this.clipboardMeshGroup);
    } else if (this.clipboardInteractiveMesh) {
      interactiveTargets.push(this.clipboardInteractiveMesh);
    }
    const intersects = this.raycaster.intersectObjects(interactiveTargets, true);

    // If clicking outside interactive objects, exit focus states when applicable
    if (intersects.length === 0) {
      if (this.focusedMonitor === this.musicPlayerMonitor || this.focusedClipboard) {
        this.returnToPreviousPosition();
      }
      return;
    }

    const intersection = intersects[0];
    const clickedObject = intersection.object as THREE.Mesh;

    const monitor = this.findAncestorMesh(clickedObject, this.monitors);
    if (monitor) {
      // Check if this is the music player monitor and we're focused on it
      if (monitor === this.musicPlayerMonitor && this.focusedMonitor === this.musicPlayerMonitor) {
        // Get UV coordinates from intersection (try uv first, then uv2)
        const intersectionWithUV = intersection as IntersectionWithUV;
        const uvCoords = intersectionWithUV.uv || intersectionWithUV.uv2;
        if (uvCoords) {
          this.handleMusicPlayerClick({ x: uvCoords.x, y: uvCoords.y });
        }
        return; // Don't move camera when clicking buttons
      }

      if (this.focusedMonitor === monitor) {
        // Clicking the same monitor again - return to previous position
        this.returnToPreviousPosition();
        return;
      }

      // Clicking a new monitor - move camera to it
      this.moveCameraToMonitor(monitor);
      return;
    }

    const clipboardCandidates: THREE.Mesh[] =
      this.clipboardMeshGroup.length > 0
        ? this.clipboardMeshGroup
        : this.clipboardInteractiveMesh
          ? [this.clipboardInteractiveMesh]
          : [];

    const clipboard = clipboardCandidates.length > 0
      ? this.findAncestorMesh(clickedObject, clipboardCandidates)
      : undefined;

    if (clipboard) {
      const targetClipboard = this.clipboardInteractiveMesh ?? clipboard;

      if (this.focusedClipboard === targetClipboard) {
        this.returnToPreviousPosition();
        return;
      }

      this.moveCameraToClipboard(targetClipboard);
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
   * Clear any active hover highlight and reset cursor state
   */
  private clearHoveredHighlight(): void {
    if (this.hoveredObject) {
      this.removeMonitorHighlight(this.hoveredObject);
      this.hoveredObject = null;
      if (this.renderer?.domElement) {
        this.renderer.domElement.style.cursor = 'default';
      }
    }
  }

  /**
   * Compute the "up" direction for a textured plane based on its UV mapping
   */
  private computeMeshTextureUp(mesh: THREE.Mesh): THREE.Vector3 | null {
    const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
    if (!geometry) return null;

    const uvAttribute = geometry.attributes['uv'] as THREE.BufferAttribute | undefined;
    const positionAttribute = geometry.attributes['position'] as THREE.BufferAttribute | undefined;
    if (!uvAttribute || !positionAttribute) return null;

    const epsilon = 1e-4;
    let maxV = -Infinity;
    let minV = Infinity;
    const topVertices: THREE.Vector3[] = [];
    const bottomVertices: THREE.Vector3[] = [];

    for (let i = 0; i < uvAttribute.count; i++) {
      const v = uvAttribute.getY(i);
      if (v > maxV - epsilon) {
        if (v > maxV + epsilon) {
          topVertices.length = 0;
          maxV = v;
        }
        topVertices.push(
          new THREE.Vector3(
            positionAttribute.getX(i),
            positionAttribute.getY(i),
            positionAttribute.getZ(i)
          )
        );
      }

      if (v < minV + epsilon) {
        if (v < minV - epsilon) {
          bottomVertices.length = 0;
          minV = v;
        }
        bottomVertices.push(
          new THREE.Vector3(
            positionAttribute.getX(i),
            positionAttribute.getY(i),
            positionAttribute.getZ(i)
          )
        );
      }
    }

    if (topVertices.length === 0 || bottomVertices.length === 0) {
      return null;
    }

    const topCenter = topVertices.reduce((acc, v) => acc.add(v), new THREE.Vector3()).divideScalar(topVertices.length);
    const bottomCenter = bottomVertices.reduce((acc, v) => acc.add(v), new THREE.Vector3()).divideScalar(bottomVertices.length);

    const topWorld = topCenter.clone().applyMatrix4(mesh.matrixWorld);
    const bottomWorld = bottomCenter.clone().applyMatrix4(mesh.matrixWorld);
    const direction = topWorld.sub(bottomWorld);

    if (direction.lengthSq() < 1e-6) {
      return null;
    }

    return direction.normalize();
  }

  /**
   * Walk up hierarchy to find a mesh contained in provided candidates
   */
  private findAncestorMesh(object: THREE.Object3D, candidates: THREE.Mesh[]): THREE.Mesh | undefined {
    let current: THREE.Object3D | null = object;
    while (current) {
      if (current instanceof THREE.Mesh && candidates.includes(current)) {
        return current as THREE.Mesh;
      }
      current = current.parent ?? null;
    }
    return undefined;
  }

  /**
   * Resolve which mesh should be highlighted for a given intersection
   */
  private resolveHighlightTarget(mesh: THREE.Mesh): THREE.Mesh | null {
    const monitor = this.findAncestorMesh(mesh, this.monitors);
    if (monitor) {
      return monitor;
    }

    if (this.clipboardPageMesh) {
      const candidates =
        this.clipboardMeshGroup.length > 0
          ? this.clipboardMeshGroup
          : [this.clipboardPageMesh];
      const clipboard = this.findAncestorMesh(mesh, candidates);
      if (clipboard) {
        return this.clipboardPageMesh;
      }
    }

    return mesh;
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
    const maxDimension = Math.max(size.x, size.y, size.z);
    const distance = maxDimension * CAMERA_POSITION_CONFIG.MONITOR_DISTANCE_MULTIPLIER;

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

    this.focusedClipboard = null;
    this.focusedMonitor = monitor;
    this.isTransitioning = true;
    this.clearHoveredHighlight();

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
   * Move camera above clipboard and orient downward
   */
  private moveCameraToClipboard(clipboard: THREE.Mesh): void {
    if (this.isTransitioning) return;

    this.previousCameraState = {
      position: this.camera.position.clone(),
      quaternion: this.camera.quaternion.clone()
    };

    clipboard.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(clipboard);
    const size = box.getSize(new THREE.Vector3());
    const clipboardCenter = box.getCenter(new THREE.Vector3());

    const clipboardWorldMatrix = new THREE.Matrix4().copy(clipboard.matrixWorld);

    const worldAxes = [0, 1, 2].map((index) => {
      const axis = new THREE.Vector3().setFromMatrixColumn(clipboardWorldMatrix, index);
      return axis.normalize();
    });

    const globalUp = new THREE.Vector3(0, 1, 0);

    let surfaceNormal = worldAxes[0].clone();
    let surfaceDot = -Infinity;

    for (const axis of worldAxes) {
      const dot = Math.abs(axis.dot(globalUp));
      if (dot > surfaceDot) {
        surfaceDot = dot;
        surfaceNormal.copy(axis);
      }
    }

    if (surfaceNormal.dot(globalUp) < 0) {
      surfaceNormal.multiplyScalar(-1);
    }

    let pageUpAxis: THREE.Vector3 | null = null;
    const pageMesh = this.clipboardPageMesh ?? clipboard;
    pageMesh.updateMatrixWorld(true);
    pageUpAxis = this.computeMeshTextureUp(pageMesh);
    if (!pageUpAxis && this.clipboardPageUp) {
      pageUpAxis = this.clipboardPageUp.clone();
    }

    if (!pageUpAxis) {
      const remainingAxes = worldAxes.filter(
        (axis) => Math.abs(axis.dot(surfaceNormal)) < 0.95
      );
      pageUpAxis = remainingAxes[0]?.clone() ?? new THREE.Vector3(0, 0, 1);
    }
    pageUpAxis.normalize();

    let pageRight = new THREE.Vector3().crossVectors(pageUpAxis, surfaceNormal);
    if (pageRight.lengthSq() < 1e-4) {
      pageRight = new THREE.Vector3().crossVectors(surfaceNormal, pageUpAxis);
    }
    if (pageRight.lengthSq() < 1e-4) {
      pageRight = new THREE.Vector3(1, 0, 0);
    } else {
      pageRight.normalize();
    }

    const lateralOffset = Math.max(size.x, size.z) * CAMERA_POSITION_CONFIG.CLIPBOARD_LATERAL_OFFSET_MULTIPLIER;
    const verticalOffset = Math.max(size.x, size.y, size.z) * CAMERA_POSITION_CONFIG.CLIPBOARD_VERTICAL_OFFSET_MULTIPLIER;

    let targetPosition = clipboardCenter
      .clone()
      .add(surfaceNormal.clone().multiplyScalar(verticalOffset))
      .add(pageUpAxis.clone().multiplyScalar(-lateralOffset));

    let up = pageUpAxis.clone();
    let matrix = new THREE.Matrix4().lookAt(targetPosition, clipboardCenter, up);
    let targetQuaternion = new THREE.Quaternion().setFromRotationMatrix(matrix);

    // Detect if page appears upside down; if so, rotate camera around forward axis
    const cameraForward = clipboardCenter.clone().sub(targetPosition).normalize();
    const pageUpInCamera = pageUpAxis.clone().applyQuaternion(targetQuaternion.clone().invert());

    if (pageUpInCamera.y < 0) {
      const rollAdjustment = new THREE.Quaternion().setFromAxisAngle(cameraForward, Math.PI);
      targetQuaternion.premultiply(rollAdjustment);
      matrix = new THREE.Matrix4().makeRotationFromQuaternion(targetQuaternion);
      const adjustedUp = new THREE.Vector3(0, 1, 0).applyQuaternion(targetQuaternion);
      up.copy(adjustedUp);
    }

    this.focusedMonitor = null;
    this.focusedClipboard = clipboard;
    this.isTransitioning = true;
    this.clearHoveredHighlight();

    this.animateCameraToPosition(targetPosition, targetQuaternion, () => {
      this.isTransitioning = false;
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
        this.focusedClipboard = null;
        this.previousCameraState = undefined;

        // Re-enable fly controls
        if (this.flyControls) {
          this.flyControls.enabled = true;
        }

        // Remove any remaining highlights
        if (this.hoveredObject) {
          this.removeMonitorHighlight(this.hoveredObject);
          this.hoveredObject = null;
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
    const startTime = Date.now();

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / TRANSITION_CONFIG.DURATION, 1);
      const easeProgress = TRANSITION_CONFIG.EASING(progress);

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
      if (this.flyControls && !this.isTransitioning && !this.focusedMonitor && !this.focusedClipboard) {
        this.flyControls.update(delta);
        // Lock camera height to fixed person height
        this.camera.position.y = this.fixedHeight;
        // Limit roll rotation to a small range (±15 degrees)
        this.camera.rotation.z = Math.max(
          -MOVEMENT_CONFIG.MAX_ROLL_ANGLE,
          Math.min(MOVEMENT_CONFIG.MAX_ROLL_ANGLE, this.camera.rotation.z)
        );
        // Clamp camera position to scene bounds
        this.constrainCameraToBounds();
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

    const padding = MOVEMENT_CONFIG.BOUNDS_PADDING;
    const { x, y, z } = this.camera.position;

    // Clamp positions
    this.camera.position.x = Math.max(
      this.sceneBounds.min.x + padding,
      Math.min(this.sceneBounds.max.x - padding, x)
    );
    this.camera.position.y = Math.max(
      this.sceneBounds.min.y + padding,
      Math.min(this.sceneBounds.max.y - padding, this.fixedHeight)
    );
    this.camera.position.z = Math.max(
      this.sceneBounds.min.z + padding,
      Math.min(this.sceneBounds.max.z - padding, z)
    );
  }

  /**
   * Configures texture settings for consistent behavior
   */
  private configureTextureSettings(texture: THREE.Texture, generateMipmaps: boolean = true): void {
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = generateMipmaps;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.repeat.set(1, 1);
    texture.offset.set(0, 0);
  }

  /**
   * Applies a video texture to a monitor mesh with emissive lighting
   */
  private applyVideoTexture(monitor: THREE.Mesh, videoPath: string): void {
    const video = document.createElement('video');
    video.src = videoPath;
    video.crossOrigin = 'anonymous';
    video.loop = true;
    video.muted = true;
    video.play().catch((err) => {
      console.warn('Video autoplay failed:', err);
    });

    this.videoElements.push(video);

    const texture = new THREE.VideoTexture(video);
    this.configureTextureSettings(texture, false); // Video textures don't need mipmaps

    this.applyTexture(monitor, texture, TEXTURE_CONFIG.VIDEO_EMISSIVE_INTENSITY, true);
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
          this.configureTextureSettings(texture);
          this.applyTexture(monitor, texture, TEXTURE_CONFIG.DEFAULT_EMISSIVE_INTENSITY);
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
   * Applies a text texture to a mesh with emissive lighting
   */
  private applyTextTexture(
    mesh: THREE.Mesh,
    text: string,
    options: {
      fontSize?: number;
      fontColor?: string;
      bgColor?: string;
      fontFamily?: string;
      padding?: number;
      fontWeight?: string;
      emissiveIntensity?: number;
    } = {}
  ): void {
    const {
      fontSize = 64,
      fontColor = '#ffffff',
      bgColor = '#000000',
      fontFamily = 'Arial',
      padding = 20,
      fontWeight = 'normal',
      emissiveIntensity = 1.8
    } = options;

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) {
      console.error('Failed to get canvas context');
      return;
    }

    canvas.width = TEXTURE_CONFIG.CANVAS_SIZE;
    canvas.height = TEXTURE_CONFIG.CANVAS_SIZE;

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
    this.configureTextureSettings(texture);
    this.applyTexture(mesh, texture, emissiveIntensity);
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
   * Creates or clones a material with emissive properties
   */
  private createEmissiveMaterial(
    originalMaterial: THREE.Material,
    texture: THREE.Texture,
    emissiveIntensity: number,
    isVideo: boolean
  ): THREE.MeshStandardMaterial {
    let material: THREE.MeshStandardMaterial;

    if (originalMaterial instanceof THREE.MeshStandardMaterial || originalMaterial instanceof THREE.MeshPhysicalMaterial) {
      material = originalMaterial.clone() as THREE.MeshStandardMaterial;
    } else {
      material = new THREE.MeshStandardMaterial();
    }

    this.configureEmissiveMaterial(material, texture, emissiveIntensity, isVideo);
    return material;
  }

  /**
   * Applies a texture to a mesh with emissive material
   * IMPORTANT: Clones materials to ensure each mesh has its own unique material instance
   */
  private applyTexture(
    mesh: THREE.Mesh,
    texture: THREE.Texture,
    emissiveIntensity: number = TEXTURE_CONFIG.DEFAULT_EMISSIVE_INTENSITY,
    isVideo: boolean = false
  ): void {
    const originalMaterial = mesh.material as THREE.Material | THREE.Material[];

    if (Array.isArray(originalMaterial)) {
      mesh.material = originalMaterial.map((mat) =>
        this.createEmissiveMaterial(mat, texture, emissiveIntensity, isVideo)
      );
    } else {
      mesh.material = this.createEmissiveMaterial(originalMaterial, texture, emissiveIntensity, isVideo);
    }

    // Update UV mapping if needed
    if (mesh.geometry) {
      mesh.geometry.computeBoundingBox();
      this.normalizeMonitorUVs(mesh);
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
    const lightPosition = monitorCenter.clone().add(
      worldZ.clone().multiplyScalar(MONITOR_LIGHT_CONFIG.OFFSET_BACK)
    );

    // Calculate target position (light shines away from monitor in the direction it faces)
    const targetPosition = monitorCenter.clone().add(
      worldZ.clone().multiplyScalar(MONITOR_LIGHT_CONFIG.TARGET_DISTANCE)
    );

    // Create spot light with the specified color
    const light = new THREE.SpotLight(
      new THREE.Color(r, g, b),
      intensity,
      distance,
      MONITOR_LIGHT_CONFIG.CONE_ANGLE,
      MONITOR_LIGHT_CONFIG.PENUMBRA,
      MONITOR_LIGHT_CONFIG.DECAY
    );
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
    // Create audio element
    this.audioElement = new Audio();
    this.audioElement.addEventListener('ended', () => {
      this.nextSong();
    });

    // Create canvas for music player UI
    this.musicPlayerCanvas = document.createElement('canvas');
    this.musicPlayerCanvas.width = TEXTURE_CONFIG.CANVAS_SIZE;
    this.musicPlayerCanvas.height = TEXTURE_CONFIG.CANVAS_SIZE;

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
      this.applyTexture(this.musicPlayerMonitor, this.musicPlayerTexture, TEXTURE_CONFIG.TEXT_EMISSIVE_INTENSITY);
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
    if (this.animateHandle) cancelAnimationFrame(this.animateHandle);
  }
}
