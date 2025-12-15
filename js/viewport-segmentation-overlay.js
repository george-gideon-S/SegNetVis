/**
 * Viewport-Based Segmentation Overlay
 *
 * REQUIREMENTS:
 * 1. Roads = GREEN only, Sidewalks = BLUE only, Crosswalks = RED only (NO mixing)
 * 2. Maximum zoom-out limit to prevent broken overlays
 * 3. FP/FN regions are GEOREFERENCED polygons that move with the map
 * 4. Crosswalks must be clearly visible and aligned with street geometry
 * 5. Errors mode shows meaningful comparison between prediction and ground truth
 */

class ViewportSegmentationOverlay {
  constructor(map, stateManager) {
    this.map = map;
    this.stateManager = stateManager;

    // Canvas
    this.canvas = null;
    this.ctx = null;

    // Display settings
    // Modes: 'original', 'prediction', 'groundTruth', 'error', 'confidence'
    this.displayMode = 'prediction';
    this.opacity = 0.7;
    this.visible = true;

    // Class visibility
    this.classVisibility = {
      road: true,
      sidewalk: true,
      crosswalk: true
    };

    // Error type visibility (for Errors mode filtering)
    this.errorTypeVisibility = {
      truePositive: true,
      falsePositive: true,
      falseNegative: true
    };

    // Confidence filter range (0-1)
    this.confidenceRange = {
      min: 0,
      max: 1
    };

    // Simulated per-feature confidence data (in real implementation, from tile2net)
    this.featureConfidence = new Map();

    // DISTINCT class colors - completely separate, no mixing
    this.classColors = {
      road: { r: 76, g: 175, b: 80 },       // Green ONLY for roads
      sidewalk: { r: 33, g: 150, b: 243 },  // Blue ONLY for sidewalks
      crosswalk: { r: 244, g: 67, b: 54 }   // Red ONLY for crosswalks
    };

    // Ground truth uses DISTINCTLY DIFFERENT colors + dashed/hatched style
    // Using orange/purple/magenta palette to clearly distinguish from prediction colors
    this.gtColors = {
      road: { r: 255, g: 152, b: 0 },       // ORANGE (instead of green)
      sidewalk: { r: 156, g: 39, b: 176 },  // PURPLE (instead of blue)
      crosswalk: { r: 233, g: 30, b: 99 }   // PINK/MAGENTA (instead of red)
    };

    // Error colors for FP/FN/TP
    this.errorColors = {
      truePositive: { r: 45, g: 212, b: 191 },   // Teal - correct predictions
      falsePositive: { r: 239, g: 68, b: 68 },   // Red - predicted but not in GT
      falseNegative: { r: 251, g: 191, b: 36 }   // Amber - in GT but not predicted
    };

    // Street widths in METERS
    this.roadWidthMeters = {
      'motorway': 10,
      'trunk': 8,
      'primary': 7,
      'secondary': 6,
      'tertiary': 5,
      'street': 4,
      'residential': 4,
      'service': 3,
      'default': 4
    };

    // Sidewalk offset from road edge (in meters)
    this.sidewalkWidthMeters = 2;
    this.sidewalkGapMeters = 1; // Gap between road edge and sidewalk

    // ZOOM LIMITS - range for viewing
    // UI displays normalized scale 2-5, internal range is 14.95-17.8
    this.minZoom = 14.95;  // Level 2 (normalized) - zoomed out limit (minimum)
    this.maxZoom = 17.8;   // Level 5 (normalized) - zoomed in (maximum)

    // GEOREFERENCED ERROR REGIONS - stored as lat/lng polygons
    // These are FIXED geographic locations that move with the map
    this.geoErrorRegions = [];
    this.geoErrorRegionsInitialized = false; // Only initialize once!

    // Statistics
    this.statistics = null;

    // Network graph overlay data (for Idea B)
    this.networkData = null;
    this.networkNodes = null;
    this.showNetworkGraph = false;

    // Visualization mode and problem data (for Idea B styling)
    this.networkVisualMode = 'quality'; // 'quality', 'centrality', 'problems'
    this.problemData = null;
    this.problemNodeSet = new Set(); // Node IDs that have problems
    this.problemEdgeSet = new Set(); // Edge IDs that have problems

    // Performance
    this.renderScheduled = false;
    this.lastRenderTime = 0;
    this.minRenderInterval = 16;
    this.cachedFeatures = null;
    this.cacheValid = false;

    // Bind methods
    this._onRender = this.onMapRender.bind(this);
    this._onMoveEnd = this.onMoveEnd.bind(this);
    this._onMoveStart = this.onMoveStart.bind(this);

    this.init();
  }

  init() {
    console.log('🎨 Initializing Viewport Segmentation Overlay...');

    this.createCanvas();
    this.setupEventListeners();
    this.enforceZoomLimits();

    if (this.map.isStyleLoaded()) {
      this.initializeGeoErrorRegions();
      this.scheduleRender();
    } else {
      this.map.on('style.load', () => {
        this.initializeGeoErrorRegions();
        this.scheduleRender();
      });
    }

    console.log('✅ Viewport Segmentation Overlay initialized');
  }

  /**
   * ENFORCE ZOOM LIMITS - prevents overlay from breaking at low zoom
   */
  enforceZoomLimits() {
    this.map.setMinZoom(this.minZoom);
    this.map.setMaxZoom(this.maxZoom);
    console.log(`Zoom limits enforced: ${this.minZoom} - ${this.maxZoom}`);
  }

