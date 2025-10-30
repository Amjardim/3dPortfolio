import { Component, OnInit, PLATFORM_ID, inject } from '@angular/core';
import { DOCUMENT, isPlatformBrowser } from '@angular/common';

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

@Component({
  selector: 'app-canvas',
  standalone: true,
  imports: [],
  templateUrl: './canvas.component.html',
  styleUrls: ['./canvas.component.scss']
})
export class CanvasComponent implements OnInit {
  public scene!: THREE.Scene;
  public camera!: THREE.PerspectiveCamera;
  public renderer!: THREE.WebGLRenderer;
  private readonly platformId = inject(PLATFORM_ID);
  private readonly document = inject(DOCUMENT);

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.init();
    }
  }

  private init(): void {
    const container = this.document.createElement('div');
    this.document.body.appendChild(container);

    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.25, 20);
    this.camera.position.set(-1.8, 0.6, 2.7);

    this.scene = new THREE.Scene();

    const loader = new GLTFLoader().setPath('assets/');
    loader.load('old_computers.glb', async (glb) => {
      const model = glb.scene;
      await this.renderer.compileAsync(model, this.camera, this.scene);
      this.scene.add(model);
      this.render();
      });

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    container.appendChild(this.renderer.domElement);

    const controls = new OrbitControls(this.camera, this.renderer.domElement);
    controls.addEventListener('change', () => this.render());
    controls.minDistance = 2;
    controls.maxDistance = 10;
    controls.target.set(0, 0, -0.2);
    controls.update();

    window.addEventListener('resize', () => this.onWindowResize());
  }

  private onWindowResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.render();
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
