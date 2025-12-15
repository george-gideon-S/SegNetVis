/**
 * Ring-Style Magnification Lens with Local Mode Controls
 *
 * Features:
 * - Large circular "ring" overlay with translucent interior
 * - When lens is active, ONLY the interior shows the selected layer
 * - Base map OUTSIDE the ring stays in Original mode
 * - Mode controls are attached to the ring itself
 * - Global mode buttons are disabled when lens is active
 * - Follows cursor smoothly, can be pinned in place
 */

class MagnificationLens {
  constructor(options = {}) {
    // Configuration
    this.containerId = options.containerId || 'seg-map-panel';
    this.segOverlay = options.segOverlay || null;
    this.map = options.map || null;
    this.stateManager = options.stateManager || null;

    // Lens state
    this.enabled = false;
    this.pinned = false;
    this.position = { x: 0, y: 0 }; // Screen position of cursor
    this.geoPosition = null; // Lat/lng of lens center

    // Ring configuration
    this.ringRadius = 120; // Radius of the lens ring in pixels
    this.ringThickness = 6; // Thickness of the ring border

    // Resizable lens configuration
    this.minRadius = 60;   // Minimum radius in pixels
    this.maxRadius = 200;  // Maximum radius in pixels
    this.radiusStep = 20;  // Step size for +/- buttons

    // Current local mode (inside the ring)
    this.localMode = 'prediction'; // Default mode inside ring

    // Available modes
    this.modes = ['prediction', 'groundTruth', 'error', 'confidence'];
    this.modeLabels = {
      prediction: 'Pred',
      groundTruth: 'GT',
      error: 'Err',
      confidence: 'Conf'
    };
    this.modeColors = {
      prediction: '#4caf50',
      groundTruth: '#ff9800',
      error: '#ef4444',
      confidence: '#8b5cf6'
    };

    // DOM elements
    this.container = null;
    this.lensElement = null;
    this.ringCanvas = null;
    this.controlsContainer = null;
    this.dragging = false;
    this.dragOffset = { x: 0, y: 0 };

    // Store original mode to restore when lens is disabled
    this.originalGlobalMode = null;

    // Callback for state changes
    this.onStateChange = options.onStateChange || null;

    // Throttle updates for performance
    this.lastUpdateTime = 0;
    this.updateInterval = 16; // ~60fps

    this.init();
  }

  init() {
    console.log('🔍 Initializing Ring Magnification Lens...');

    this.container = document.getElementById(this.containerId);
    if (!this.container) {
      console.error('Container not found:', this.containerId);
      return;
    }

    this.createLensUI();
    this.setupEventHandlers();

    console.log('✅ Ring Magnification Lens initialized');
  }

  setSegmentationOverlay(overlay) {
    this.segOverlay = overlay;
    this.map = overlay?.map;
  }