  createCanvas() {
    const container = this.map.getContainer();

    this.canvas = document.createElement('canvas');
    this.canvas.id = 'seg-canvas-' + Math.random().toString(36).substr(2, 9);
    this.canvas.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 10;
    `;

    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.canvas.style.width = rect.width + 'px';
    this.canvas.style.height = rect.height + 'px';

    this.ctx = this.canvas.getContext('2d');
    container.appendChild(this.canvas);

    new ResizeObserver(() => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = rect.width * dpr;
      this.canvas.height = rect.height * dpr;
      this.canvas.style.width = rect.width + 'px';
      this.canvas.style.height = rect.height + 'px';
      this.scheduleRender();
    }).observe(container);
  }

  setupEventListeners() {
    this.map.on('render', this._onRender);
    this.map.on('moveend', this._onMoveEnd);
    this.map.on('movestart', this._onMoveStart);

    // CRITICAL: Also listen for zoom events specifically
    // This ensures the canvas re-renders correctly when zoom changes
    this.map.on('zoom', () => {
      // Invalidate cache on zoom to ensure fresh feature query
      this.cacheValid = false;
    });

    // Force render on zoomend to catch any missed updates
    this.map.on('zoomend', () => {
      this.cacheValid = false;
      this.cachedFeatures = null;
      this.scheduleRender();
    });

    // Click handler for isolating problem regions (Idea A feature)
    this.map.on('click', (e) => {
      if (this.displayMode === 'error') {
        const clickedRegion = this.findErrorRegionAtPoint(e.lngLat);
        if (clickedRegion) {
          this.isolateErrorRegion(clickedRegion);
        }
      }
    });
  }

  /**
   * Find error region at a clicked point
   */
  findErrorRegionAtPoint(lngLat) {
    if (!this.geoErrorRegions) return null;

    for (const region of this.geoErrorRegions) {
      if (this.pointInPolygon(lngLat, region.polygon)) {
        return region;
      }
    }
    return null;
  }

  /**
   * Isolate and highlight a specific error region
   * Zooms to the region and shows only that error type
   */
  isolateErrorRegion(region) {
    // Calculate bounds of the region
    let minLng = Infinity, maxLng = -Infinity;
    let minLat = Infinity, maxLat = -Infinity;

    for (const point of region.polygon) {
      minLng = Math.min(minLng, point.lng);
      maxLng = Math.max(maxLng, point.lng);
      minLat = Math.min(minLat, point.lat);
      maxLat = Math.max(maxLat, point.lat);
    }

    // Zoom to region with padding
    this.map.fitBounds(
      [[minLng, minLat], [maxLng, maxLat]],
      { padding: 100, duration: 500 }
    );

    // Temporarily show only this error type
    const errorType = region.type;
    const previousVisibility = { ...this.errorTypeVisibility };

    // Hide all error types except the clicked one
    this.errorTypeVisibility = {
      truePositive: errorType === 'tp',
      falsePositive: errorType === 'fp',
      falseNegative: errorType === 'fn'
    };

    this.scheduleRender();

    // Dispatch event for UI to show details
    document.dispatchEvent(new CustomEvent('errorRegionIsolated', {
      detail: {
        type: errorType,
        region: region,
        bounds: [[minLng, minLat], [maxLng, maxLat]]
      }
    }));

    // Show toast notification
    const typeLabels = {
      fp: 'False Positive',
      fn: 'False Negative',
      tp: 'True Positive'
    };

    if (window.app && window.app.showToast) {
      window.app.showToast(
        'Region Isolated',
        `Showing ${typeLabels[errorType]} region. Click elsewhere to reset.`,
        'info'
      );
    }

    // Reset after 5 seconds or on next click
    setTimeout(() => {
      this.errorTypeVisibility = previousVisibility;
      this.scheduleRender();
    }, 5000);
  }

  onMoveStart() {
    this.cacheValid = false;
  }

  onMapRender() {
    const now = performance.now();
    if (now - this.lastRenderTime < this.minRenderInterval) {
      if (!this.renderScheduled) {
        this.renderScheduled = true;
        requestAnimationFrame(() => {
          this.renderScheduled = false;
          this.renderOverlay();
        });
      }
      return;
    }
    this.lastRenderTime = now;
    this.renderOverlay();
  }

  onMoveEnd() {
    this.cacheValid = false;
    this.cachedFeatures = null;
    // DON'T regenerate error regions - they are FIXED geographic locations
    // that should move with the map, not follow the viewport
    this.computeStatisticsForViewport();
  }

  scheduleRender() {
    requestAnimationFrame(() => {
      this.renderOverlay();
      this.computeStatisticsForViewport();
    });
  }

  /**
   * Initialize GEOREFERENCED error regions - ONLY ONCE at startup
   * These are FIXED geographic coordinates that MOVE WITH THE MAP when panning
   *
   * The regions represent areas where:
   * - FP (False Positive): Model predicted infrastructure that doesn't exist
   * - FN (False Negative): Model missed infrastructure that does exist
   * - TP (True Positive): Model correctly predicted (everywhere else)
   */
  initializeGeoErrorRegions() {
    // Only initialize once! These are FIXED geographic locations
    if (this.geoErrorRegionsInitialized) {
      return;
    }

    const center = this.map.getCenter();
    const centerLng = center.lng;
    const centerLat = center.lat;

    // Create FIXED geographic regions around the initial center point
    // These coordinates are absolute and will move with the map

    // FP region: Northeast of center (simulating an area with false positive predictions)
    // This could represent an area where the model incorrectly predicted roads/sidewalks
    const fpOffset = 0.003; // ~300m offset
    const fpRegion = {
      type: 'fp',
      label: 'False Positive Zone',
      description: 'Model predicted infrastructure here, but none exists',
      polygon: [
        [centerLng + fpOffset * 0.5, centerLat + fpOffset * 0.5],
        [centerLng + fpOffset * 2.0, centerLat + fpOffset * 0.5],
        [centerLng + fpOffset * 2.0, centerLat + fpOffset * 1.8],
        [centerLng + fpOffset * 0.5, centerLat + fpOffset * 1.8],
        [centerLng + fpOffset * 0.5, centerLat + fpOffset * 0.5] // Close polygon
      ]
    };

    // FN region: Southwest of center (simulating an area with false negatives)
    // This could represent an area where the model missed actual infrastructure
    const fnRegion = {
      type: 'fn',
      label: 'False Negative Zone',
      description: 'Actual infrastructure exists here, but model missed it',
      polygon: [
        [centerLng - fpOffset * 2.0, centerLat - fpOffset * 1.8],
        [centerLng - fpOffset * 0.5, centerLat - fpOffset * 1.8],
        [centerLng - fpOffset * 0.5, centerLat - fpOffset * 0.5],
        [centerLng - fpOffset * 2.0, centerLat - fpOffset * 0.5],
        [centerLng - fpOffset * 2.0, centerLat - fpOffset * 1.8] // Close polygon
      ]
    };

    // Additional FP region: A smaller spot (simulating a specific false positive)
    const fpSpot = {
      type: 'fp',
      label: 'FP Spot',
      polygon: [
        [centerLng + fpOffset * 0.2, centerLat - fpOffset * 0.8],
        [centerLng + fpOffset * 0.8, centerLat - fpOffset * 0.8],
        [centerLng + fpOffset * 0.8, centerLat - fpOffset * 0.3],
        [centerLng + fpOffset * 0.2, centerLat - fpOffset * 0.3],
        [centerLng + fpOffset * 0.2, centerLat - fpOffset * 0.8]
      ]
    };

    // Additional FN region: A smaller spot (simulating a specific missed prediction)
    const fnSpot = {
      type: 'fn',
      label: 'FN Spot',
      polygon: [
        [centerLng - fpOffset * 0.8, centerLat + fpOffset * 0.3],
        [centerLng - fpOffset * 0.2, centerLat + fpOffset * 0.3],
        [centerLng - fpOffset * 0.2, centerLat + fpOffset * 0.9],
        [centerLng - fpOffset * 0.8, centerLat + fpOffset * 0.9],
        [centerLng - fpOffset * 0.8, centerLat + fpOffset * 0.3]
      ]
    };

    this.geoErrorRegions = [fpRegion, fnRegion, fpSpot, fnSpot];
    this.geoErrorRegionsInitialized = true;

    console.log('📍 Initialized FIXED geo-referenced error regions at:',
      `center: [${centerLng.toFixed(4)}, ${centerLat.toFixed(4)}]`);
  }

  /**
   * Convert meters to pixels at current zoom level
   */
  metersToPixels(meters) {
    const zoom = this.map.getZoom();
    const lat = this.map.getCenter().lat;
    const metersPerPixel = 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, zoom);
    return meters / metersPerPixel;
  }

  /**
   * Get road width in pixels based on road class
   */
  getRoadWidthPixels(roadClass) {
    const meters = this.roadWidthMeters[roadClass] || this.roadWidthMeters['default'];
    const pixels = this.metersToPixels(meters);
    return Math.max(2, Math.min(pixels, 30));
  }

  /**
   * Query street features from Mapbox vector tiles
   *
   * Works across the full zoom range (14-17.8) and all Mapbox styles by:
   * 1. Trying specific layer names first (works well at high zoom)
   * 2. Falling back to querying all features (robust at low zoom)
   * 3. Looking for roads in source-layer data as well as layer IDs
   */
  queryStreetFeatures() {
    if (this.cacheValid && this.cachedFeatures) {
      return this.cachedFeatures;
    }

    const features = [];
    const seen = new Set(); // Prevent duplicates

    // Comprehensive list of road layer names across different Mapbox styles
    // (streets-v12, dark-v11, light-v11, satellite-streets-v12, etc.)
    const roadLayers = [
      // streets-v12 / standard style layers
      'road-primary', 'road-secondary-tertiary', 'road-street',
      'road-minor', 'road-motorway', 'road-trunk',
      'tunnel-primary', 'tunnel-secondary-tertiary',
      'bridge-primary', 'bridge-secondary-tertiary',
      'road-path', 'road-pedestrian', 'road-label',
      // dark-v11 / light-v11 layers
      'road-motorway-trunk', 'road-primary-navigation',
      'road-secondary-tertiary-navigation', 'road-street-navigation',
      'road-minor-low', 'road-minor-case', 'road-minor-link',
      'road-major-link', 'road-major-link-case',
      // Additional variations
      'road', 'roads', 'street', 'highway'
    ];

    // Query each road layer by name
    for (const layerId of roadLayers) {
      try {
        const layerFeatures = this.map.queryRenderedFeatures({ layers: [layerId] });
        for (const f of layerFeatures) {
          const fid = f.id || `${f.geometry?.coordinates?.[0]?.[0]}_${f.geometry?.coordinates?.[0]?.[1]}`;
          if (!seen.has(fid)) {
            seen.add(fid);
            features.push(f);
          }
        }
      } catch (e) { /* layer not found - skip */ }
    }

    // ALWAYS also query all features to catch any roads we might have missed
    // This is critical for stability across zoom levels
    try {
      const allFeatures = this.map.queryRenderedFeatures();
      for (const f of allFeatures) {
        const sourceLayer = f.sourceLayer || '';
        const layerId = f.layer?.id || '';
        const layerType = f.layer?.type || '';

        // Check if this is a road-related feature
        const isRoad = sourceLayer.includes('road') ||
                       layerId.includes('road') ||
                       layerId.includes('street') ||
                       layerId.includes('highway') ||
                       sourceLayer.includes('road_network');

        // Only include line geometries (not labels or polygons)
        const isLine = f.geometry?.type === 'LineString' ||
                       f.geometry?.type === 'MultiLineString';

        if (isRoad && isLine && layerType === 'line') {
          const fid = f.id || `${f.geometry?.coordinates?.[0]?.[0]}_${f.geometry?.coordinates?.[0]?.[1]}`;
          if (!seen.has(fid)) {
            seen.add(fid);
            features.push(f);
          }
        }
      }
    } catch (e) {
      console.warn('queryRenderedFeatures fallback failed:', e);
    }

    this.cachedFeatures = features;
    this.cacheValid = true;
    return features;
  }

  /**
   * Project geographic coordinates to screen coordinates
   */
  projectToScreen(coords) {
    return coords.map(coord => {
      const p = this.map.project([coord[0], coord[1]]);
      return [p.x, p.y];
    });
  }

  /**
   * Get screen coordinates for a geometry
   */
  getScreenCoords(geometry) {
    if (!geometry) return null;

    if (geometry.type === 'LineString') {
      return [this.projectToScreen(geometry.coordinates)];
    } else if (geometry.type === 'MultiLineString') {
      return geometry.coordinates.map(line => this.projectToScreen(line));
    }
    return null;
  }

  /**
   * Compute offset line (for sidewalks parallel to roads)
   */
  computeOffsetLine(screenCoords, offsetPixels, side) {
    if (screenCoords.length < 2) return screenCoords;

    const result = [];
    const sign = side === 'left' ? 1 : -1;

    for (let i = 0; i < screenCoords.length; i++) {
      let dx, dy, len;

      if (i === 0) {
        dx = screenCoords[1][0] - screenCoords[0][0];
        dy = screenCoords[1][1] - screenCoords[0][1];
      } else if (i === screenCoords.length - 1) {
        dx = screenCoords[i][0] - screenCoords[i - 1][0];
        dy = screenCoords[i][1] - screenCoords[i - 1][1];
      } else {
        dx = screenCoords[i + 1][0] - screenCoords[i - 1][0];
        dy = screenCoords[i + 1][1] - screenCoords[i - 1][1];
      }

      len = Math.sqrt(dx * dx + dy * dy);
      if (len === 0) {
        result.push([...screenCoords[i]]);
        continue;
      }

      // Perpendicular vector
      const nx = -dy / len * sign;
      const ny = dx / len * sign;

      result.push([
        screenCoords[i][0] + nx * offsetPixels,
        screenCoords[i][1] + ny * offsetPixels
      ]);
    }

    return result;
  }

  /**
   * Check if a point is inside a polygon (ray casting algorithm)
   */
  pointInPolygon(point, polygon) {
    const [x, y] = point;
    let inside = false;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [xi, yi] = polygon[i];
      const [xj, yj] = polygon[j];

      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }

    return inside;
  }

  /**
   * Get the error type for a geographic coordinate
   */
  getErrorTypeForCoord(lngLat) {
    if (!lngLat || !this.geoErrorRegions) return 'tp';

    for (const region of this.geoErrorRegions) {
      if (this.pointInPolygon([lngLat[0], lngLat[1]], region.polygon)) {
        return region.type;
      }
    }

    return 'tp';
  }

  /**
   * Get center coordinate of a feature's geometry
   */
  getFeatureCenterGeo(feature) {
    if (!feature.geometry) return null;

    const coords = feature.geometry.type === 'LineString'
      ? feature.geometry.coordinates
      : feature.geometry.coordinates[0];

    if (!coords || coords.length === 0) return null;
    return coords[Math.floor(coords.length / 2)];
  }

  /**
   * Draw a polyline path
   */
  drawPath(ctx, coords, color, width, alpha = 0.8, dashed = false) {
    if (!coords || coords.length < 2) return;

    ctx.strokeStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
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

  /**
   * Draw a filled polygon from geographic coordinates (GEOREFERENCED)
   */
  drawGeoPolygon(ctx, polygon, fillColor, strokeColor, fillAlpha = 0.2) {
    if (!polygon || polygon.length < 3) return;

    // Project geographic coordinates to screen
    const screenCoords = polygon.map(coord => {
      const p = this.map.project([coord[0], coord[1]]);
      return [p.x, p.y];
    });

    // Fill
    ctx.fillStyle = `rgba(${fillColor.r}, ${fillColor.g}, ${fillColor.b}, ${fillAlpha})`;
    ctx.beginPath();
    ctx.moveTo(screenCoords[0][0], screenCoords[0][1]);
    for (let i = 1; i < screenCoords.length; i++) {
      ctx.lineTo(screenCoords[i][0], screenCoords[i][1]);
    }
    ctx.closePath();
    ctx.fill();

    // Stroke (dashed)
    ctx.strokeStyle = `rgba(${strokeColor.r}, ${strokeColor.g}, ${strokeColor.b}, 0.8)`;
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 6]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /**
   * Draw a label at a geographic position
   */
  drawGeoLabel(ctx, lngLat, text, color) {
    const screenPos = this.map.project([lngLat[0], lngLat[1]]);

    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Background
    const textWidth = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(screenPos.x - textWidth / 2 - 10, screenPos.y - 12, textWidth + 20, 24);

    // Text
    ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, 1)`;
    ctx.fillText(text, screenPos.x, screenPos.y);
  }

