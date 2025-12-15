/**
 * Pixel Inspector Component
 * Shows detailed pixel-level information comparing prediction to ground truth
 *
 * Features:
 * - Hover tooltip showing prediction vs ground truth
 * - Click to pin and see detailed info
 * - Class confidence visualization
 * - Error type identification
 */

class PixelInspector {
  constructor(segmentationOverlay, stateManager) {
    this.overlay = segmentationOverlay;
    this.stateManager = stateManager;
    this.map = segmentationOverlay.map;
    this.dataLoader = segmentationOverlay.dataLoader;

    // Inspector state
    this.enabled = true;
    this.pinned = false;
    this.pinnedPixel = null;

    // DOM elements
    this.tooltip = null;
    this.detailPanel = null;

    this.init();
  }

  /**
   * Initialize pixel inspector
   */
  init() {
    console.log('🔍 Initializing Pixel Inspector...');

    this.createTooltip();
    this.createDetailPanel();
    this.setupEventHandlers();
  }

  /**
   * Create hover tooltip element
   */
  createTooltip() {
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'pixel-inspector-tooltip';
    this.tooltip.innerHTML = `
      <div class="inspector-coords"></div>
      <div class="inspector-prediction">
        <span class="inspector-label">Prediction:</span>
        <span class="inspector-value pred-class"></span>
        <span class="inspector-confidence"></span>
      </div>
      <div class="inspector-groundtruth">
        <span class="inspector-label">Ground Truth:</span>
        <span class="inspector-value gt-class"></span>
      </div>
      <div class="inspector-status"></div>
    `;
    this.tooltip.style.display = 'none';
    document.body.appendChild(this.tooltip);

    // Add styles
    this.addStyles();
  }

  /**
   * Create detail panel for pinned pixel
   */
  createDetailPanel() {
    this.detailPanel = document.createElement('div');
    this.detailPanel.className = 'pixel-detail-panel';
    this.detailPanel.innerHTML = `
      <div class="detail-header">
        <h4>Pixel Analysis</h4>
        <button class="detail-close">&times;</button>
      </div>
      <div class="detail-content">
        <div class="detail-section">
          <h5>Location</h5>
          <div class="detail-coords"></div>
          <div class="detail-tile"></div>
        </div>
        <div class="detail-section">
          <h5>Prediction</h5>
          <div class="detail-pred-class"></div>
          <div class="detail-pred-confidence"></div>
          <div class="detail-pred-bar"></div>
        </div>
        <div class="detail-section">
          <h5>Ground Truth</h5>
          <div class="detail-gt-class"></div>
        </div>
        <div class="detail-section detail-status-section">
          <h5>Classification Status</h5>
          <div class="detail-status"></div>
          <div class="detail-error-type"></div>
        </div>
        <div class="detail-section detail-context">
          <h5>Neighborhood Context</h5>
          <canvas class="detail-context-canvas" width="64" height="64"></canvas>
          <div class="detail-context-legend"></div>
        </div>
      </div>
    `;
    this.detailPanel.style.display = 'none';
    document.body.appendChild(this.detailPanel);

    // Close button handler
    this.detailPanel.querySelector('.detail-close').addEventListener('click', () => {
      this.unpin();
    });
  }

  /**
   * Add CSS styles for inspector
   */
  addStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .pixel-inspector-tooltip {
        position: fixed;
        background: rgba(10, 14, 39, 0.95);
        border: 1px solid rgba(212, 175, 55, 0.3);
        border-radius: 8px;
        padding: 10px 14px;
        font-family: 'JetBrains Mono', monospace;
        font-size: 12px;
        color: #f8f9fa;
        pointer-events: none;
        z-index: 10000;
        backdrop-filter: blur(8px);
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
        min-width: 180px;
      }

      .inspector-coords {
        color: #b4b8c0;
        font-size: 10px;
        margin-bottom: 8px;
        padding-bottom: 6px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      }

      .inspector-prediction,
      .inspector-groundtruth {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 4px 0;
      }

      .inspector-label {
        color: #6e7179;
        font-size: 10px;
        min-width: 70px;
      }

      .inspector-value {
        font-weight: 600;
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 11px;
      }

