/**
 * Modern Segmentation Panel - Mapbox GL + Deck.gl
 * Displays aerial imagery with error overlays and confidence heatmap
 */

class ModernSegmentationPanel {
  constructor(containerId, stateManager, mapboxToken) {
    this.containerId = containerId;
    this.stateManager = stateManager;
    this.mapboxToken = mapboxToken;

    // Mapbox instance
    this.map = null;

    // Deck.gl overlay
    this.deckOverlay = null;

    // Error data
    this.errorData = null;

    // Confidence data (for heatmap)
    this.confidenceData = null;

    this.init();
  }

  /**
   * Initialize Mapbox + Deck.gl overlay
   */
  init() {
    console.log('🚀 Initializing Modern Segmentation Panel...');

    // Get initial state
    const center = this.stateManager.getState('viewport.center');
    const zoom = this.stateManager.getState('viewport.zoom');

    // Initialize Mapbox
    mapboxgl.accessToken = this.mapboxToken;

    this.map = new mapboxgl.Map({
      container: this.containerId,
      style: 'mapbox://styles/mapbox/satellite-streets-v12', // Aerial imagery
      center: [center[1], center[0]], // [lng, lat]
      zoom: zoom, // Use same zoom level as network panel for consistency
      pitch: 0,
      bearing: 0
    });

    // Add navigation controls
    this.map.addControl(new mapboxgl.NavigationControl(), 'top-right');

    // Initialize Deck.gl overlay
    this.initDeckOverlay();

    // Set up event handlers
    this.setupEventHandlers();

    // Subscribe to state changes
    this.subscribeToState();

    console.log('✅ Modern Segmentation Panel initialized');
  }

  /**
   * Initialize Deck.gl overlay for error visualization
   */
  initDeckOverlay() {
    const {MapboxOverlay} = deck;

    this.deckOverlay = new MapboxOverlay({
      interleaved: true,
      layers: []
    });

    this.map.addControl(this.deckOverlay);
  }

  /**
   * Load error data
   * @param {Object} errorGeojson - Error regions GeoJSON
   */
  loadErrors(errorGeojson) {
    console.log('Loading error data...');

    if (!errorGeojson || !errorGeojson.features) {
      console.warn('Invalid error data');
      return;
    }

    this.errorData = errorGeojson;

    // Update statistics
    this.updateErrorStatistics(errorGeojson);

    // Update visualization
    this.updateLayers();

    console.log(`✅ Errors loaded: ${errorGeojson.features.length} regions`);
  }

  /**
   * Load confidence heatmap data (CRITICAL FEATURE)
   * @param {Object} confidenceData - Confidence grid data
   */
  loadConfidenceHeatmap(confidenceData) {
    console.log('Loading confidence heatmap...');
    this.confidenceData = confidenceData;
    this.updateLayers();
  }

  /**
   * Update Deck.gl layers
   */
  updateLayers() {
    const layers = [];
    const layerStates = this.stateManager.getState('layers');
    const filters = this.stateManager.getState('filters');

    // Confidence heatmap layer (if enabled and data available)
    if (layerStates.confidenceHeatmap && this.confidenceData) {
      layers.push(this.createConfidenceHeatmapLayer());
    }

    // Error overlay layer (if enabled)
    if (layerStates.errorOverlay && this.errorData) {
      const filteredData = this.filterErrorData(this.errorData, filters);
      layers.push(this.createErrorLayer(filteredData));
    }

    // Update Deck.gl
    this.deckOverlay.setProps({ layers });
  }

  /**
   * Create confidence heatmap layer (CRITICAL FEATURE)
   */
  createConfidenceHeatmapLayer() {
    const {HeatmapLayer} = deck;

    return new HeatmapLayer({
      id: 'confidence-heatmap',
      data: this.confidenceData,

      getPosition: d => [d.longitude, d.latitude],
      getWeight: d => d.confidence,

      radiusPixels: 30,
      intensity: 1,
      threshold: 0.05,

      colorRange: [
        [239, 68, 68, 100],    // Low confidence - Red
        [249, 115, 22, 120],   //
        [245, 158, 11, 140],   // Medium confidence - Amber
        [6, 182, 212, 160],    //
        [16, 185, 129, 180]    // High confidence - Green
      ],

      opacity: 0.6
    });
  }

  /**
   * Create error visualization layer
   */
  createErrorLayer(filteredData) {
    const {GeoJsonLayer} = deck;

    return new GeoJsonLayer({
      id: 'error-layer',
      data: filteredData,

      // Styling
      filled: true,
      stroked: true,
      lineWidthMinPixels: 2,

      // Dynamic properties
      getFillColor: d => this.getErrorFillColor(d.properties),
      getLineColor: d => this.getErrorStrokeColor(d.properties),
      getLineWidth: 2,

      // Interactivity
      pickable: true,
      autoHighlight: true,
      highlightColor: [255, 255, 255, 100],

      // Transitions
      transitions: {
        getFillColor: 300,
        getLineColor: 300
      }
    });
  }

  /**
   * Get error fill color with confidence-based opacity
   */
  getErrorFillColor(properties) {
    const errorType = properties.errorType;
    const confidence = properties.confidence || 0.5;

    const baseColors = {
      'false_positive': [59, 130, 246],      // Blue
      'false_negative': [245, 158, 11],      // Amber
      'true_positive': [16, 185, 129],       // Green
      'confidence_mismatch': [239, 68, 68]   // Red
    };

    const color = baseColors[errorType] || baseColors['false_positive'];

    // Opacity based on confidence
    const opacity = Math.floor(confidence * 150) + 50; // Range: 50-200

    return [...color, opacity];
  }