  /**
   * Main render function
   * Handles all display modes: original, prediction, groundTruth, error, confidence
   */
  renderOverlay() {
    if (!this.visible || !this.ctx || !this.map.isStyleLoaded()) return;

    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;

    // Clear canvas
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.scale(dpr, dpr);

    // ORIGINAL MODE: Show nothing (just the base map imagery)
    if (this.displayMode === 'original') {
      this.renderOriginalMode(ctx);
      return;
    }

    ctx.globalAlpha = this.opacity;

    const features = this.queryStreetFeatures();

    // Assign simulated confidence values to features (in production, from tile2net)
    this.assignFeatureConfidence(features);

    switch (this.displayMode) {
      case 'error':
        this.renderErrorMode(ctx, features);
        break;
      case 'confidence':
        this.renderConfidenceMode(ctx, features);
        break;
      case 'prediction':
      case 'groundTruth':
      default:
        this.renderSegmentationMode(ctx, features);
    }

    ctx.globalAlpha = 1.0;

    // Draw network graph overlay ON TOP of segmentation (for Idea B)
    // IMPORTANT: If showNetworkGraph is enabled, derive the network from the same
    // Mapbox vector tile features used for segmentation to ensure full map coverage.
    // This replaces the static GeoJSON approach which only covered a limited area.
    if (this.showNetworkGraph) {
      this.renderNetworkGraphFromFeatures(ctx, features);
    }
  }

  /**
   * Set network data for graph overlay (Idea B)
   * @param {Object} networkData - GeoJSON FeatureCollection with LineString edges
   * @param {Array} nodes - Array of node objects with coord, type, degree
   */
  setNetworkData(networkData, nodes) {
    this.networkData = networkData;
    this.networkNodes = nodes;
    this.showNetworkGraph = true;
    console.log('🔗 Network graph data set:', networkData?.features?.length, 'edges,', nodes?.length, 'nodes');
    this.scheduleRender();
  }

  /**
   * Toggle network graph visibility
   */
  setNetworkGraphVisible(visible) {
    this.showNetworkGraph = visible;
    this.scheduleRender();
  }

  /**
   * Set the visualization mode for the network graph
   * @param {string} mode - 'quality', 'centrality', or 'problems'
   */
  setNetworkVisualMode(mode) {
    this.networkVisualMode = mode;
    console.log('🎨 Network visual mode:', mode);
    this.scheduleRender();
  }

  /**
   * Set problem data for highlighting problematic nodes/edges
   * @param {Array} problems - Array of problem objects with coords, type, severity
   */
  setProblemData(problems) {
    this.problemData = problems || [];
    this.problemNodeSet.clear();
    this.problemEdgeSet.clear();

    // Build sets of problematic node/edge IDs for quick lookup
    if (problems) {
      for (const p of problems) {
        if (p.coords) {
          // Create a key from coordinates
          const key = `${p.coords[0].toFixed(5)},${p.coords[1].toFixed(5)}`;
          this.problemNodeSet.add(key);
        }
        if (p.edgeId) {
          this.problemEdgeSet.add(p.edgeId);
        }
      }
    }

    console.log('📊 Problem data set:', problems?.length, 'problems,', this.problemNodeSet.size, 'nodes flagged');
    this.scheduleRender();
  }

  /**
   * Render the network graph (edges and nodes) on the canvas
   * This draws ON TOP of the segmentation overlay for clear visibility
   * Styling changes based on networkVisualMode: 'quality', 'centrality', 'problems'
   */
  renderNetworkGraph(ctx) {
    if (!this.networkData || !this.networkData.features) {
      return;
    }

    ctx.save();

    const bounds = this.map.getBounds();
    const mode = this.networkVisualMode || 'quality';

    // Draw edges first (lines)
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const feature of this.networkData.features) {
      if (feature.geometry?.type !== 'LineString') continue;

      const coords = feature.geometry.coordinates;
      if (coords.length < 2) continue;

      // Check if any part of the line is visible in viewport
      const inView = coords.some(c =>
        c[0] >= bounds.getWest() && c[0] <= bounds.getEast() &&
        c[1] >= bounds.getSouth() && c[1] <= bounds.getNorth()
      );

      if (!inView) continue;

      // Get styling based on mode
      const edgeId = feature.properties?.id;
      const quality = feature.properties?.quality ?? 0.5;
      const isProblem = this.problemEdgeSet.has(edgeId);

      let edgeColor, edgeWidth, edgeAlpha;

      switch (mode) {
        case 'centrality':
          // Centrality mode: blue to pink gradient based on quality (proxy for centrality)
          edgeColor = this.getCentralityColor(quality);
          edgeWidth = 4;
          edgeAlpha = 1.0;
          break;

        case 'problems':
          // Problems mode: muted gray for normal, highlight problems
          if (isProblem) {
            edgeColor = '#ef4444'; // Red for problems
            edgeWidth = 5;
            edgeAlpha = 1.0;
          } else {
            edgeColor = '#64748b'; // Muted gray
            edgeWidth = 2;
            edgeAlpha = 0.4;
          }
          break;

        case 'quality':
        default:
          // Quality mode: red to cyan gradient
          edgeColor = this.getQualityColor(quality);
          edgeWidth = 4;
          edgeAlpha = 1.0;
          break;
      }

      // Convert first coordinate to screen position
      const start = this.map.project([coords[0][0], coords[0][1]]);

      // Draw edge outline (dark stroke for visibility)
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      for (let i = 1; i < coords.length; i++) {
        const pt = this.map.project([coords[i][0], coords[i][1]]);
        ctx.lineTo(pt.x, pt.y);
      }
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = edgeWidth + 3;
      ctx.globalAlpha = 0.5;
      ctx.stroke();

      // Draw main edge
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      for (let i = 1; i < coords.length; i++) {
        const pt = this.map.project([coords[i][0], coords[i][1]]);
        ctx.lineTo(pt.x, pt.y);
      }
      ctx.strokeStyle = edgeColor;
      ctx.lineWidth = edgeWidth;
      ctx.globalAlpha = edgeAlpha;
      ctx.stroke();
    }

    // Draw nodes on top of edges
    if (this.networkNodes && this.networkNodes.length > 0) {
      for (const node of this.networkNodes) {
        const [lng, lat] = node.coord;

        // Skip if outside viewport
        if (lng < bounds.getWest() || lng > bounds.getEast() ||
            lat < bounds.getSouth() || lat > bounds.getNorth()) continue;

        const pt = this.map.project([lng, lat]);

        // Check if this node is flagged as a problem
        const nodeKey = `${lng.toFixed(5)},${lat.toFixed(5)}`;
        const isProblemNode = this.problemNodeSet.has(nodeKey);

        // Get styling based on mode
        let radius, color, nodeAlpha;

        switch (mode) {
          case 'problems':
            // In problems mode, highlight problem nodes, dim others
            if (isProblemNode) {
              radius = 8;
              color = '#ef4444'; // Red for problems
              nodeAlpha = 1.0;
            } else if (node.type === 'endpoint') {
              // Always show endpoints (potential dead ends)
              radius = 5;
              color = '#f97316'; // Orange
              nodeAlpha = 0.7;
            } else {
              radius = 3;
              color = '#64748b'; // Muted
              nodeAlpha = 0.3;
            }
            break;

          case 'centrality':
          case 'quality':
          default:
            // Standard sizing by node type
            radius = node.type === 'intersection' ? 6 :
                     node.type === 'junction' ? 4 : 4;

            // Color by node type (endpoints always highlighted as potential issues)
            color = node.type === 'intersection' ? '#f59e0b' : // Amber
                    node.type === 'junction' ? '#3b82f6' :     // Blue
                    '#ef4444'; // Red for endpoints
            nodeAlpha = 1.0;
            break;
        }

        // Draw node outline
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, radius + 2, 0, Math.PI * 2);
        ctx.fillStyle = '#000000';
        ctx.globalAlpha = 0.4;
        ctx.fill();

        // Draw node fill
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.globalAlpha = nodeAlpha;
        ctx.fill();

        // Draw white stroke
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  /**
   * Get color based on quality value (0-1)
   */
  getQualityColor(quality) {
    if (quality >= 0.75) return '#06b6d4'; // Cyan - excellent
    if (quality >= 0.5) return '#10b981';  // Green - good
    if (quality >= 0.25) return '#f59e0b'; // Amber - fair
    return '#ef4444'; // Red - poor
  }

  /**
   * Get color for centrality mode (blue to pink gradient)
   */
  getCentralityColor(value) {
    if (value >= 0.75) return '#ec4899'; // Pink - high centrality
    if (value >= 0.5) return '#8b5cf6';  // Purple - medium
    if (value >= 0.25) return '#6366f1'; // Indigo
    return '#3b82f6'; // Blue - low centrality
  }

  /**
   * Render network graph derived from Mapbox vector tile features
   * This ensures the graph spans the ENTIRE visible map, not just a static GeoJSON area.
   *
   * The graph is built dynamically from road features:
   * - Edges = road line geometries
   * - Nodes = endpoints and intersections where roads meet
   *
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   * @param {Array} features - Road features from Mapbox vector tiles
   */
  renderNetworkGraphFromFeatures(ctx, features) {
    if (!features || features.length === 0) {
      return;
    }

    ctx.save();

    const mode = this.networkVisualMode || 'quality';

    // Build graph structure: extract nodes from feature endpoints
    // Use a spatial grid for efficient nearest-neighbor snapping
    // Tolerance: ~15m at NYC latitude (enough to snap road segments that meet at intersections)
    const tolerance = 0.00015; // ~15m - handles tile boundary splits and GPS precision
    const gridSize = tolerance;

    // Grid-based spatial index for snapping
    const grid = new Map(); // "gridX,gridY" -> [{ coord, degree, avgCoord: [sumLng, sumLat], count }]

    const getGridKey = (coord) => {
      const gx = Math.floor(coord[0] / gridSize);
      const gy = Math.floor(coord[1] / gridSize);
      return `${gx},${gy}`;
    };

    const getNeighborKeys = (coord) => {
      const gx = Math.floor(coord[0] / gridSize);
      const gy = Math.floor(coord[1] / gridSize);
      const keys = [];
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          keys.push(`${gx + dx},${gy + dy}`);
        }
      }
      return keys;
    };