  createLensUI() {
    // Create the main lens container (ring overlay)
    this.lensElement = document.createElement('div');
    this.lensElement.className = 'ring-lens hidden';
    this.lensElement.innerHTML = `
      <canvas class="ring-lens-canvas"></canvas>
      <div class="ring-lens-controls">
        <div class="ring-mode-buttons"></div>
      </div>
      <div class="ring-lens-close" title="Close (L)">×</div>
      <div class="ring-lens-coords"></div>
      <div class="ring-lens-resize">
        <button class="ring-resize-btn ring-resize-minus" title="Decrease size (-)">−</button>
        <button class="ring-resize-btn ring-resize-plus" title="Increase size (+)">+</button>
      </div>
    `;

    // Get references
    this.ringCanvas = this.lensElement.querySelector('.ring-lens-canvas');
    this.controlsContainer = this.lensElement.querySelector('.ring-mode-buttons');
    this.coordsDisplay = this.lensElement.querySelector('.ring-lens-coords');

    // Set canvas size
    const canvasSize = this.ringRadius * 2 + this.ringThickness * 2;
    this.ringCanvas.width = canvasSize * 2; // Higher resolution
    this.ringCanvas.height = canvasSize * 2;
    this.ringCanvas.style.width = canvasSize + 'px';
    this.ringCanvas.style.height = canvasSize + 'px';

    // Create mode buttons around the ring
    this.modes.forEach((mode, index) => {
      const btn = document.createElement('button');
      btn.className = 'ring-mode-btn';
      btn.dataset.mode = mode;
      btn.textContent = this.modeLabels[mode];
      btn.style.setProperty('--mode-color', this.modeColors[mode]);

      if (mode === this.localMode) {
        btn.classList.add('active');
      }

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setLocalMode(mode);
      });

      this.controlsContainer.appendChild(btn);
    });

    // Close button handler
    const closeBtn = this.lensElement.querySelector('.ring-lens-close');
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.disable();
    });

    // Resize button handlers
    const minusBtn = this.lensElement.querySelector('.ring-resize-minus');
    const plusBtn = this.lensElement.querySelector('.ring-resize-plus');

    minusBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.decreaseSize();
    });

    plusBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.increaseSize();
    });

    this.container.appendChild(this.lensElement);
  }

  /**
   * Increase lens radius
   */
  increaseSize() {
    const newRadius = Math.min(this.maxRadius, this.ringRadius + this.radiusStep);
    if (newRadius !== this.ringRadius) {
      this.ringRadius = newRadius;
      this.updateCanvasSize();
      this.updateLens();
      console.log(`🔍 Lens size increased to ${this.ringRadius}px radius`);
    }
  }

  /**
   * Decrease lens radius
   */
  decreaseSize() {
    const newRadius = Math.max(this.minRadius, this.ringRadius - this.radiusStep);
    if (newRadius !== this.ringRadius) {
      this.ringRadius = newRadius;
      this.updateCanvasSize();
      this.updateLens();
      console.log(`🔍 Lens size decreased to ${this.ringRadius}px radius`);
    }
  }

  /**
   * Update canvas size when radius changes
   */
  updateCanvasSize() {
    const canvasSize = this.ringRadius * 2 + this.ringThickness * 2;
    this.ringCanvas.width = canvasSize * 2; // Higher resolution
    this.ringCanvas.height = canvasSize * 2;
    this.ringCanvas.style.width = canvasSize + 'px';
    this.ringCanvas.style.height = canvasSize + 'px';
  }

  setupEventHandlers() {
    // Mouse move - update lens position
    this.container.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      if (this.pinned && !this.dragging) return;

      const rect = this.container.getBoundingClientRect();
      if (this.dragging) {
        // Dragging the lens
        this.position = {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top
        };
        this.updateLensPosition();
        this.throttledUpdate();
      } else {
        // Following cursor
        this.position = {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top
        };
        this.throttledUpdate();
      }
    });

    // Lens dragging
    this.lensElement.addEventListener('mousedown', (e) => {
      if (e.target.closest('.ring-lens-close') || e.target.closest('.ring-mode-btn')) {
        return;
      }
      this.dragging = true;
      this.pinned = true;
      this.lensElement.classList.add('pinned');
      e.preventDefault();
    });

    document.addEventListener('mouseup', () => {
      this.dragging = false;
    });

    this.container.addEventListener('mouseenter', () => {
      if (this.enabled && !this.pinned) {
        this.show();
      }
    });

    this.container.addEventListener('mouseleave', () => {
      if (this.enabled && !this.pinned) {
        this.hide();
      }
    });

    // Click to pin/unpin
    this.container.addEventListener('click', (e) => {
      if (!this.enabled) return;
      if (e.target.closest('.ring-lens')) return;
      if (e.target.closest('.mapboxgl-ctrl')) return;

      this.togglePin();
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      switch (e.key.toLowerCase()) {
        case 'l':
          this.toggle();
          e.preventDefault();
          break;
        case 'escape':
          if (this.enabled) {
            if (this.pinned) {
              this.unpin();
            } else {
              this.disable();
            }
            e.preventDefault();
          }
          break;
        case '1':
        case '2':
        case '3':
        case '4':
          if (this.enabled) {
            const modeIndex = parseInt(e.key) - 1;
            if (this.modes[modeIndex]) {
              this.setLocalMode(this.modes[modeIndex]);
            }
            e.preventDefault();
          }
          break;
        case '+':
        case '=':
          if (this.enabled) {
            this.increaseSize();
            e.preventDefault();
          }
          break;
        case '-':
        case '_':
          if (this.enabled) {
            this.decreaseSize();
            e.preventDefault();
          }
          break;
      }
    });
  }

  throttledUpdate() {
    const now = performance.now();
    if (now - this.lastUpdateTime < this.updateInterval) {
      if (!this._updateScheduled) {
        this._updateScheduled = true;
        requestAnimationFrame(() => {
          this._updateScheduled = false;
          this.updateLens();
        });
      }
      return;
    }
    this.lastUpdateTime = now;
    this.updateLens();
  }

  enable() {
    this.enabled = true;

    // Store current global mode and switch base map to original
    this.storeAndSwitchToOriginal();

    // Disable global mode buttons
    this.setGlobalModeButtonsEnabled(false);

    this.show();
    this.notifyStateChange();
    console.log('🔍 Ring lens enabled - base map switched to Original');
  }

  disable() {
    this.enabled = false;
    this.pinned = false;

    // Restore original global mode
    this.restoreGlobalMode();

    // Re-enable global mode buttons
    this.setGlobalModeButtonsEnabled(true);

    this.hide();
    this.lensElement.classList.remove('pinned');
    this.notifyStateChange();
    console.log('🔍 Ring lens disabled - global mode restored');
  }

  storeAndSwitchToOriginal() {
    // Store current global mode
    if (this.segOverlay) {
      this.originalGlobalMode = this.segOverlay.getDisplayMode();
    }

    // Switch overlay to original mode (no overlays)
    if (this.segOverlay) {
      this.segOverlay.setDisplayMode('original');
    }

    // Update UI to reflect original mode
    const modeButtons = document.querySelectorAll('.seg-mode-btn');
    modeButtons.forEach(btn => {
      btn.classList.remove('active');
      if (btn.dataset.mode === 'original') {
        btn.classList.add('active');
      }
    });
  }

  restoreGlobalMode() {
    // Restore previous global mode
    if (this.segOverlay && this.originalGlobalMode) {
      this.segOverlay.setDisplayMode(this.originalGlobalMode);

      // Update UI
      const modeButtons = document.querySelectorAll('.seg-mode-btn');
      modeButtons.forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.mode === this.originalGlobalMode) {
          btn.classList.add('active');
        }
      });
    }
    this.originalGlobalMode = null;
  }

  setGlobalModeButtonsEnabled(enabled) {
    const modeButtons = document.querySelectorAll('.seg-mode-btn');
    modeButtons.forEach(btn => {
      btn.disabled = !enabled;
      if (enabled) {
        btn.classList.remove('disabled');
      } else {
        btn.classList.add('disabled');
      }
    });
  }

  setLocalMode(mode) {
    this.localMode = mode;

    // Update button states
    const buttons = this.controlsContainer.querySelectorAll('.ring-mode-btn');
    buttons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });

    // Update ring color
    this.updateLens();
  }

  notifyStateChange() {
    if (this.onStateChange) {
      this.onStateChange({ enabled: this.enabled, pinned: this.pinned, localMode: this.localMode });
    }
  }

  toggle() {
    if (this.enabled) {
      this.disable();
    } else {
      this.enable();
    }
  }

  show() {
    this.lensElement.classList.remove('hidden');
    this.updateLens();
  }

  hide() {
    if (!this.pinned) {
      this.lensElement.classList.add('hidden');
    }
  }

  togglePin() {
    if (this.pinned) {
      this.unpin();
    } else {
      this.pin();
    }
  }

  pin() {
    this.pinned = true;
    this.lensElement.classList.add('pinned');
  }

  unpin() {
    this.pinned = false;
    this.lensElement.classList.remove('pinned');
  }

  updateLens() {
    if (!this.lensElement || !this.enabled) return;

    // Position the lens centered on cursor
    this.updateLensPosition();

    // Update geographic coordinates
    this.updateCoordinates();

    // Render the ring with local mode content inside
    this.renderRing();
  }

  updateLensPosition() {
    const lensSize = this.ringRadius * 2 + this.ringThickness * 2;
    const left = this.position.x - lensSize / 2;
    const top = this.position.y - lensSize / 2;

    this.lensElement.style.left = left + 'px';
    this.lensElement.style.top = top + 'px';
  }

  updateCoordinates() {
    if (!this.map || !this.coordsDisplay) return;

    try {
      const lngLat = this.map.unproject([this.position.x, this.position.y]);
      this.geoPosition = lngLat;
      this.coordsDisplay.textContent = `${lngLat.lat.toFixed(4)}, ${lngLat.lng.toFixed(4)}`;
    } catch (e) {
      this.coordsDisplay.textContent = '';
    }
  }

  renderRing() {
    if (!this.ringCanvas || !this.segOverlay) return;

    const ctx = this.ringCanvas.getContext('2d');
    const dpr = 2; // Canvas is 2x for sharpness
    const size = this.ringCanvas.width;
    const center = size / 2;
    const radius = this.ringRadius * dpr;
    const thickness = this.ringThickness * dpr;

    // Clear canvas
    ctx.clearRect(0, 0, size, size);

    // Draw the interior with the selected local mode content
    ctx.save();

    // Create circular clipping path for interior content
    ctx.beginPath();
    ctx.arc(center, center, radius - thickness / 2, 0, Math.PI * 2);
    ctx.clip();

    // Render local mode content inside the ring
    this.renderLocalModeContent(ctx, center, radius - thickness / 2);

    ctx.restore();

    // Draw the ring border
    const modeColor = this.modeColors[this.localMode];
    ctx.strokeStyle = modeColor;
    ctx.lineWidth = thickness;
    ctx.beginPath();
    ctx.arc(center, center, radius, 0, Math.PI * 2);
    ctx.stroke();

    // Draw outer glow
    ctx.shadowColor = modeColor;
    ctx.shadowBlur = 20 * dpr;
    ctx.strokeStyle = modeColor;
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.arc(center, center, radius + thickness / 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Draw crosshair in center
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(center - 15, center);
    ctx.lineTo(center + 15, center);
    ctx.moveTo(center, center - 15);
    ctx.lineTo(center, center + 15);
    ctx.stroke();

    // Center dot
    ctx.fillStyle = 'white';
    ctx.beginPath();
    ctx.arc(center, center, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  /**
   * Render the content for the selected local mode inside the ring
   */
  renderLocalModeContent(ctx, center, radius) {
    if (!this.segOverlay || !this.map) {
      // Fallback background
      ctx.fillStyle = '#1a1a2e';
      ctx.beginPath();
      ctx.arc(center, center, radius, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    const dpr = 2;
    const sampleRadius = this.ringRadius;

    // Get features from overlay
    const features = this.segOverlay.queryStreetFeatures();

    // Background
    ctx.fillStyle = '#1a1a2e';
    ctx.beginPath();
    ctx.arc(center, center, radius, 0, Math.PI * 2);
    ctx.fill();

    // Render based on local mode
    switch (this.localMode) {
      case 'prediction':
        this.renderPredictionInRing(ctx, center, radius, features, dpr);
        break;
      case 'groundTruth':
        this.renderGroundTruthInRing(ctx, center, radius, features, dpr);
        break;
      case 'error':
        this.renderErrorInRing(ctx, center, radius, features, dpr);
        break;
      case 'confidence':
        this.renderConfidenceInRing(ctx, center, radius, features, dpr);
        break;
    }

    // Draw mode label
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(center - 40, center + radius - 30, 80, 20);
    ctx.fillStyle = this.modeColors[this.localMode];
    ctx.font = `bold ${12 * dpr}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.modeLabels[this.localMode].toUpperCase(), center, center + radius - 20);
  }

  renderPredictionInRing(ctx, center, radius, features, dpr) {
    const colors = this.segOverlay.classColors;
    const scale = dpr;

    // Draw features transformed to ring space
    for (const feature of features) {
      if (!this.segOverlay.passesConfidenceFilter(feature)) continue;

      const screenCoords = this.segOverlay.getScreenCoords(feature.geometry);
      if (!screenCoords) continue;

      for (const coords of screenCoords) {
        // Transform to ring space
        const ringCoords = coords.map(([x, y]) => {
          const dx = (x - this.position.x) * scale;
          const dy = (y - this.position.y) * scale;
          return [center + dx, center + dy];
        });

        // Check if any part is within the ring
        const inRing = ringCoords.some(([x, y]) => {
          const dist = Math.sqrt((x - center) ** 2 + (y - center) ** 2);
          return dist < radius;
        });

        if (inRing) {
          // Draw road
          this.drawRingPath(ctx, ringCoords, colors.road, 8 * scale);

          // Draw sidewalks
          const roadWidth = 8 * scale;
          const sidewalkOffset = (roadWidth / 2 + 6 * scale);
          const leftSidewalk = this.offsetPath(ringCoords, sidewalkOffset);
          const rightSidewalk = this.offsetPath(ringCoords, -sidewalkOffset);
          this.drawRingPath(ctx, leftSidewalk, colors.sidewalk, 4 * scale);
          this.drawRingPath(ctx, rightSidewalk, colors.sidewalk, 4 * scale);
        }
      }
    }

    // Draw crosswalks
    this.drawCrosswalksInRing(ctx, center, radius, features, colors.crosswalk, dpr);
  }

  renderGroundTruthInRing(ctx, center, radius, features, dpr) {
    const colors = this.segOverlay.gtColors;
    const scale = dpr;

    for (const feature of features) {
      const screenCoords = this.segOverlay.getScreenCoords(feature.geometry);
      if (!screenCoords) continue;

      for (const coords of screenCoords) {
        const ringCoords = coords.map(([x, y]) => {
          const dx = (x - this.position.x) * scale;
          const dy = (y - this.position.y) * scale;
          return [center + dx, center + dy];
        });

        const inRing = ringCoords.some(([x, y]) => {
          const dist = Math.sqrt((x - center) ** 2 + (y - center) ** 2);
          return dist < radius;
        });

        if (inRing) {
          // Draw with dashed style for ground truth
          this.drawRingPath(ctx, ringCoords, colors.road, 8 * scale, true);

          const sidewalkOffset = 14 * scale;
          const leftSidewalk = this.offsetPath(ringCoords, sidewalkOffset);
          const rightSidewalk = this.offsetPath(ringCoords, -sidewalkOffset);
          this.drawRingPath(ctx, leftSidewalk, colors.sidewalk, 4 * scale, true);
          this.drawRingPath(ctx, rightSidewalk, colors.sidewalk, 4 * scale, true);
        }
      }
    }

    this.drawCrosswalksInRing(ctx, center, radius, features, colors.crosswalk, dpr, true);
  }

  renderErrorInRing(ctx, center, radius, features, dpr) {
    const colors = this.segOverlay.errorColors;
    const scale = dpr;

    // Check error type at center
    const errorType = this.segOverlay.getErrorTypeForCoord(
      this.geoPosition ? [this.geoPosition.lng, this.geoPosition.lat] : null
    );

    // Draw background based on error type
    let bgColor, lineColor;
    switch (errorType) {
      case 'fp':
        bgColor = colors.falsePositive;
        lineColor = colors.falsePositive;
        break;
      case 'fn':
        bgColor = colors.falseNegative;
        lineColor = colors.falseNegative;
        break;
      default:
        bgColor = colors.truePositive;
        lineColor = colors.truePositive;
    }

    ctx.fillStyle = `rgba(${bgColor.r}, ${bgColor.g}, ${bgColor.b}, 0.2)`;
    ctx.beginPath();
    ctx.arc(center, center, radius, 0, Math.PI * 2);
    ctx.fill();

    for (const feature of features) {
      if (!this.segOverlay.passesConfidenceFilter(feature)) continue;

      const screenCoords = this.segOverlay.getScreenCoords(feature.geometry);
      if (!screenCoords) continue;

      for (const coords of screenCoords) {
        const ringCoords = coords.map(([x, y]) => {
          const dx = (x - this.position.x) * scale;
          const dy = (y - this.position.y) * scale;
          return [center + dx, center + dy];
        });

        const inRing = ringCoords.some(([x, y]) => {
          const dist = Math.sqrt((x - center) ** 2 + (y - center) ** 2);
          return dist < radius;
        });

        if (inRing) {
          this.drawRingPath(ctx, ringCoords, lineColor, 8 * scale, errorType !== 'tp');
        }
      }
    }

    // Draw error symbol
    const symbol = errorType === 'fp' ? '✗' : errorType === 'fn' ? '?' : '✓';
    ctx.font = `bold ${36 * dpr}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = `rgb(${bgColor.r}, ${bgColor.g}, ${bgColor.b})`;
    ctx.fillText(symbol, center, center);
  }

  renderConfidenceInRing(ctx, center, radius, features, dpr) {
    const scale = dpr;

    // Calculate average confidence in ring area
    let totalConf = 0;
    let count = 0;

    for (const feature of features) {
      const screenCoords = this.segOverlay.getScreenCoords(feature.geometry);
      if (!screenCoords) continue;

      for (const coords of screenCoords) {
        const nearCenter = coords.some(([x, y]) => {
          const dx = x - this.position.x;
          const dy = y - this.position.y;
          return Math.sqrt(dx * dx + dy * dy) < this.ringRadius;
        });

        if (nearCenter) {
          totalConf += this.segOverlay.getFeatureConfidence(feature);
          count++;
        }
      }
    }

    const avgConf = count > 0 ? totalConf / count : 0.7;
    const color = this.segOverlay.getConfidenceColor(avgConf);

    // Fill with confidence color
    ctx.fillStyle = `rgb(${color.r}, ${color.g}, ${color.b})`;
    ctx.beginPath();
    ctx.arc(center, center, radius, 0, Math.PI * 2);
    ctx.fill();

    // Draw features
    for (const feature of features) {
      const screenCoords = this.segOverlay.getScreenCoords(feature.geometry);
      if (!screenCoords) continue;

      for (const coords of screenCoords) {
        const ringCoords = coords.map(([x, y]) => {
          const dx = (x - this.position.x) * scale;
          const dy = (y - this.position.y) * scale;
          return [center + dx, center + dy];
        });

        const inRing = ringCoords.some(([x, y]) => {
          const dist = Math.sqrt((x - center) ** 2 + (y - center) ** 2);
          return dist < radius;
        });

        if (inRing) {
          const featureConf = this.segOverlay.getFeatureConfidence(feature);
          const featureColor = this.segOverlay.getConfidenceColor(featureConf);
          this.drawRingPath(ctx, ringCoords, featureColor, 6 * scale);
        }
      }
    }

    // Show confidence percentage
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(center - 40, center - 20, 80, 40);
    ctx.fillStyle = 'white';
    ctx.font = `bold ${24 * dpr}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(Math.round(avgConf * 100) + '%', center, center);
  }

  drawRingPath(ctx, coords, color, width, dashed = false) {
    if (coords.length < 2) return;

    ctx.strokeStyle = `rgb(${color.r}, ${color.g}, ${color.b})`;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (dashed) {
      ctx.setLineDash([8, 6]);
    } else {
      ctx.setLineDash([]);
    }

    ctx.beginPath();
    ctx.moveTo(coords[0][0], coords[0][1]);
    for (let i = 1; i < coords.length; i++) {
      ctx.lineTo(coords[i][0], coords[i][1]);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  offsetPath(coords, offset) {
    if (coords.length < 2) return coords;

    const result = [];
    for (let i = 0; i < coords.length; i++) {
      let dx, dy, len;

      if (i === 0) {
        dx = coords[1][0] - coords[0][0];
        dy = coords[1][1] - coords[0][1];
      } else if (i === coords.length - 1) {
        dx = coords[i][0] - coords[i - 1][0];
        dy = coords[i][1] - coords[i - 1][1];
      } else {
        dx = coords[i + 1][0] - coords[i - 1][0];
        dy = coords[i + 1][1] - coords[i - 1][1];
      }

      len = Math.sqrt(dx * dx + dy * dy);
      if (len === 0) {
        result.push([...coords[i]]);
        continue;
      }

      const nx = -dy / len;
      const ny = dx / len;

      result.push([
        coords[i][0] + nx * offset,
        coords[i][1] + ny * offset
      ]);
    }

    return result;
  }

  drawCrosswalksInRing(ctx, center, radius, features, color, dpr, dashed = false) {
    // Find intersections
    const endpointMap = new Map();

    for (const feature of features) {
      if (feature.geometry?.type !== 'LineString') continue;
      const coords = feature.geometry.coordinates;
      if (coords.length < 2) continue;

      const startKey = `${coords[0][0].toFixed(4)},${coords[0][1].toFixed(4)}`;
      if (!endpointMap.has(startKey)) {
        endpointMap.set(startKey, { count: 0, coord: coords[0], directions: [] });
      }
      endpointMap.get(startKey).count++;

      const endCoord = coords[coords.length - 1];
      const endKey = `${endCoord[0].toFixed(4)},${endCoord[1].toFixed(4)}`;
      if (!endpointMap.has(endKey)) {
        endpointMap.set(endKey, { count: 0, coord: endCoord, directions: [] });
      }
      endpointMap.get(endKey).count++;
    }

    const scale = dpr;

    for (const [key, data] of endpointMap) {
      if (data.count >= 2) {
        const screenPoint = this.map.project([data.coord[0], data.coord[1]]);
        const rx = center + (screenPoint.x - this.position.x) * scale;
        const ry = center + (screenPoint.y - this.position.y) * scale;

        const dist = Math.sqrt((rx - center) ** 2 + (ry - center) ** 2);
        if (dist < radius) {
          // Draw crosswalk marker
          ctx.beginPath();
          ctx.arc(rx, ry, 8 * scale, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, 0.9)`;
          ctx.fill();
          ctx.strokeStyle = 'white';
          ctx.lineWidth = 2 * scale;
          if (dashed) ctx.setLineDash([3, 3]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }
  }

  destroy() {
    if (this.lensElement) {
      this.lensElement.remove();
    }
  }
}

if (typeof window !== 'undefined') {
  window.MagnificationLens = MagnificationLens;
}
