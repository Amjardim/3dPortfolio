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
    this.camera.quaternion.set(-0.110, 0.047, 0.005, 0.993);


    this.scene = new THREE.Scene();

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(5, 10, 7.5);
    this.scene.add(directionalLight);

    const loader = new GLTFLoader().setPath('assets/models/');
    loader.load('old_computers_cardboardbox3.glb', async (glb) => {
      const model = glb.scene;
      await this.renderer.compileAsync(model, this.camera, this.scene);
      this.scene.add(model);

      const monitors: THREE.Mesh[] = [];

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
            monitors.push(child);
          }
        }
      });

      console.log('Detected monitor meshes:', monitors);

      // monitors.forEach((monitor) => {
      //   this.applyVideoTexture(monitor, 'assets/videos/screen-demo.mp4');
      //   // or this.applyImageTexture(...)
      //   // or this.applyTextTexture(...)
      // });

      this.render();
      });

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    container.appendChild(this.renderer.domElement);

    this.flyControls = new FlyControls(this.camera, this.renderer.domElement);
    this.flyControls.movementSpeed = 5;
    this.flyControls.rollSpeed = Math.PI / 6; // adjust turn rate
    this.flyControls.dragToLook = true; // hold mouse to look
    this.flyControls.autoForward = false;

    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKeyDown, false);
    window.addEventListener('keyup', this.onKeyUp, false);

    this.startAnimationLoop();
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
      if (this.flyControls) this.flyControls.update(delta);
      this.updateCameraFromKeys(delta);
      this.render();
      this.animateHandle = requestAnimationFrame(loop);
    };
    this.animateHandle = requestAnimationFrame(loop);
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
    if (event.code === 'KeyC' && this.camera) {
      // Quick dump to console for copy/paste
      const p = this.camera.position;
      const r = this.camera.rotation;
      console.log('Camera position:', { x: p.x, y: p.y, z: p.z });
      console.log('Camera rotation (radians):', { x: r.x, y: r.y, z: r.z });
    }
  };

  ngOnDestroy(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKeyDown, false);
    window.removeEventListener('keyup', this.onKeyUp, false);
    if (this.animateHandle) cancelAnimationFrame(this.animateHandle);
  }
}