    const distance = (c1, c2) => {
      const dlng = c1[0] - c2[0];
      const dlat = c1[1] - c2[1];
      return Math.sqrt(dlng * dlng + dlat * dlat);
    };

    // Find or create a node near this coordinate
    const findOrCreateNode = (coord) => {
      const neighborKeys = getNeighborKeys(coord);

      // Search neighbors for existing node within tolerance
      for (const key of neighborKeys) {
        const cell = grid.get(key);
        if (cell) {
          for (const node of cell) {
            if (distance(node.coord, coord) < tolerance) {
              // Found existing node - update average and increment degree
              node.avgCoord[0] += coord[0];
              node.avgCoord[1] += coord[1];
              node.count++;
              node.degree++;
              return node;
            }
          }
        }
      }

      // No existing node found - create new one
      const newNode = {
        coord: coord,
        degree: 1,
        avgCoord: [coord[0], coord[1]],
        count: 1
      };

      const gridKey = getGridKey(coord);
      if (!grid.has(gridKey)) {
        grid.set(gridKey, []);
      }
      grid.get(gridKey).push(newNode);
      return newNode;
    };

    // First pass: collect all endpoints and snap them together
    for (const feature of features) {
      const geom = feature.geometry;
      if (!geom) continue;

      let lineArrays = [];
      if (geom.type === 'LineString') {
        lineArrays = [geom.coordinates];
      } else if (geom.type === 'MultiLineString') {
        lineArrays = geom.coordinates;
      } else {
        continue;
      }

      for (const lineCoords of lineArrays) {
        if (!lineCoords || lineCoords.length < 2) continue;

        // Register start and end points
        findOrCreateNode(lineCoords[0]);
        findOrCreateNode(lineCoords[lineCoords.length - 1]);
      }
    }

    // Build final node list - compute average positions and classify
    // Also update each grid node's coord to use the averaged position
    const nodes = [];
    for (const cell of grid.values()) {
      for (const node of cell) {
        // Compute average position from all snapped endpoints
        const avgLng = node.avgCoord[0] / node.count;
        const avgLat = node.avgCoord[1] / node.count;

        // Update the node's coord to the averaged position
        // This is important for edge snapping below
        node.finalCoord = [avgLng, avgLat];

        // Classify: intersection (3+), junction (2), endpoint (1)
        const nodeType = node.degree >= 3 ? 'intersection' :
                         node.degree === 2 ? 'junction' :
                         'endpoint';

        nodes.push({
          coord: [avgLng, avgLat],
          type: nodeType,
          degree: node.degree
        });
      }
    }

    // Helper to find the snapped node position for a coordinate
    const getSnappedPosition = (coord) => {
      const neighborKeys = getNeighborKeys(coord);
      for (const key of neighborKeys) {
        const cell = grid.get(key);
        if (cell) {
          for (const node of cell) {
            if (distance(node.coord, coord) < tolerance) {
              return node.finalCoord;
            }
          }
        }
      }
      return coord; // Return original if no snap found
    };