  /**
   * Get error stroke color
   */
  getErrorStrokeColor(properties) {
    const errorType = properties.errorType;

    const colors = {
      'false_positive': [59, 130, 246, 255],
      'false_negative': [245, 158, 11, 255],
      'true_positive': [16, 185, 129, 255],
      'confidence_mismatch': [239, 68, 68, 255]
    };

    return colors[errorType] || colors['false_positive'];
  }

  /**
   * Filter error data based on current filters
   */
  filterErrorData(errorData, filters) {
    const filteredFeatures = errorData.features.filter(feature => {
      const errorType = feature.properties.errorType;
      const confidence = (feature.properties.confidence || 0.5) * 100;

      // Check error type filter
      const typeMap = {
        'false_positive': filters.errorTypes.falsePositive,
        'false_negative': filters.errorTypes.falseNegative,
        'true_positive': filters.errorTypes.truePositive,
        'confidence_mismatch': filters.errorTypes.confidenceMismatch
      };

      const typeAllowed = typeMap[errorType];
      if (!typeAllowed) return false;

      // Check confidence range
      const confidenceAllowed = confidence >= filters.confidenceRange.min &&
                               confidence <= filters.confidenceRange.max;

      return typeAllowed && confidenceAllowed;
    });

    return {
      type: 'FeatureCollection',
      features: filteredFeatures
    };
  }

  /**
   * Update error statistics
   */
  updateErrorStatistics(errorData) {
    const counts = {
      falsePositive: 0,
      falseNegative: 0,
      truePositive: 0,
      confidenceMismatch: 0
    };

    errorData.features.forEach(feature => {
      const type = feature.properties.errorType;
      if (type === 'false_positive') counts.falsePositive++;
      else if (type === 'false_negative') counts.falseNegative++;
      else if (type === 'true_positive') counts.truePositive++;
      else if (type === 'confidence_mismatch') counts.confidenceMismatch++;
    });

    const totalErrors = counts.falsePositive + counts.falseNegative;
    const totalPredictions = totalErrors + counts.truePositive;
    const accuracy = totalPredictions > 0 ?
      (counts.truePositive / totalPredictions) * 100 : 0;

    this.stateManager.batchUpdate({
      'data.statistics.totalErrors': totalErrors,
      'data.statistics.errorCounts': counts,
      'data.statistics.accuracy': accuracy
    });

    // Update UI
    this.updateErrorCountsUI(counts, totalErrors, accuracy);
  }

  /**
   * Update error counts in UI
   */
  updateErrorCountsUI(counts, totalErrors, accuracy) {
    // Update filter chip counts
    const fpCount = document.getElementById('count-fp');
    const fnCount = document.getElementById('count-fn');
    const tpCount = document.getElementById('count-tp');

    if (fpCount) fpCount.textContent = counts.falsePositive;
    if (fnCount) fnCount.textContent = counts.falseNegative;
    if (tpCount) tpCount.textContent = counts.truePositive;

    // Update stats panel
    const totalErrorsStat = document.getElementById('stat-total-errors');
    const accuracyStat = document.getElementById('stat-accuracy');

    if (totalErrorsStat) totalErrorsStat.textContent = totalErrors;
    if (accuracyStat) accuracyStat.textContent = accuracy.toFixed(1) + '%';
  }

  /**
   * Set up event handlers
   */
  setupEventHandlers() {
    // Handle map movements
    this.map.on('moveend', () => {
      if (!this._suppressViewportUpdate) {
        const center = this.map.getCenter();
        const zoom = this.map.getZoom();

        this.stateManager.batchUpdate({
          'viewport.center': [center.lat, center.lng],
          'viewport.zoom': zoom // Consistent zoom level
        });
      }
    });

    // Handle clicks on errors (via Deck.gl picking)
    this.map.on('click', (e) => {
      const features = this.map.queryRenderedFeatures(e.point);
      // Handle selection - will be implemented later
      if (features && features.length > 0) {
        console.log('Clicked features:', features);
      }
    });
  }

  /**
   * Subscribe to state changes
   */
  subscribeToState() {
    // Listen for filter changes
    this.stateManager.subscribe((state, path) => {
      if (path.startsWith('filters.')) {
        this.updateLayers();
      }
    }, 'filters');

    // Listen for layer toggles
    this.stateManager.subscribe((state, path) => {
      if (path.startsWith('layers.')) {
        this.updateLayers();
      }
    }, 'layers');
  }

  /**
   * Set view programmatically (for sync)
   */
  setView(center, zoom) {
    this._suppressViewportUpdate = true;

    this.map.flyTo({
      center: [center[1], center[0]], // [lng, lat]
      zoom: zoom, // Use consistent zoom level
      duration: 300
    });

    setTimeout(() => {
      this._suppressViewportUpdate = false;
    }, 400);
  }

  /**
   * Get current center and zoom
   */
  getViewState() {
    const center = this.map.getCenter();
    const zoom = this.map.getZoom();

    return {
      center: [center.lat, center.lng],
      zoom: zoom // Consistent zoom level
    };
  }

  /**
   * Cleanup
   */
  destroy() {
    if (this.map) {
      this.map.remove();
    }
  }
}

// Make available globally
if (typeof window !== 'undefined') {
  window.ModernSegmentationPanel = ModernSegmentationPanel;
}