      .inspector-value.road { background: rgba(76, 175, 80, 0.3); color: #4caf50; }
      .inspector-value.sidewalk { background: rgba(33, 150, 243, 0.3); color: #2196f3; }
      .inspector-value.crosswalk { background: rgba(244, 67, 54, 0.3); color: #f44336; }
      .inspector-value.background { background: rgba(100, 100, 100, 0.3); color: #888; }

      .inspector-confidence {
        color: #d4af37;
        font-size: 10px;
      }

      .inspector-status {
        margin-top: 8px;
        padding-top: 6px;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
        font-weight: 600;
        font-size: 11px;
      }

      .inspector-status.correct { color: #2dd4bf; }
      .inspector-status.false-positive { color: #f87171; }
      .inspector-status.false-negative { color: #fbbf24; }
      .inspector-status.misclassification { color: #a78bfa; }

      /* Detail Panel */
      .pixel-detail-panel {
        position: fixed;
        top: 100px;
        right: 20px;
        width: 280px;
        background: rgba(10, 14, 39, 0.98);
        border: 1px solid rgba(212, 175, 55, 0.4);
        border-radius: 12px;
        font-family: 'Inter', sans-serif;
        color: #f8f9fa;
        z-index: 10001;
        backdrop-filter: blur(12px);
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
        overflow: hidden;
      }

      .detail-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 16px;
        background: rgba(212, 175, 55, 0.1);
        border-bottom: 1px solid rgba(212, 175, 55, 0.2);
      }

      .detail-header h4 {
        margin: 0;
        font-size: 14px;
        font-weight: 600;
        color: #d4af37;
      }

      .detail-close {
        background: none;
        border: none;
        color: #b4b8c0;
        font-size: 20px;
        cursor: pointer;
        padding: 0;
        line-height: 1;
      }

      .detail-close:hover {
        color: #f8f9fa;
      }

      .detail-content {
        padding: 16px;
        max-height: 500px;
        overflow-y: auto;
      }

      .detail-section {
        margin-bottom: 16px;
        padding-bottom: 12px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      }

      .detail-section:last-child {
        border-bottom: none;
        margin-bottom: 0;
      }

      .detail-section h5 {
        margin: 0 0 8px 0;
        font-size: 11px;
        font-weight: 600;
        color: #b4b8c0;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .detail-coords,
      .detail-tile {
        font-family: 'JetBrains Mono', monospace;
        font-size: 11px;
        color: #6e7179;
        margin: 2px 0;
      }

      .detail-pred-class,
      .detail-gt-class {
        display: inline-block;
        padding: 4px 10px;
        border-radius: 6px;
        font-weight: 600;
        font-size: 13px;
        margin-bottom: 6px;
      }

      .detail-pred-class.road, .detail-gt-class.road {
        background: rgba(76, 175, 80, 0.2);
        color: #4caf50;
        border: 1px solid rgba(76, 175, 80, 0.3);
      }

      .detail-pred-class.sidewalk, .detail-gt-class.sidewalk {
        background: rgba(33, 150, 243, 0.2);
        color: #2196f3;
        border: 1px solid rgba(33, 150, 243, 0.3);
      }

      .detail-pred-class.crosswalk, .detail-gt-class.crosswalk {
        background: rgba(244, 67, 54, 0.2);
        color: #f44336;
        border: 1px solid rgba(244, 67, 54, 0.3);
      }

      .detail-pred-class.background, .detail-gt-class.background {
        background: rgba(100, 100, 100, 0.2);
        color: #888;
        border: 1px solid rgba(100, 100, 100, 0.3);
      }

      .detail-pred-confidence {
        font-size: 12px;
        color: #b4b8c0;
        margin-bottom: 6px;
      }

      .detail-pred-bar {
        height: 6px;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 3px;
        overflow: hidden;
      }

      .detail-pred-bar-fill {
        height: 100%;
        background: linear-gradient(90deg, #f87171, #fbbf24, #2dd4bf);
        border-radius: 3px;
        transition: width 0.3s ease;
      }

      .detail-status {
        font-weight: 600;
        font-size: 14px;
        margin-bottom: 4px;
      }

      .detail-status.correct { color: #2dd4bf; }
      .detail-status.incorrect { color: #f87171; }

      .detail-error-type {
        font-size: 12px;
        color: #b4b8c0;
      }

      .detail-context-canvas {
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 6px;
        image-rendering: pixelated;
        width: 128px;
        height: 128px;
      }

      .detail-context-legend {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 8px;
        font-size: 10px;
      }

      .legend-item {
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .legend-color {
        width: 12px;
        height: 12px;
        border-radius: 2px;
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Set up event handlers
   */
  setupEventHandlers() {
    // Mouse move for tooltip
    this.map.on('mousemove', (e) => {
      if (!this.enabled || this.pinned) return;
      this.handleMouseMove(e);
    });

    // Mouse leave to hide tooltip
    this.map.getContainer().addEventListener('mouseleave', () => {
      if (!this.pinned) {
        this.hideTooltip();
      }
    });

    // Click to pin
    this.map.on('click', (e) => {
      if (!this.enabled) return;
      this.handleClick(e);
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.pinned) {
        this.unpin();
      }
      if (e.key === 'i' || e.key === 'I') {
        this.toggle();
      }
    });
  }

  /**
   * Handle mouse move
   */
  handleMouseMove(e) {
    const pixelInfo = this.overlay.getPixelInfo(e.point.x, e.point.y);

    if (pixelInfo && pixelInfo.prediction) {
      this.showTooltip(e.point.x, e.point.y, pixelInfo);
    } else {
      this.hideTooltip();
    }
  }

  /**
   * Handle click to pin
   */
  handleClick(e) {
    const pixelInfo = this.overlay.getPixelInfo(e.point.x, e.point.y);

    if (pixelInfo && pixelInfo.prediction) {
      if (this.pinned && this.isSamePixel(pixelInfo)) {
        this.unpin();
      } else {
        this.pin(pixelInfo);
      }
    }
  }

  /**
   * Check if pixel info matches pinned pixel
   */
  isSamePixel(pixelInfo) {
    if (!this.pinnedPixel) return false;
    return this.pinnedPixel.tileId === pixelInfo.tileId &&
           this.pinnedPixel.pixelX === pixelInfo.pixelX &&
           this.pinnedPixel.pixelY === pixelInfo.pixelY;
  }

  /**
   * Show tooltip at position
   */
  showTooltip(x, y, pixelInfo) {
    const tooltip = this.tooltip;

    // Update content
    tooltip.querySelector('.inspector-coords').textContent =
      `${pixelInfo.lngLat[1].toFixed(6)}, ${pixelInfo.lngLat[0].toFixed(6)}`;

    const predClass = tooltip.querySelector('.pred-class');
    predClass.textContent = pixelInfo.prediction.className;
    predClass.className = `inspector-value ${pixelInfo.prediction.className}`;

    const confEl = tooltip.querySelector('.inspector-confidence');
    if (pixelInfo.prediction.confidence !== null) {
      confEl.textContent = `(${(pixelInfo.prediction.confidence * 100).toFixed(0)}%)`;
    } else {
      confEl.textContent = '';
    }

    const gtClass = tooltip.querySelector('.gt-class');
    if (pixelInfo.groundTruth) {
      gtClass.textContent = pixelInfo.groundTruth.className;
      gtClass.className = `inspector-value ${pixelInfo.groundTruth.className}`;
      tooltip.querySelector('.inspector-groundtruth').style.display = 'flex';
    } else {
      tooltip.querySelector('.inspector-groundtruth').style.display = 'none';
    }

    // Status
    const status = tooltip.querySelector('.inspector-status');
    if (pixelInfo.isCorrect !== null) {
      if (pixelInfo.isCorrect) {
        status.textContent = '✓ Correct';
        status.className = 'inspector-status correct';
      } else {
        const errorType = this.getErrorType(pixelInfo);
        status.textContent = errorType.label;
        status.className = `inspector-status ${errorType.class}`;
      }
    } else {
      status.textContent = '';
    }

    // Position tooltip
    const offset = 15;
    let left = x + offset;
    let top = y + offset;

    // Prevent overflow
    const rect = tooltip.getBoundingClientRect();
    if (left + rect.width > window.innerWidth) {
      left = x - rect.width - offset;
    }
    if (top + rect.height > window.innerHeight) {
      top = y - rect.height - offset;
    }

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
    tooltip.style.display = 'block';
  }

  /**
   * Hide tooltip
   */
  hideTooltip() {
    this.tooltip.style.display = 'none';
  }

  /**
   * Get error type for misclassified pixel
   */
  getErrorType(pixelInfo) {
    const pred = pixelInfo.prediction.classId;
    const gt = pixelInfo.groundTruth?.classId;

    if (gt === undefined || gt === null) {
      return { label: 'Unknown', class: '' };
    }

    if (pred === gt) {
      return { label: '✓ Correct', class: 'correct' };
    }

    if (pred !== 0 && gt === 0) {
      return { label: '✗ False Positive', class: 'false-positive' };
    }

    if (pred === 0 && gt !== 0) {
      return { label: '✗ False Negative', class: 'false-negative' };
    }

    return { label: '✗ Misclassification', class: 'misclassification' };
  }

  /**
   * Pin pixel for detailed inspection
   */
  pin(pixelInfo) {
    this.pinned = true;
    this.pinnedPixel = pixelInfo;

    this.hideTooltip();
    this.showDetailPanel(pixelInfo);

    // Highlight pinned location on map
    this.highlightPinnedLocation(pixelInfo);
  }

  /**
   * Unpin and close detail panel
   */
  unpin() {
    this.pinned = false;
    this.pinnedPixel = null;

    this.detailPanel.style.display = 'none';
    this.removePinnedHighlight();
  }

  /**
   * Show detail panel for pixel
   */
  showDetailPanel(pixelInfo) {
    const panel = this.detailPanel;

    // Location
    panel.querySelector('.detail-coords').textContent =
      `Lat: ${pixelInfo.lngLat[1].toFixed(6)}, Lng: ${pixelInfo.lngLat[0].toFixed(6)}`;
    panel.querySelector('.detail-tile').textContent =
      `Tile: ${pixelInfo.tileId} | Pixel: (${pixelInfo.pixelX}, ${pixelInfo.pixelY})`;

    // Prediction
    const predClass = panel.querySelector('.detail-pred-class');
    predClass.textContent = pixelInfo.prediction.className;
    predClass.className = `detail-pred-class ${pixelInfo.prediction.className}`;

    const conf = pixelInfo.prediction.confidence;
    if (conf !== null) {
      panel.querySelector('.detail-pred-confidence').textContent =
        `Confidence: ${(conf * 100).toFixed(1)}%`;
      panel.querySelector('.detail-pred-bar').innerHTML =
        `<div class="detail-pred-bar-fill" style="width: ${conf * 100}%"></div>`;
    } else {
      panel.querySelector('.detail-pred-confidence').textContent = '';
      panel.querySelector('.detail-pred-bar').innerHTML = '';
    }

    // Ground Truth
    const gtClass = panel.querySelector('.detail-gt-class');
    if (pixelInfo.groundTruth) {
      gtClass.textContent = pixelInfo.groundTruth.className;
      gtClass.className = `detail-gt-class ${pixelInfo.groundTruth.className}`;
    } else {
      gtClass.textContent = 'N/A';
      gtClass.className = 'detail-gt-class';
    }

    // Status
    const statusEl = panel.querySelector('.detail-status');
    const errorTypeEl = panel.querySelector('.detail-error-type');

    if (pixelInfo.isCorrect !== null) {
      if (pixelInfo.isCorrect) {
        statusEl.textContent = '✓ Correctly Classified';
        statusEl.className = 'detail-status correct';
        errorTypeEl.textContent = 'The model prediction matches ground truth.';
      } else {
        const errorType = this.getErrorType(pixelInfo);
        statusEl.textContent = errorType.label;
        statusEl.className = `detail-status incorrect`;
        errorTypeEl.textContent = this.getErrorExplanation(pixelInfo);
      }
    } else {
      statusEl.textContent = 'Unknown';
      statusEl.className = 'detail-status';
      errorTypeEl.textContent = 'Ground truth not available.';
    }

    // Neighborhood context
    this.renderNeighborhoodContext(pixelInfo);

    panel.style.display = 'block';
  }

  /**
   * Get explanation for error type
   */
  getErrorExplanation(pixelInfo) {
    const pred = pixelInfo.prediction.className;
    const gt = pixelInfo.groundTruth?.className;

    if (!gt) return 'Ground truth not available.';

    if (pred !== 'background' && gt === 'background') {
      return `Model incorrectly detected ${pred} where there is none (false positive).`;
    }

    if (pred === 'background' && gt !== 'background') {
      return `Model missed ${gt} in this location (false negative).`;
    }

    return `Model predicted ${pred} but ground truth is ${gt} (misclassification).`;
  }

  /**
   * Render neighborhood context in canvas
   */
  renderNeighborhoodContext(pixelInfo) {
    const canvas = this.detailPanel.querySelector('.detail-context-canvas');
    const ctx = canvas.getContext('2d');

    const mask = this.dataLoader.segmentationMasks.get(pixelInfo.tileId);
    if (!mask) {
      ctx.fillStyle = '#333';
      ctx.fillRect(0, 0, 64, 64);
      return;
    }

    // Extract 16x16 neighborhood around pixel
    const { width, height, pixels, confidences } = mask;
    const cx = pixelInfo.pixelX;
    const cy = pixelInfo.pixelY;
    const radius = 8;

    const classColors = {
      0: [40, 40, 40],      // Background
      1: [76, 175, 80],     // Road
      2: [33, 150, 243],    // Sidewalk
      3: [244, 67, 54]      // Crosswalk
    };

    const imageData = ctx.createImageData(16, 16);

    for (let dy = -radius; dy < radius; dy++) {
      for (let dx = -radius; dx < radius; dx++) {
        const px = cx + dx;
        const py = cy + dy;
        const destIdx = ((dy + radius) * 16 + (dx + radius)) * 4;

        if (px >= 0 && px < width && py >= 0 && py < height) {
          const srcIdx = py * width + px;
          const classId = pixels[srcIdx];
          const color = classColors[classId] || classColors[0];

          // Highlight center pixel
          const isCenter = dx === 0 && dy === 0;

          imageData.data[destIdx] = color[0];
          imageData.data[destIdx + 1] = color[1];
          imageData.data[destIdx + 2] = color[2];
          imageData.data[destIdx + 3] = isCenter ? 255 : 200;
        } else {
          // Out of bounds
          imageData.data[destIdx] = 20;
          imageData.data[destIdx + 1] = 20;
          imageData.data[destIdx + 2] = 20;
          imageData.data[destIdx + 3] = 255;
        }
      }
    }

    // Scale to canvas
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = 16;
    tempCanvas.height = 16;
    tempCanvas.getContext('2d').putImageData(imageData, 0, 0);

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tempCanvas, 0, 0, 64, 64);

    // Draw center indicator
    ctx.strokeStyle = '#d4af37';
    ctx.lineWidth = 2;
    ctx.strokeRect(28, 28, 8, 8);

    // Update legend
    const legend = this.detailPanel.querySelector('.detail-context-legend');
    legend.innerHTML = `
      <div class="legend-item">
        <div class="legend-color" style="background: rgb(40, 40, 40)"></div>
        <span>Background</span>
      </div>
      <div class="legend-item">
        <div class="legend-color" style="background: rgb(76, 175, 80)"></div>
        <span>Road</span>
      </div>
      <div class="legend-item">
        <div class="legend-color" style="background: rgb(33, 150, 243)"></div>
        <span>Sidewalk</span>
      </div>
      <div class="legend-item">
        <div class="legend-color" style="background: rgb(244, 67, 54)"></div>
        <span>Crosswalk</span>
      </div>
    `;
  }

  /**
   * Highlight pinned location on map
   */
  highlightPinnedLocation(pixelInfo) {
    // Add a marker at the pinned location
    if (this.pinnedMarker) {
      this.pinnedMarker.remove();
    }

    const el = document.createElement('div');
    el.className = 'pinned-pixel-marker';
    el.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" fill="none" stroke="#d4af37" stroke-width="2"/>
        <circle cx="12" cy="12" r="4" fill="#d4af37"/>
      </svg>
    `;

    this.pinnedMarker = new mapboxgl.Marker(el)
      .setLngLat(pixelInfo.lngLat)
      .addTo(this.map);
  }

  /**
   * Remove pinned location highlight
   */
  removePinnedHighlight() {
    if (this.pinnedMarker) {
      this.pinnedMarker.remove();
      this.pinnedMarker = null;
    }
  }

  /**
   * Toggle inspector on/off
   */
  toggle() {
    this.enabled = !this.enabled;

    if (!this.enabled) {
      this.hideTooltip();
      this.unpin();
    }

    console.log(`🔍 Pixel Inspector: ${this.enabled ? 'enabled' : 'disabled'}`);
    return this.enabled;
  }

  /**
   * Enable inspector
   */
  enable() {
    this.enabled = true;
  }

  /**
   * Disable inspector
   */
  disable() {
    this.enabled = false;
    this.hideTooltip();
    this.unpin();
  }

  /**
   * Cleanup
   */
  destroy() {
    this.tooltip?.remove();
    this.detailPanel?.remove();
    this.removePinnedHighlight();
  }
}

// Make available globally
if (typeof window !== 'undefined') {
  window.PixelInspector = PixelInspector;
}