    // Draw edges (lines) - snapping endpoints to node positions
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const feature of features) {
      const geom = feature.geometry;
      if (!geom) continue;

      let lineArrays = [];
      if (geom.type === 'LineString') {
        lineArrays = [geom.coordinates];
      } else if (geom.type === 'MultiLineString') {
        lineArrays = geom.coordinates;
      } else {
        continue;
      }

      // Generate a quality value for this feature (simulated or from properties)
      const featureId = feature.id || `f_${Math.random().toString(36).substr(2, 9)}`;
      const quality = feature.properties?.quality ?? this.getSimulatedQuality(featureId);
      const isProblem = this.problemEdgeSet.has(featureId);

      let edgeColor, edgeWidth, edgeAlpha;

      switch (mode) {
        case 'centrality':
          edgeColor = this.getCentralityColor(quality);
          edgeWidth = 4;
          edgeAlpha = 1.0;
          break;

        case 'problems':
          if (isProblem) {
            edgeColor = '#ef4444';
            edgeWidth = 5;
            edgeAlpha = 1.0;
          } else {
            edgeColor = '#64748b';
            edgeWidth = 2;
            edgeAlpha = 0.4;
          }
          break;

        case 'quality':
        default:
          edgeColor = this.getQualityColor(quality);
          edgeWidth = 4;
          edgeAlpha = 1.0;
          break;
      }

      for (const coords of lineArrays) {
        if (!coords || coords.length < 2) continue;

        // Snap start and end points to their node positions
        const snappedStart = getSnappedPosition(coords[0]);
        const snappedEnd = getSnappedPosition(coords[coords.length - 1]);

        // Build the path: snapped start -> middle points -> snapped end
        const start = this.map.project([snappedStart[0], snappedStart[1]]);

        // Draw edge outline (dark stroke for visibility)
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        // Draw through middle points (not snapped - they're part of the road geometry)
        for (let i = 1; i < coords.length - 1; i++) {
          const pt = this.map.project([coords[i][0], coords[i][1]]);
          ctx.lineTo(pt.x, pt.y);
        }
        // End at snapped position
        const end = this.map.project([snappedEnd[0], snappedEnd[1]]);
        ctx.lineTo(end.x, end.y);
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = edgeWidth + 3;
        ctx.globalAlpha = 0.5;
        ctx.stroke();

        // Draw main edge
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        for (let i = 1; i < coords.length - 1; i++) {
          const pt = this.map.project([coords[i][0], coords[i][1]]);
          ctx.lineTo(pt.x, pt.y);
        }
        ctx.lineTo(end.x, end.y);
        ctx.strokeStyle = edgeColor;
        ctx.lineWidth = edgeWidth;
        ctx.globalAlpha = edgeAlpha;
        ctx.stroke();
      }
    }

    // Draw nodes on top of edges
    for (const node of nodes) {
      const [lng, lat] = node.coord;
      const pt = this.map.project([lng, lat]);

      // Check if this node is flagged as a problem
      const nodeKey = `${lng.toFixed(5)},${lat.toFixed(5)}`;
      const isProblemNode = this.problemNodeSet.has(nodeKey);

      let radius, color, nodeAlpha;

      switch (mode) {
        case 'problems':
          if (isProblemNode) {
            radius = 8;
            color = '#ef4444';
            nodeAlpha = 1.0;
          } else if (node.type === 'endpoint') {
            radius = 5;
            color = '#f97316';
            nodeAlpha = 0.7;
          } else {
            radius = 3;
            color = '#64748b';
            nodeAlpha = 0.3;
          }
          break;

        case 'centrality':
        case 'quality':
        default:
          radius = node.type === 'intersection' ? 6 :
                   node.type === 'junction' ? 4 : 4;
          color = node.type === 'intersection' ? '#f59e0b' :
                  node.type === 'junction' ? '#3b82f6' :
                  '#ef4444';
          nodeAlpha = 1.0;
          break;
      }

      // Draw node outline
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, radius + 2, 0, Math.PI * 2);
      ctx.fillStyle = '#000000';
      ctx.globalAlpha = 0.4;
      ctx.fill();

      // Draw node fill
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.globalAlpha = nodeAlpha;
      ctx.fill();

      // Draw white stroke
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * Get simulated quality value for a feature (cached for consistency)
   */
  getSimulatedQuality(featureId) {
    if (!this._qualityCache) {
      this._qualityCache = new Map();
    }
    if (!this._qualityCache.has(featureId)) {
      // Generate a random quality value with realistic distribution
      const rand = Math.random();
      let quality;
      if (rand < 0.6) {
        quality = 0.75 + Math.random() * 0.25; // High: 60% of segments
      } else if (rand < 0.85) {
        quality = 0.5 + Math.random() * 0.25;  // Medium: 25%
      } else {
        quality = 0.2 + Math.random() * 0.3;   // Low: 15%
      }
      this._qualityCache.set(featureId, quality);
    }
    return this._qualityCache.get(featureId);
  }

  /**
   * ORIGINAL MODE: Shows only the base map with no overlays
   * Just displays a subtle label indicating the mode
   */
  renderOriginalMode(ctx) {
    // Draw a subtle mode indicator
    ctx.save();
    ctx.globalAlpha = 0.85;

    ctx.font = 'bold 14px sans-serif';
    const text = 'ORIGINAL IMAGERY';
    const textWidth = ctx.measureText(text).width;

    const x = 20;
    const y = 20;

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(x, y, textWidth + 20, 28);

    // Border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, textWidth + 20, 28);

    // Text
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 10, y + 14);

    ctx.restore();
  }

  /**
   * Assign simulated confidence values to features
   * In production, these would come from tile2net segmentation output
   */
  assignFeatureConfidence(features) {
    for (const feature of features) {
      const id = feature.id || `${feature.geometry?.coordinates?.[0]?.[0]}_${feature.geometry?.coordinates?.[0]?.[1]}`;
      if (!this.featureConfidence.has(id)) {
        // Simulate confidence: most features have high confidence (0.7-1.0)
        // Some features have medium (0.4-0.7) or low (<0.4) confidence
        const rand = Math.random();
        let confidence;
        if (rand < 0.7) {
          confidence = 0.75 + Math.random() * 0.25; // High: 0.75-1.0
        } else if (rand < 0.9) {
          confidence = 0.45 + Math.random() * 0.3;  // Medium: 0.45-0.75
        } else {
          confidence = 0.15 + Math.random() * 0.3;  // Low: 0.15-0.45
        }
        this.featureConfidence.set(id, confidence);
      }
    }
  }

  /**
   * Get confidence for a feature
   */
  getFeatureConfidence(feature) {
    const id = feature.id || `${feature.geometry?.coordinates?.[0]?.[0]}_${feature.geometry?.coordinates?.[0]?.[1]}`;
    return this.featureConfidence.get(id) || 0.5;
  }

  /**
   * Check if feature passes confidence filter
   */
  passesConfidenceFilter(feature) {
    const confidence = this.getFeatureConfidence(feature);
    return confidence >= this.confidenceRange.min && confidence <= this.confidenceRange.max;
  }

  /**
   * CONFIDENCE MODE: Shows per-feature confidence as a heatmap
   * Red = low confidence, Yellow = medium, Green = high confidence
   */
  renderConfidenceMode(ctx, features) {
    // Draw mode label
    this.drawModeLabel(ctx, 'CONFIDENCE MAP', { r: 100, g: 200, b: 255 });

    // Draw features colored by confidence
    for (const feature of features) {
      if (!this.passesConfidenceFilter(feature)) continue;

      const confidence = this.getFeatureConfidence(feature);
      const roadClass = feature.properties?.class || 'default';
      const roadWidth = this.getRoadWidthPixels(roadClass);

      const screenCoordsList = this.getScreenCoords(feature.geometry);
      if (!screenCoordsList) continue;

      // Color based on confidence: red (low) -> yellow (medium) -> green (high)
      const color = this.getConfidenceColor(confidence);

      for (const screenCoords of screenCoordsList) {
        // Draw outline
        this.drawPath(ctx, screenCoords, { r: 30, g: 30, b: 30 }, roadWidth + 3, 0.5, false);
        // Draw confidence-colored fill
        this.drawPath(ctx, screenCoords, color, roadWidth, 0.9, false);
      }
    }

    // Draw confidence legend
    this.drawConfidenceLegend(ctx);

    // Draw crosswalks with confidence coloring
    this.renderCrosswalksWithConfidence(ctx, features);
  }

  /**
   * Get color based on confidence value (0-1)
   * Low (red) -> Medium (yellow) -> High (green)
   */
  getConfidenceColor(confidence) {
    if (confidence < 0.4) {
      // Low confidence: Red to Orange
      const t = confidence / 0.4;
      return {
        r: Math.round(239 + (251 - 239) * t),
        g: Math.round(68 + (191 - 68) * t),
        b: Math.round(68 + (36 - 68) * t)
      };
    } else if (confidence < 0.7) {
      // Medium confidence: Orange to Yellow
      const t = (confidence - 0.4) / 0.3;
      return {
        r: Math.round(251 - (251 - 200) * t),
        g: Math.round(191 + (220 - 191) * t),
        b: Math.round(36 + (50 - 36) * t)
      };
    } else {
      // High confidence: Yellow to Green
      const t = (confidence - 0.7) / 0.3;
      return {
        r: Math.round(200 - (200 - 45) * t),
        g: Math.round(220 - (220 - 212) * t),
        b: Math.round(50 + (191 - 50) * t)
      };
    }
  }

  /**
   * Draw confidence legend
   */
  drawConfidenceLegend(ctx) {
    const legendX = 20;
    const legendY = 60;
    const legendWidth = 180;
    const legendHeight = 80;

    ctx.save();
    ctx.globalAlpha = 0.95;

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(legendX, legendY, legendWidth, legendHeight);

    // Border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(legendX, legendY, legendWidth, legendHeight);

    // Title
    ctx.font = 'bold 12px sans-serif';
    ctx.fillStyle = 'white';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('Prediction Confidence', legendX + 10, legendY + 14);

    // Gradient bar
    const gradX = legendX + 10;
    const gradY = legendY + 30;
    const gradWidth = legendWidth - 20;
    const gradHeight = 16;

    const gradient = ctx.createLinearGradient(gradX, 0, gradX + gradWidth, 0);
    gradient.addColorStop(0, 'rgb(239, 68, 68)');     // Low - Red
    gradient.addColorStop(0.4, 'rgb(251, 191, 36)');  // Medium - Orange/Yellow
    gradient.addColorStop(0.7, 'rgb(200, 220, 50)');  // Medium-High - Yellow-Green
    gradient.addColorStop(1, 'rgb(45, 212, 191)');    // High - Teal

    ctx.fillStyle = gradient;
    ctx.fillRect(gradX, gradY, gradWidth, gradHeight);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.strokeRect(gradX, gradY, gradWidth, gradHeight);

    // Labels
    ctx.font = '10px sans-serif';
    ctx.fillStyle = 'white';
    ctx.textAlign = 'left';
    ctx.fillText('Low (0%)', gradX, gradY + gradHeight + 14);
    ctx.textAlign = 'center';
    ctx.fillText('50%', gradX + gradWidth / 2, gradY + gradHeight + 14);
    ctx.textAlign = 'right';
    ctx.fillText('High (100%)', gradX + gradWidth, gradY + gradHeight + 14);

    ctx.restore();
  }

  /**
   * Render crosswalks colored by confidence
   * Uses SCREEN-SPACE directions for proper alignment with map rotation
   */
  renderCrosswalksWithConfidence(ctx, features) {
    const endpointMap = new Map();

    // Helper to calculate SCREEN-SPACE direction
    const getScreenDirection = (fromGeo, toGeo) => {
      const fromScreen = this.map.project([fromGeo[0], fromGeo[1]]);
      const toScreen = this.map.project([toGeo[0], toGeo[1]]);
      return Math.atan2(toScreen.y - fromScreen.y, toScreen.x - fromScreen.x);
    };

    for (const feature of features) {
      if (!this.passesConfidenceFilter(feature)) continue;
      if (feature.geometry?.type !== 'LineString') continue;

      const coords = feature.geometry.coordinates;
      if (coords.length < 2) continue;

      // Helper to register endpoint with screen-space direction
      const registerEndpoint = (coord, nextCoord) => {
        const key = `${coord[0].toFixed(4)},${coord[1].toFixed(4)}`;
        if (!endpointMap.has(key)) {
          endpointMap.set(key, { count: 0, coord: coord, screenDirections: [], confidence: 0 });
        }
        const data = endpointMap.get(key);
        data.count++;
        data.confidence = Math.max(data.confidence, this.getFeatureConfidence(feature));
        data.screenDirections.push(getScreenDirection(coord, nextCoord));
      };

      registerEndpoint(coords[0], coords[1]);
      registerEndpoint(coords[coords.length - 1], coords[coords.length - 2]);
    }

    const crosswalkWidth = Math.max(14, this.metersToPixels(7));
    const crosswalkLength = Math.max(20, this.metersToPixels(10));
    const stripeCount = 4;
    const stripeWidth = crosswalkLength / (stripeCount * 2 - 1);

    for (const [key, data] of endpointMap) {
      if (data.count >= 2 && data.screenDirections.length >= 1) {
        const screenPoint = this.map.project([data.coord[0], data.coord[1]]);
        const color = this.getConfidenceColor(data.confidence);

        // Deduplicate directions (in screen space)
        const uniqueDirections = [];
        for (const dir of data.screenDirections) {
          let isDuplicate = false;
          for (const uDir of uniqueDirections) {
            let diff = Math.abs(dir - uDir);
            diff = Math.min(diff, Math.PI * 2 - diff);
            if (diff < Math.PI / 9) { // 20 degrees
              isDuplicate = true;
              break;
            }
          }
          if (!isDuplicate) uniqueDirections.push(dir);
        }

        // Draw crosswalks for each direction
        for (let i = 0; i < Math.min(uniqueDirections.length, 4); i++) {
          const roadAngle = uniqueDirections[i];
          const crosswalkAngle = roadAngle + Math.PI / 2;

          const offsetDist = this.metersToPixels(6);
          const cx = screenPoint.x + Math.cos(roadAngle) * offsetDist;
          const cy = screenPoint.y + Math.sin(roadAngle) * offsetDist;

          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(crosswalkAngle);

          // Draw crosswalk
          ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, 0.85)`;
          ctx.fillRect(-crosswalkLength / 2, -crosswalkWidth / 2, crosswalkLength, crosswalkWidth);

          // Draw stripes
          ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
          for (let s = 0; s < stripeCount; s++) {
            const stripeX = -crosswalkLength / 2 + s * stripeWidth * 2;
            ctx.fillRect(stripeX, -crosswalkWidth / 2, stripeWidth, crosswalkWidth);
          }

          ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
          ctx.lineWidth = 1;
          ctx.strokeRect(-crosswalkLength / 2, -crosswalkWidth / 2, crosswalkLength, crosswalkWidth);

          ctx.restore();
        }

        // Draw intersection marker with confidence percentage
        if (uniqueDirections.length >= 2) {
          const markerSize = Math.max(12, this.metersToPixels(5));

          ctx.beginPath();
          ctx.arc(screenPoint.x, screenPoint.y, markerSize, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, 0.9)`;
          ctx.fill();
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
          ctx.lineWidth = 2;
          ctx.stroke();

          // Draw confidence value
          ctx.font = 'bold 9px sans-serif';
          ctx.fillStyle = 'white';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(Math.round(data.confidence * 100) + '%', screenPoint.x, screenPoint.y);
        }
      }
    }
  }

  /**
   * Render segmentation mode (prediction or ground truth)
   *
   * PREDICTION MODE:
   *   - ROADS = GREEN (solid), SIDEWALKS = BLUE (solid), CROSSWALKS = RED (solid)
   *
   * GROUND TRUTH MODE:
   *   - ROADS = ORANGE (dashed), SIDEWALKS = PURPLE (dashed), CROSSWALKS = MAGENTA (dashed)
   *   - Additional "GT" label indicators
   */
  renderSegmentationMode(ctx, features) {
    const isGroundTruth = this.displayMode === 'groundTruth';
    const colors = isGroundTruth ? this.gtColors : this.classColors;
    const dashed = isGroundTruth;

    // Draw mode indicator label
    if (isGroundTruth) {
      this.drawModeLabel(ctx, 'GROUND TRUTH', { r: 255, g: 152, b: 0 });
    }

    // PASS 1: Draw ROADS
    if (this.classVisibility.road) {
      for (const feature of features) {
        const roadClass = feature.properties?.class || 'default';
        const roadWidth = this.getRoadWidthPixels(roadClass);

        const screenCoordsList = this.getScreenCoords(feature.geometry);
        if (!screenCoordsList) continue;

        for (const screenCoords of screenCoordsList) {
          if (isGroundTruth) {
            // Ground truth: darker outline, dashed orange fill
            this.drawPath(ctx, screenCoords, { r: 100, g: 60, b: 0 }, roadWidth + 4, 0.5, false);
            this.drawPath(ctx, screenCoords, colors.road, roadWidth, 0.85, true);
            // Add diamond pattern markers for GT
            this.drawGTMarkers(ctx, screenCoords, colors.road);
          } else {
            // Prediction: dark green outline, solid green fill
            this.drawPath(ctx, screenCoords, { r: 30, g: 60, b: 30 }, roadWidth + 4, 0.6, false);
            this.drawPath(ctx, screenCoords, colors.road, roadWidth, 0.9, false);
            // Add center line for definition
            if (roadWidth > 8) {
              this.drawPath(ctx, screenCoords, { r: 150, g: 220, b: 150 }, 2, 0.5, true);
            }
          }
        }
      }
    }

    // PASS 2: Draw SIDEWALKS
    if (this.classVisibility.sidewalk) {
      const sidewalkWidth = Math.max(4, this.metersToPixels(this.sidewalkWidthMeters));

      for (const feature of features) {
        const roadClass = feature.properties?.class || 'default';
        const roadWidthM = this.roadWidthMeters[roadClass] || this.roadWidthMeters['default'];
        const offsetPixels = this.metersToPixels(roadWidthM / 2 + this.sidewalkGapMeters * 2 + this.sidewalkWidthMeters / 2);

        const screenCoordsList = this.getScreenCoords(feature.geometry);
        if (!screenCoordsList) continue;

        for (const screenCoords of screenCoordsList) {
          // Left sidewalk
          const leftSidewalk = this.computeOffsetLine(screenCoords, offsetPixels, 'left');
          if (isGroundTruth) {
            this.drawPath(ctx, leftSidewalk, { r: 60, g: 15, b: 70 }, sidewalkWidth + 3, 0.4, false);
            this.drawPath(ctx, leftSidewalk, colors.sidewalk, sidewalkWidth, 0.8, true);
          } else {
            this.drawPath(ctx, leftSidewalk, { r: 15, g: 60, b: 100 }, sidewalkWidth + 3, 0.5, false);
            this.drawPath(ctx, leftSidewalk, colors.sidewalk, sidewalkWidth, 0.85, false);
            this.drawPath(ctx, leftSidewalk, { r: 144, g: 202, b: 249 }, 1, 0.7, false);
          }

          // Right sidewalk
          const rightSidewalk = this.computeOffsetLine(screenCoords, offsetPixels, 'right');
          if (isGroundTruth) {
            this.drawPath(ctx, rightSidewalk, { r: 60, g: 15, b: 70 }, sidewalkWidth + 3, 0.4, false);
            this.drawPath(ctx, rightSidewalk, colors.sidewalk, sidewalkWidth, 0.8, true);
          } else {
            this.drawPath(ctx, rightSidewalk, { r: 15, g: 60, b: 100 }, sidewalkWidth + 3, 0.5, false);
            this.drawPath(ctx, rightSidewalk, colors.sidewalk, sidewalkWidth, 0.85, false);
            this.drawPath(ctx, rightSidewalk, { r: 144, g: 202, b: 249 }, 1, 0.7, false);
          }
        }
      }
    }

    // PASS 3: Draw CROSSWALKS - at intersections
    if (this.classVisibility.crosswalk) {
      this.renderCrosswalks(ctx, features, colors.crosswalk, dashed);
    }
  }

  /**
   * Draw a mode label in the corner of the canvas
   */
  drawModeLabel(ctx, text, color) {
    ctx.save();
    ctx.globalAlpha = 0.9;

    ctx.font = 'bold 14px sans-serif';
    const textWidth = ctx.measureText(text).width;

    const x = 20;
    const y = 20;

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(x, y, textWidth + 20, 28);

    // Border in mode color
    ctx.strokeStyle = `rgb(${color.r}, ${color.g}, ${color.b})`;
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, textWidth + 20, 28);

    // Text
    ctx.fillStyle = `rgb(${color.r}, ${color.g}, ${color.b})`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 10, y + 14);

    ctx.restore();
  }

  /**
   * Draw ground truth markers (diamonds) along a path
   */
  drawGTMarkers(ctx, coords, color) {
    if (!coords || coords.length < 2) return;

    // Calculate total path length
    let totalLength = 0;
    for (let i = 1; i < coords.length; i++) {
      const dx = coords[i][0] - coords[i-1][0];
      const dy = coords[i][1] - coords[i-1][1];
      totalLength += Math.sqrt(dx * dx + dy * dy);
    }

    // Draw markers every 80 pixels
    const markerSpacing = 80;
    const numMarkers = Math.floor(totalLength / markerSpacing);

    if (numMarkers < 1) return;

    for (let m = 1; m <= numMarkers; m++) {
      const targetDist = m * markerSpacing;
      let cumDist = 0;

      for (let i = 1; i < coords.length; i++) {
        const dx = coords[i][0] - coords[i-1][0];
        const dy = coords[i][1] - coords[i-1][1];
        const segLen = Math.sqrt(dx * dx + dy * dy);

        if (cumDist + segLen >= targetDist) {
          const t = (targetDist - cumDist) / segLen;
          const x = coords[i-1][0] + dx * t;
          const y = coords[i-1][1] + dy * t;

          // Draw diamond marker
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(Math.PI / 4);

          ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, 0.8)`;
          ctx.fillRect(-5, -5, 10, 10);

          ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(-5, -5, 10, 10);

          ctx.restore();
          break;
        }
        cumDist += segLen;
      }
    }
  }

  /**
   * Render crosswalks at intersections - HIGHLY VISIBLE in RED
   * Uses filled rectangles with white stripes for zebra crossing effect
   *
   * CROSSWALK ALIGNMENT REQUIREMENTS:
   * 1. Crosswalks are ALWAYS drawn at every intersection (2+ roads meeting)
   * 2. Crosswalks are PERPENDICULAR to the road direction they cross
   * 3. Crosswalks rotate correctly when the map bearing changes
   * 4. Each road approach at an intersection gets a crosswalk
   * 5. Alignment matches underlying street geometry
   */
  renderCrosswalks(ctx, features, color, dashed = false) {
    // Get map bearing for angle transformation
    // When the map is rotated, we need to transform geographic angles to screen angles
    const mapBearing = this.map.getBearing() * Math.PI / 180;

    // Find intersection points by analyzing line endpoints
    // Key by screen coordinates (rounded) for more accurate intersection detection
    const endpointMap = new Map();

    for (const feature of features) {
      if (feature.geometry?.type !== 'LineString') continue;

      const coords = feature.geometry.coordinates;
      if (coords.length < 2) continue;

      // Helper to calculate SCREEN-SPACE direction between two geographic points
      const getScreenDirection = (fromGeo, toGeo) => {
        const fromScreen = this.map.project([fromGeo[0], fromGeo[1]]);
        const toScreen = this.map.project([toGeo[0], toGeo[1]]);
        return Math.atan2(toScreen.y - fromScreen.y, toScreen.x - fromScreen.x);
      };

      // Helper to register an endpoint with screen-space direction
      const registerEndpoint = (coord, nextCoord) => {
        // Use geographic key for grouping
        const key = `${coord[0].toFixed(4)},${coord[1].toFixed(4)}`;

        if (!endpointMap.has(key)) {
          endpointMap.set(key, {
            count: 0,
            coord: coord,
            screenDirections: [], // Store screen-space directions
            roadClasses: []
          });
        }

        const data = endpointMap.get(key);
        data.count++;

        // Calculate direction in SCREEN SPACE (already accounts for map rotation)
        const screenAngle = getScreenDirection(coord, nextCoord);
        data.screenDirections.push(screenAngle);

        // Store road class for width calculation
        const roadClass = feature.properties?.class || 'default';
        data.roadClasses.push(roadClass);
      };

      // Register start endpoint
      registerEndpoint(coords[0], coords[1]);

      // Register end endpoint (direction points away from intersection)
      const endCoord = coords[coords.length - 1];
      const prevCoord = coords[coords.length - 2];
      registerEndpoint(endCoord, prevCoord);
    }

    // Draw LARGE, VISIBLE crosswalks at intersections
    // Size is based on road width - crosswalk spans the full road width
    const baseWidth = Math.max(14, this.metersToPixels(7));   // Width across the road
    const baseLength = Math.max(20, this.metersToPixels(10)); // Length along crossing direction
    const stripeCount = 5;

    for (const [key, data] of endpointMap) {
      // Draw crosswalk at intersections (2+ roads meeting)
      if (data.count >= 2 && data.screenDirections.length >= 1) {
        // Get screen position from geographic coordinates
        const screenPoint = this.map.project([data.coord[0], data.coord[1]]);

        // Deduplicate similar directions (within 20 degrees)
        const uniqueDirections = [];
        for (const dir of data.screenDirections) {
          let isDuplicate = false;
          for (const uDir of uniqueDirections) {
            let diff = Math.abs(dir - uDir);
            // Normalize to [0, PI] since opposite directions are similar
            diff = Math.min(diff, Math.PI * 2 - diff);
            if (diff < Math.PI / 9) { // 20 degrees tolerance
              isDuplicate = true;
              break;
            }
          }
          if (!isDuplicate) {
            uniqueDirections.push(dir);
          }
        }

        // Draw crosswalk for each unique road direction at this intersection
        for (let i = 0; i < Math.min(uniqueDirections.length, 4); i++) {
          // Get the screen-space road direction
          const roadAngle = uniqueDirections[i];

          // Crosswalk is PERPENDICULAR to road (add 90 degrees)
          // This is already in screen space, so rotation is automatic
          const crosswalkAngle = roadAngle + Math.PI / 2;

          // Scale width based on road class
          const roadClass = data.roadClasses[i % data.roadClasses.length] || 'default';
          const roadWidthM = this.roadWidthMeters[roadClass] || this.roadWidthMeters['default'];
          const crosswalkWidth = Math.max(baseWidth, this.metersToPixels(roadWidthM * 0.7));
          const crosswalkLength = baseLength;
          const stripeWidth = crosswalkLength / (stripeCount * 2 - 1);

          // Position crosswalk offset from intersection center along the road
          const offsetDist = this.metersToPixels(roadWidthM * 1.2);
          const cx = screenPoint.x + Math.cos(roadAngle) * offsetDist;
          const cy = screenPoint.y + Math.sin(roadAngle) * offsetDist;

          ctx.save();
          ctx.translate(cx, cy);
          // Rotate to crosswalk angle (perpendicular to road, in screen space)
          ctx.rotate(crosswalkAngle);

          // Draw shadow for depth
          ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
          ctx.fillRect(-crosswalkLength / 2 + 2, -crosswalkWidth / 2 + 2, crosswalkLength, crosswalkWidth);

          // Draw background rectangle (the colored base)
          ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, 0.9)`;
          ctx.fillRect(-crosswalkLength / 2, -crosswalkWidth / 2, crosswalkLength, crosswalkWidth);

          // Draw white zebra stripes
          ctx.fillStyle = dashed ? 'rgba(255, 255, 255, 0.5)' : 'rgba(255, 255, 255, 0.95)';
          for (let s = 0; s < stripeCount; s++) {
            const stripeX = -crosswalkLength / 2 + s * stripeWidth * 2;
            ctx.fillRect(stripeX, -crosswalkWidth / 2, stripeWidth, crosswalkWidth);
          }

          // Draw border for better visibility
          ctx.strokeStyle = `rgba(${Math.floor(color.r * 0.6)}, ${Math.floor(color.g * 0.6)}, ${Math.floor(color.b * 0.6)}, 1)`;
          ctx.lineWidth = 2;
          if (dashed) {
            ctx.setLineDash([6, 4]);
          }
          ctx.strokeRect(-crosswalkLength / 2, -crosswalkWidth / 2, crosswalkLength, crosswalkWidth);
          ctx.setLineDash([]);

          ctx.restore();
        }

        // Draw intersection marker (circle at the center)
        // Only for true intersections (multiple unique directions)
        if (uniqueDirections.length >= 2) {
          const markerSize = Math.max(8, this.metersToPixels(4));

          ctx.beginPath();
          ctx.arc(screenPoint.x, screenPoint.y, markerSize, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, 0.85)`;
          ctx.fill();
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
          ctx.lineWidth = 2;
          ctx.stroke();

          // Add inner dot for better visibility
          ctx.beginPath();
          ctx.arc(screenPoint.x, screenPoint.y, markerSize * 0.4, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
          ctx.fill();
        }
      }
    }
  }

  /**
   * Render error mode - FP/FN/TP visualization with GEOREFERENCED regions
   * Shows a meaningful comparison between prediction and ground truth
   *
   * Visual encoding:
   * - TEAL (TP): Model correctly predicted infrastructure that exists
   * - RED (FP): Model predicted infrastructure that doesn't exist (over-prediction)
   * - AMBER (FN): Model missed infrastructure that does exist (under-prediction)
   */
  renderErrorMode(ctx, features) {
    // FIRST: Draw GEOREFERENCED error zone polygons (these MOVE with the map)
    // APPLY ERROR TYPE FILTERS - only draw regions whose type is visible
    for (const region of this.geoErrorRegions) {
      // Check if this error type is visible based on filters
      if (region.type === 'fp' && !this.errorTypeVisibility.falsePositive) continue;
      if (region.type === 'fn' && !this.errorTypeVisibility.falseNegative) continue;

      const fillColor = region.type === 'fp'
        ? this.errorColors.falsePositive
        : this.errorColors.falseNegative;

      // Draw zone polygon with thicker, more visible border
      this.drawGeoPolygon(ctx, region.polygon, fillColor, fillColor, 0.2);
    }

    // Draw labels only for major zones (skip small spots to reduce clutter)
    // Also apply error type filters
    for (const region of this.geoErrorRegions) {
      if (!region.label || region.label.includes('Spot')) continue; // Skip small spots
      if (region.type === 'fp' && !this.errorTypeVisibility.falsePositive) continue;
      if (region.type === 'fn' && !this.errorTypeVisibility.falseNegative) continue;

      let sumLng = 0, sumLat = 0;
      for (const coord of region.polygon) {
        sumLng += coord[0];
        sumLat += coord[1];
      }
      const centerLng = sumLng / region.polygon.length;
      const centerLat = sumLat / region.polygon.length;

      const color = region.type === 'fp'
        ? this.errorColors.falsePositive
        : this.errorColors.falseNegative;

      this.drawGeoLabel(ctx, [centerLng, centerLat], region.label, color);
    }

    // SECOND: Draw streets with error-based coloring and styling
    // APPLY ERROR TYPE FILTERS - skip types that are not visible
    // TP streets: solid teal with glow effect
    // FP streets: dashed red (predicted but shouldn't be)
    // FN streets: dotted amber outline (should exist but missing prediction)
    for (const feature of features) {
      // Also apply confidence filter in error mode
      if (!this.passesConfidenceFilter(feature)) continue;

      const roadClass = feature.properties?.class || 'default';
      const roadWidth = this.getRoadWidthPixels(roadClass);
      const centerCoord = this.getFeatureCenterGeo(feature);
      const errorType = this.getErrorTypeForCoord(centerCoord);

      // Check error type visibility filter
      if (errorType === 'fp' && !this.errorTypeVisibility.falsePositive) continue;
      if (errorType === 'fn' && !this.errorTypeVisibility.falseNegative) continue;
      if (errorType === 'tp' && !this.errorTypeVisibility.truePositive) continue;

      const screenCoordsList = this.getScreenCoords(feature.geometry);
      if (!screenCoordsList) continue;

      for (const screenCoords of screenCoordsList) {
        switch (errorType) {
          case 'fp':
            // FALSE POSITIVE: Model predicted this, but it doesn't exist
            // Draw with dashed red style to show "ghost" prediction
            this.drawPath(ctx, screenCoords, { r: 80, g: 20, b: 20 }, roadWidth + 4, 0.4, false);
            this.drawPath(ctx, screenCoords, this.errorColors.falsePositive, roadWidth, 0.9, true);
            // Add X markers along the path to indicate "shouldn't be here"
            this.drawErrorMarkers(ctx, screenCoords, 'fp');
            break;

          case 'fn':
            // FALSE NEGATIVE: This exists but model missed it
            // Draw with amber dotted outline to show "missing" prediction
            this.drawPath(ctx, screenCoords, this.errorColors.falseNegative, roadWidth + 2, 0.5, true);
            // Draw a lighter interior to show ground truth
            this.drawPath(ctx, screenCoords, { r: 253, g: 230, b: 138 }, roadWidth - 2, 0.6, false);
            // Add question marks to indicate "model missed this"
            this.drawErrorMarkers(ctx, screenCoords, 'fn');
            break;

          default:
            // TRUE POSITIVE: Correct prediction
            // Draw with solid teal and subtle glow
            this.drawPath(ctx, screenCoords, { r: 20, g: 80, b: 70 }, roadWidth + 4, 0.4, false);
            this.drawPath(ctx, screenCoords, this.errorColors.truePositive, roadWidth, 0.9, false);
            // Add checkmark indicators
            this.drawErrorMarkers(ctx, screenCoords, 'tp');
        }
      }
    }

    // THIRD: Draw crosswalks with error coloring
    this.renderCrosswalksWithErrors(ctx, features);

    // FOURTH: Draw a legend overlay for error mode
    this.drawErrorLegend(ctx);
  }

  /**
   * Draw error markers along a path (X for FP, ? for FN, ✓ for TP)
   */
  drawErrorMarkers(ctx, coords, errorType) {
    if (!coords || coords.length < 2) return;

    // Calculate total path length
    let totalLength = 0;
    for (let i = 1; i < coords.length; i++) {
      const dx = coords[i][0] - coords[i-1][0];
      const dy = coords[i][1] - coords[i-1][1];
      totalLength += Math.sqrt(dx * dx + dy * dy);
    }

    // Only draw markers on longer segments
    if (totalLength < 100) return;

    // Find midpoint
    let targetDist = totalLength / 2;
    let cumDist = 0;

    for (let i = 1; i < coords.length; i++) {
      const dx = coords[i][0] - coords[i-1][0];
      const dy = coords[i][1] - coords[i-1][1];
      const segLen = Math.sqrt(dx * dx + dy * dy);

      if (cumDist + segLen >= targetDist) {
        const t = (targetDist - cumDist) / segLen;
        const x = coords[i-1][0] + dx * t;
        const y = coords[i-1][1] + dy * t;

        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        let symbol, bgColor, fgColor;
        switch (errorType) {
          case 'fp':
            symbol = '✗';
            bgColor = 'rgba(239, 68, 68, 0.9)';
            fgColor = 'white';
            break;
          case 'fn':
            symbol = '?';
            bgColor = 'rgba(251, 191, 36, 0.9)';
            fgColor = 'black';
            break;
          default:
            symbol = '✓';
            bgColor = 'rgba(45, 212, 191, 0.9)';
            fgColor = 'black';
        }

        // Draw background circle
        ctx.beginPath();
        ctx.arc(x, y, 10, 0, Math.PI * 2);
        ctx.fillStyle = bgColor;
        ctx.fill();
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Draw symbol
        ctx.fillStyle = fgColor;
        ctx.fillText(symbol, x, y);

        break;
      }
      cumDist += segLen;
    }
  }

  /**
   * Draw an in-canvas legend for error mode
   */
  drawErrorLegend(ctx) {
    const legendX = 20;
    const legendY = 20;
    const itemHeight = 24;
    const boxSize = 16;

    ctx.save();
    ctx.globalAlpha = 0.95;

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(legendX, legendY, 180, itemHeight * 4 + 20);

    // Border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(legendX, legendY, 180, itemHeight * 4 + 20);

    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    // Title
    ctx.fillStyle = 'white';
    ctx.fillText('Error Analysis', legendX + 10, legendY + 14);

    // TP
    let y = legendY + 38;
    ctx.fillStyle = `rgb(${this.errorColors.truePositive.r}, ${this.errorColors.truePositive.g}, ${this.errorColors.truePositive.b})`;
    ctx.fillRect(legendX + 10, y - boxSize/2, boxSize, boxSize);
    ctx.fillStyle = 'white';
    ctx.font = '11px sans-serif';
    ctx.fillText('True Positive (✓)', legendX + 32, y);

    // FP
    y += itemHeight;
    ctx.fillStyle = `rgb(${this.errorColors.falsePositive.r}, ${this.errorColors.falsePositive.g}, ${this.errorColors.falsePositive.b})`;
    ctx.fillRect(legendX + 10, y - boxSize/2, boxSize, boxSize);
    ctx.fillStyle = 'white';
    ctx.fillText('False Positive (✗)', legendX + 32, y);

    // FN
    y += itemHeight;
    ctx.fillStyle = `rgb(${this.errorColors.falseNegative.r}, ${this.errorColors.falseNegative.g}, ${this.errorColors.falseNegative.b})`;
    ctx.fillRect(legendX + 10, y - boxSize/2, boxSize, boxSize);
    ctx.fillStyle = 'white';
    ctx.fillText('False Negative (?)', legendX + 32, y);

    ctx.restore();
  }

  /**
   * Render crosswalks with error coloring - LARGE and VISIBLE
   * Properly aligned and rotated with map bearing
   */
  renderCrosswalksWithErrors(ctx, features) {
    const endpointMap = new Map();

    // Helper to calculate SCREEN-SPACE direction between two geographic points
    // This ensures proper alignment regardless of map rotation/bearing
    const getScreenDirection = (fromGeo, toGeo) => {
      const fromScreen = this.map.project([fromGeo[0], fromGeo[1]]);
      const toScreen = this.map.project([toGeo[0], toGeo[1]]);
      return Math.atan2(toScreen.y - fromScreen.y, toScreen.x - fromScreen.x);
    };

    for (const feature of features) {
      if (feature.geometry?.type !== 'LineString') continue;

      const coords = feature.geometry.coordinates;
      if (coords.length < 2) continue;

      // Helper to register endpoint with screen-space direction
      const registerEndpoint = (coord, nextCoord) => {
        const key = `${coord[0].toFixed(4)},${coord[1].toFixed(4)}`;
        if (!endpointMap.has(key)) {
          endpointMap.set(key, { count: 0, coord: coord, screenDirections: [] });
        }
        const data = endpointMap.get(key);
        data.count++;

        // Use screen-space direction for proper rotation alignment
        const screenAngle = getScreenDirection(coord, nextCoord);
        data.screenDirections.push(screenAngle);
      };

      registerEndpoint(coords[0], coords[1]);
      registerEndpoint(coords[coords.length - 1], coords[coords.length - 2]);
    }

    const crosswalkWidth = Math.max(16, this.metersToPixels(8));
    const crosswalkLength = Math.max(24, this.metersToPixels(12));
    const stripeCount = 5;
    const stripeWidth = crosswalkLength / (stripeCount * 2 - 1);

    for (const [key, data] of endpointMap) {
      if (data.count >= 2 && data.screenDirections && data.screenDirections.length >= 1) {
        const screenPoint = this.map.project([data.coord[0], data.coord[1]]);
        const errorType = this.getErrorTypeForCoord(data.coord);

        // Apply error type visibility filter
        if (errorType === 'fp' && !this.errorTypeVisibility.falsePositive) continue;
        if (errorType === 'fn' && !this.errorTypeVisibility.falseNegative) continue;
        if (errorType === 'tp' && !this.errorTypeVisibility.truePositive) continue;

        let color;
        switch (errorType) {
          case 'fp':
            color = this.errorColors.falsePositive;
            break;
          case 'fn':
            color = this.errorColors.falseNegative;
            break;
          default:
            color = this.errorColors.truePositive;
        }

        // Deduplicate screen-space directions
        const uniqueDirections = [];
        for (const dir of data.screenDirections) {
          let isDuplicate = false;
          for (const uDir of uniqueDirections) {
            const diff = Math.abs(dir - uDir);
            const normalizedDiff = Math.min(diff, Math.PI * 2 - diff);
            if (normalizedDiff < Math.PI / 12) {
              isDuplicate = true;
              break;
            }
          }
          if (!isDuplicate) uniqueDirections.push(dir);
        }

        // Draw crosswalk for each road direction
        for (let i = 0; i < Math.min(uniqueDirections.length, 4); i++) {
          const roadAngle = uniqueDirections[i];
          const crosswalkAngle = roadAngle + Math.PI / 2; // Perpendicular to road

          const offsetDist = this.metersToPixels(10);
          const cx = screenPoint.x + Math.cos(roadAngle) * offsetDist;
          const cy = screenPoint.y + Math.sin(roadAngle) * offsetDist;

          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(crosswalkAngle);

          // Draw shadow
          ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
          ctx.fillRect(-crosswalkLength / 2 + 2, -crosswalkWidth / 2 + 2, crosswalkLength, crosswalkWidth);

          // Draw background rectangle
          ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, 0.85)`;
          ctx.fillRect(-crosswalkLength / 2, -crosswalkWidth / 2, crosswalkLength, crosswalkWidth);

          // Draw zebra stripes
          ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
          for (let s = 0; s < stripeCount; s++) {
            const stripeX = -crosswalkLength / 2 + s * stripeWidth * 2;
            ctx.fillRect(stripeX, -crosswalkWidth / 2, stripeWidth, crosswalkWidth);
          }

          // Border
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
          ctx.lineWidth = 2;
          ctx.strokeRect(-crosswalkLength / 2, -crosswalkWidth / 2, crosswalkLength, crosswalkWidth);

          ctx.restore();
        }

        // Draw large intersection marker
        if (uniqueDirections.length >= 2) {
          const markerSize = Math.max(10, this.metersToPixels(5));

          ctx.beginPath();
          ctx.arc(screenPoint.x, screenPoint.y, markerSize, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, 0.9)`;
          ctx.fill();
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
          ctx.lineWidth = 3;
          ctx.stroke();

          // Add inner dot
          ctx.beginPath();
          ctx.arc(screenPoint.x, screenPoint.y, markerSize * 0.35, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
          ctx.fill();
        }
      }
    }
  }

  /**
   * Compute statistics for current viewport
   */
  computeStatisticsForViewport() {
    const features = this.queryStreetFeatures();

    let tp = 0, fp = 0, fn = 0;

    for (const feature of features) {
      const center = this.getFeatureCenterGeo(feature);
      const errorType = this.getErrorTypeForCoord(center);

      switch (errorType) {
        case 'fp': fp++; break;
        case 'fn': fn++; break;
        default: tp++; break;
      }
    }

    const total = tp + fp + fn;
    const accuracy = total > 0 ? tp / total : 0;
    const precision = (tp + fp) > 0 ? tp / (tp + fp) : 0;
    const recall = (tp + fn) > 0 ? tp / (tp + fn) : 0;
    const f1 = (precision + recall) > 0 ? 2 * precision * recall / (precision + recall) : 0;

    this.statistics = {
      total,
      truePositives: tp,
      trueNegatives: Math.floor(total * 0.7),
      falsePositives: fp,
      falseNegatives: fn,
      accuracy,
      precision,
      recall,
      f1Score: f1,
      meanIoU: (precision + recall) / 2
    };
  }

  // ============================================
  // PUBLIC API METHODS
  // ============================================

  /**
   * Set display mode
   * @param {string} mode - 'original', 'prediction', 'groundTruth', 'error', 'confidence'
   */
  setDisplayMode(mode) {
    if (['original', 'prediction', 'groundTruth', 'error', 'confidence'].includes(mode)) {
      this.displayMode = mode;
      this.renderOverlay();
    }
  }

  /**
   * Get current display mode
   */
  getDisplayMode() {
    return this.displayMode;
  }

  /**
   * Set overlay opacity (0-1)
   */
  setOpacity(opacity) {
    this.opacity = Math.max(0, Math.min(1, opacity));
    this.renderOverlay();
  }

  /**
   * Set visibility for a specific class
   * @param {string} className - 'road', 'sidewalk', or 'crosswalk'
   * @param {boolean} visible
   */
  setClassVisibility(className, visible) {
    if (this.classVisibility.hasOwnProperty(className)) {
      this.classVisibility[className] = visible;
      this.renderOverlay();
    }
  }

  /**
   * Toggle visibility for a specific class
   */
  toggleClassVisibility(className) {
    if (this.classVisibility.hasOwnProperty(className)) {
      this.classVisibility[className] = !this.classVisibility[className];
      this.renderOverlay();
      return this.classVisibility[className];
    }
    return null;
  }

  /**
   * Set visibility for a specific error type (for Errors mode filtering)
   * @param {string} errorType - 'truePositive', 'falsePositive', or 'falseNegative'
   * @param {boolean} visible
   */
  setErrorTypeVisibility(errorType, visible) {
    if (this.errorTypeVisibility.hasOwnProperty(errorType)) {
      this.errorTypeVisibility[errorType] = visible;
      this.renderOverlay();
    }
  }

  /**
   * Toggle visibility for a specific error type
   */
  toggleErrorTypeVisibility(errorType) {
    if (this.errorTypeVisibility.hasOwnProperty(errorType)) {
      this.errorTypeVisibility[errorType] = !this.errorTypeVisibility[errorType];
      this.renderOverlay();
      return this.errorTypeVisibility[errorType];
    }
    return null;
  }

  /**
   * Set confidence filter range
   * @param {number} min - Minimum confidence (0-1)
   * @param {number} max - Maximum confidence (0-1)
   */
  setConfidenceRange(min, max) {
    this.confidenceRange.min = Math.max(0, Math.min(1, min));
    this.confidenceRange.max = Math.max(0, Math.min(1, max));
    this.renderOverlay();
  }

  /**
   * Get current confidence range
   */
  getConfidenceRange() {
    return { ...this.confidenceRange };
  }

  /**
   * Set overall visibility
   */
  setVisible(visible) {
    this.visible = visible;
    this.canvas.style.display = visible ? 'block' : 'none';
    if (visible) this.renderOverlay();
  }

  /**
   * Get computed statistics for current viewport
   */
  computeStatistics() {
    return this.statistics;
  }

  /**
   * Get detailed statistics including per-class breakdowns
   */
  getDetailedStatistics() {
    const features = this.queryStreetFeatures();
    this.assignFeatureConfidence(features);

    let roadCount = 0, sidewalkCount = 0, crosswalkCount = 0;
    let lowConfCount = 0, medConfCount = 0, highConfCount = 0;
    let totalConfidence = 0;

    for (const feature of features) {
      const conf = this.getFeatureConfidence(feature);
      totalConfidence += conf;

      if (conf < 0.4) lowConfCount++;
      else if (conf < 0.7) medConfCount++;
      else highConfCount++;

      const fClass = feature.properties?.class || 'default';
      if (fClass.includes('motorway') || fClass.includes('trunk') || fClass.includes('primary') ||
          fClass.includes('secondary') || fClass.includes('tertiary') || fClass.includes('residential')) {
        roadCount++;
      }
    }

    return {
      ...this.statistics,
      totalFeatures: features.length,
      roadCount,
      sidewalkEstimate: Math.floor(roadCount * 2), // Estimated as 2 sidewalks per road
      crosswalkEstimate: Math.floor(roadCount * 0.3), // Rough estimate
      confidenceBreakdown: {
        low: lowConfCount,
        medium: medConfCount,
        high: highConfCount
      },
      averageConfidence: features.length > 0 ? totalConfidence / features.length : 0
    };
  }

  /**
   * Get data bounds for current viewport
   */
  getDataBounds() {
    const b = this.map.getBounds();
    return { north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest() };
  }

  /**
   * Force regenerate overlay (and optionally reset error regions)
   */
  forceRegenerate(resetErrorRegions = false) {
    this.cacheValid = false;
    this.cachedFeatures = null;
    if (resetErrorRegions) {
      this.geoErrorRegionsInitialized = false;
      this.initializeGeoErrorRegions();
    }
    this.renderOverlay();
    this.computeStatisticsForViewport();
  }

  /**
   * Reset all filters to defaults
   */
  resetFilters() {
    this.classVisibility = { road: true, sidewalk: true, crosswalk: true };
    this.errorTypeVisibility = { truePositive: true, falsePositive: true, falseNegative: true };
    this.confidenceRange = { min: 0, max: 1 };
    this.renderOverlay();
  }

  prerenderImages() {}

  destroy() {
    this.map.off('render', this._onRender);
    this.map.off('moveend', this._onMoveEnd);
    this.map.off('movestart', this._onMoveStart);
    if (this.canvas?.parentNode) this.canvas.parentNode.removeChild(this.canvas);
  }
}

if (typeof window !== 'undefined') {
  window.ViewportSegmentationOverlay = ViewportSegmentationOverlay;
}
