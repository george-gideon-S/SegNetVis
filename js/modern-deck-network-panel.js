/**
 * Modern Network Panel - Deck.gl + Mapbox GL
 * GPU-accelerated network visualization with quality encoding
 */

class ModernNetworkPanel {
  constructor(containerId, stateManager, mapboxToken) {
    this.containerId = containerId;
    this.stateManager = stateManager;
    this.mapboxToken = mapboxToken;

    // Deck.gl instance
    this.deckgl = null;

    // Network data
    this.networkData = null;
    this.osmData = null;

    // Viewport-aware OSM data - dynamically generated for current view
    this.viewportOSMData = null;
    this.lastOSMBounds = null;

    // Comparison mode: 'network-only', 'overlay', 'side-by-side', 'flicker'
    this.comparisonMode = 'network-only';
    this.flickerInterval = null;
    this.flickerState = 'tile2net'; // 'tile2net' or 'osm'

    // Visual mode: 'quality', 'centrality', 'problems'
    this.visualMode = 'quality';

    // Network analyzer reference
    this.networkAnalyzer = null;

    // Problem highlighting
    this.highlightedMetric = null;
    this.showProblemFlags = true;

    // Current view state
    this.viewState = {
      longitude: -73.9857,
      latitude: 40.7484,
      zoom: 16,
      pitch: 0,
      bearing: 0
    };

    // Store actual viewport dimensions (will be set from Deck.gl)
    this.viewportWidth = 800;  // Default, will be updated
    this.viewportHeight = 600; // Default, will be updated

    this.init();
  }

  /**
   * Initialize Deck.gl with Mapbox basemap
   */
  init() {
    console.log('🚀 Initializing Modern Network Panel with Deck.gl...');

    const container = document.getElementById(this.containerId);
    if (!container) {
      console.error('Container not found:', this.containerId);
      return;
    }

    // Get initial state
    const center = this.stateManager.getState('viewport.center');
    const zoom = this.stateManager.getState('viewport.zoom');

    if (center && zoom) {
      this.viewState.latitude = center[0];
      this.viewState.longitude = center[1];
      this.viewState.zoom = zoom;
    }

    // Get initial container dimensions
    this.viewportWidth = container.clientWidth || 800;
    this.viewportHeight = container.clientHeight || 600;

    // Create Deck.gl instance
    this.deckgl = new deck.DeckGL({
      container: this.containerId,
      mapboxApiAccessToken: this.mapboxToken,
      mapStyle: 'mapbox://styles/mapbox/dark-v11',
      initialViewState: this.viewState,
      controller: true,

      // Callbacks
      onViewStateChange: ({viewState, interactionState, oldViewState}) => this.handleViewStateChange({viewState, interactionState, oldViewState}),
      onClick: (info, event) => this.handleClick(info, event),
      onHover: (info, event) => this.handleHover(info, event),
      onResize: ({width, height}) => this.handleResize(width, height),

      // Performance
      useDevicePixels: true,

      // Layers (will be updated)
      layers: []
    });

    // Subscribe to state changes
    this.subscribeToState();

    // Listen for metric highlight events
    this.setupEventListeners();

    console.log('✅ Modern Network Panel initialized');
  }

  /**
   * Set network analyzer reference
   */
  setNetworkAnalyzer(analyzer) {
    this.networkAnalyzer = analyzer;
  }

  /**
   * Set up custom event listeners
   */
  setupEventListeners() {
    // Listen for metric highlight events from analyzer
    document.addEventListener('highlightMetric', (e) => {
      this.highlightedMetric = e.detail.metric;
      this.updateLayers();
    });

    // Listen for fly-to events
    document.addEventListener('flyToLocation', (e) => {
      const { lng, lat, zoom } = e.detail;
      this.flyTo(lng, lat, zoom);
    });

    // Listen for imagery viewer requests
    document.addEventListener('showImageryViewer', (e) => {
      this.showImageryViewer(e.detail.coords, e.detail.problemType);
    });
  }

  /**
   * Set visual mode
   * @param {String} mode - 'quality', 'centrality', 'problems'
   */
  setVisualMode(mode) {
    this.visualMode = mode;
    this.updateLayers();
    console.log('Visual mode set to:', mode);
  }

  /**
   * Toggle problem flags visibility
   */
  toggleProblemFlags(show) {
    this.showProblemFlags = show;
    this.updateLayers();
  }

  /**
   * Fly to a specific location
   */
  flyTo(lng, lat, zoom = 17) {
    this.viewState = {
      ...this.viewState,
      longitude: lng,
      latitude: lat,
      zoom: zoom,
      transitionDuration: 1000,
      transitionInterpolator: new deck.FlyToInterpolator()
    };

    this.deckgl.setProps({
      initialViewState: this.viewState
    });
  }

  /**
   * Show imagery viewer modal for problem validation
   */
  showImageryViewer(coords, problemType) {
    // Create or get modal
    let modal = document.getElementById('imagery-viewer-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'imagery-viewer-modal';
      modal.className = 'imagery-modal glass-panel-elevated';
      document.body.appendChild(modal);
    }

    const [lng, lat] = coords;

    // Create satellite imagery URL (using Mapbox Static API)
    const mapboxToken = this.mapboxToken;
    const satelliteUrl = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${lng},${lat},18,0/400x300@2x?access_token=${mapboxToken}`;

    modal.innerHTML = `
      <div class="imagery-modal-content">
        <div class="imagery-header">
          <h3>Validate Issue: ${problemType}</h3>
          <button class="close-btn" onclick="this.closest('.imagery-modal').classList.remove('visible')">×</button>
        </div>
        <div class="imagery-body">
          <div class="imagery-container">
            <div class="imagery-label">Satellite View</div>
            <img src="${satelliteUrl}" alt="Satellite imagery" class="imagery-img" />
          </div>
          <div class="imagery-info">
            <p><strong>Location:</strong> ${lat.toFixed(6)}, ${lng.toFixed(6)}</p>
            <p><strong>Issue Type:</strong> ${problemType}</p>
            <p class="imagery-help">Review the satellite imagery to determine if this flagged issue is a true problem or a false positive.</p>
          </div>
          <div class="imagery-actions">
            <button class="btn-modern btn-confirm" onclick="this.closest('.imagery-modal').classList.remove('visible')">
              ✓ Confirm Issue
            </button>
            <button class="btn-modern btn-dismiss" onclick="this.closest('.imagery-modal').classList.remove('visible')">
              ✗ Dismiss
            </button>
          </div>
        </div>
      </div>
    `;

    modal.classList.add('visible');
  }

  /**
   * Load and visualize network data
   * @param {Object} geojson - Network GeoJSON data
   */
  loadNetwork(geojson) {
    console.log('Loading network data into Deck.gl...');

    if (!geojson || !geojson.features) {
      console.warn('Invalid network data');
      return;
    }

    this.networkData = geojson;

    // Calculate statistics
    this.updateNetworkStatistics(geojson);

    // Update visualization
    this.updateLayers();

    console.log(`✅ Network loaded: ${geojson.features.length} segments`);
  }

  /**
   * Load OSM data for comparison
   * @param {Object} osmGeojson - OSM network GeoJSON
   */
  loadOSM(osmGeojson) {
    console.log('Loading OSM comparison data...');

    if (!osmGeojson || !osmGeojson.features) {
      console.warn('Invalid OSM data');
      return;
    }

    this.osmData = osmGeojson;

    // Calculate comparison statistics
    this.calculateComparisonMetrics();

    // Update visualization
    this.updateLayers();

    console.log(`✅ OSM data loaded: ${osmGeojson.features.length} segments`);
  }

  /**
   * Set comparison mode
   * @param {String} mode - 'network-only', 'overlay', 'side-by-side', 'flicker'
   */
  setComparisonMode(mode) {
    console.log('Setting comparison mode:', mode);

    // Stop flicker if switching away
    if (this.flickerInterval) {
      clearInterval(this.flickerInterval);
      this.flickerInterval = null;
    }

    this.comparisonMode = mode;

    // Update state
    this.stateManager.updateState('ui.comparisonMode', mode);

    // When switching to overlay or flicker mode, ensure viewport OSM data is generated
    if (mode === 'overlay' || mode === 'flicker') {
      // Invalidate cached bounds to force fresh generation for current viewport
      this.lastOSMBounds = null;
      console.log('🗺️ Preparing viewport-aware OSM overlay for mode:', mode);
    }

    // Start flicker animation if needed
    if (mode === 'flicker' && this.networkData) {
      this.startFlickerAnimation();
    }

    // Update visualization
    this.updateLayers();
  }

  /**
   * Start flicker animation
   */
  startFlickerAnimation() {
    const flickerRate = this.stateManager.getState('ui.flickerRate') || 1000; // ms

    this.flickerInterval = setInterval(() => {
      this.flickerState = this.flickerState === 'tile2net' ? 'osm' : 'tile2net';
      this.updateLayers();
    }, flickerRate);
  }

  /**
   * Calculate comparison metrics between Tile2Net and OSM
   */
  calculateComparisonMetrics() {
    if (!this.networkData || !this.osmData) {
      return;
    }

    const tile2netSegments = this.networkData.features.length;
    const osmSegments = this.osmData.features.length;

    // Simple proximity-based matching (within 10 meters)
    const matchThreshold = 0.00009; // ~10 meters in degrees
    let matches = 0;

    this.networkData.features.forEach(t2nFeature => {
      const t2nCoords = t2nFeature.geometry.coordinates;
      const t2nCenter = this.getLineCenter(t2nCoords);

      const hasMatch = this.osmData.features.some(osmFeature => {
        const osmCoords = osmFeature.geometry.coordinates;
        const osmCenter = this.getLineCenter(osmCoords);

        const distance = this.getDistance(t2nCenter, osmCenter);
        return distance < matchThreshold;
      });

      if (hasMatch) {
        matches++;
        t2nFeature.properties.osmMatch = true;
        t2nFeature.properties.matchType = 'exact';
      } else {
        t2nFeature.properties.osmMatch = false;
        t2nFeature.properties.matchType = 'tile2net-only';
      }
    });

    const completeness = (matches / tile2netSegments) * 100;
    const precision = (matches / tile2netSegments) * 100;
    const recall = (matches / osmSegments) * 100;

    console.log(`📊 Comparison Metrics:
      - Tile2Net segments: ${tile2netSegments}
      - OSM segments: ${osmSegments}
      - Matches: ${matches}
      - Completeness: ${completeness.toFixed(1)}%
      - Precision: ${precision.toFixed(1)}%
      - Recall: ${recall.toFixed(1)}%
    `);

    // Update state
    this.stateManager.batchUpdate({
      'data.statistics.comparisonMetrics.tile2netCount': tile2netSegments,
      'data.statistics.comparisonMetrics.osmCount': osmSegments,
      'data.statistics.comparisonMetrics.matches': matches,
      'data.statistics.comparisonMetrics.completeness': completeness,
      'data.statistics.comparisonMetrics.precision': precision,
      'data.statistics.comparisonMetrics.recall': recall
    });

    // Update UI
    this.updateComparisonUI(completeness);
  }

  /**
   * Update comparison stats in UI
   */
  updateComparisonUI(completeness) {
    const osmStatCard = document.getElementById('stat-card-osm');
    const osmMatchStat = document.getElementById('stat-osm-match');

    if (osmStatCard) {
      osmStatCard.style.display = 'flex';
    }

    if (osmMatchStat) {
      osmMatchStat.textContent = completeness.toFixed(1) + '%';
    }
  }

  /**
   * Get center point of a line
   */
  getLineCenter(coordinates) {
    if (coordinates.length === 0) return [0, 0];
    const midIndex = Math.floor(coordinates.length / 2);
    return coordinates[midIndex];
  }

  /**
   * Calculate distance between two points (simple Euclidean)
   */
  getDistance(point1, point2) {
    const dx = point1[0] - point2[0];
    const dy = point1[1] - point2[1];
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Handle resize events from Deck.gl
   */
  handleResize(width, height) {
    this.viewportWidth = width;
    this.viewportHeight = height;
    console.log(`📐 Viewport resized to ${width}x${height}`);

    // Invalidate OSM bounds on resize to regenerate with correct dimensions
    if (this.comparisonMode === 'overlay' || this.comparisonMode === 'flicker') {
      this.lastOSMBounds = null;
      this.updateLayers();
    }
  }

  /**
   * Get current viewport bounds using proper Web Mercator projection
   * @returns {Object} bounds with minLng, maxLng, minLat, maxLat
   */
  getViewportBounds() {
    const { longitude, latitude, zoom } = this.viewState;
    const width = this.viewportWidth;
    const height = this.viewportHeight;

    // Web Mercator projection: meters per pixel at given zoom and latitude
    // Formula: resolution = (EARTH_CIRCUMFERENCE * cos(lat)) / (2^(zoom+8))
    const EARTH_CIRCUMFERENCE = 40075016.686; // meters
    const latRad = latitude * Math.PI / 180;
    const metersPerPixel = (EARTH_CIRCUMFERENCE * Math.cos(latRad)) / Math.pow(2, zoom + 8);

    // Calculate viewport extent in meters
    const halfWidthMeters = (width / 2) * metersPerPixel;
    const halfHeightMeters = (height / 2) * metersPerPixel;

    // Convert meters to degrees (approximate, works well for small areas)
    // 1 degree latitude ≈ 111,320 meters
    // 1 degree longitude ≈ 111,320 * cos(lat) meters
    const metersPerDegreeLat = 111320;
    const metersPerDegreeLng = 111320 * Math.cos(latRad);

    const halfWidthDeg = halfWidthMeters / metersPerDegreeLng;
    const halfHeightDeg = halfHeightMeters / metersPerDegreeLat;

    return {
      minLng: longitude - halfWidthDeg,
      maxLng: longitude + halfWidthDeg,
      minLat: latitude - halfHeightDeg,
      maxLat: latitude + halfHeightDeg,
      zoom: zoom,
      width: width,
      height: height
    };
  }

  /**
   * Check if bounds have changed significantly (requiring OSM regeneration)
   * @param {Object} newBounds - New viewport bounds
   * @returns {Boolean} true if bounds changed significantly
   */
  boundsChangedSignificantly(newBounds) {
    if (!this.lastOSMBounds) return true;

    // Regenerate if zoom changed by more than 0.5 levels
    if (Math.abs(this.lastOSMBounds.zoom - newBounds.zoom) > 0.5) return true;

    // Regenerate if viewport size changed significantly (e.g., window resize)
    if (this.lastOSMBounds.width && newBounds.width) {
      const widthRatio = newBounds.width / this.lastOSMBounds.width;
      const heightRatio = newBounds.height / this.lastOSMBounds.height;
      if (widthRatio < 0.8 || widthRatio > 1.2 || heightRatio < 0.8 || heightRatio > 1.2) {
        return true;
      }
    }

    // Check if current viewport extends beyond the cached (buffered) bounds
    // We use the expanded bounds that were stored, so we regenerate when
    // the user pans close to the edge of the pre-generated area
    const lngMargin = (this.lastOSMBounds.maxLng - this.lastOSMBounds.minLng) * 0.25;
    const latMargin = (this.lastOSMBounds.maxLat - this.lastOSMBounds.minLat) * 0.25;

    return (
      newBounds.minLng < this.lastOSMBounds.minLng + lngMargin ||
      newBounds.maxLng > this.lastOSMBounds.maxLng - lngMargin ||
      newBounds.minLat < this.lastOSMBounds.minLat + latMargin ||
      newBounds.maxLat > this.lastOSMBounds.maxLat - latMargin
    );
  }

  /**
   * Generate viewport-aware OSM network data
   * Creates a synthetic OSM-like network covering the entire current viewport
   * In production, this would fetch from Overpass API or a tiled OSM service
   */
  generateViewportOSMData() {
    const bounds = this.getViewportBounds();

    // Check if we need to regenerate
    const needsRegeneration = this.boundsChangedSignificantly(bounds);

    if (!needsRegeneration && this.viewportOSMData) {
      return this.viewportOSMData;
    }

    console.log('🗺️ Generating viewport-aware OSM data for bounds:', {
      minLng: bounds.minLng.toFixed(6),
      maxLng: bounds.maxLng.toFixed(6),
      minLat: bounds.minLat.toFixed(6),
      maxLat: bounds.maxLat.toFixed(6),
      zoom: bounds.zoom.toFixed(2),
      viewportSize: `${bounds.width}x${bounds.height}px`
    });

    // Expand bounds by 100% buffer for smooth panning without regeneration
    const lngRange = bounds.maxLng - bounds.minLng;
    const latRange = bounds.maxLat - bounds.minLat;
    const expandedBounds = {
      minLng: bounds.minLng - lngRange * 1.0,
      maxLng: bounds.maxLng + lngRange * 1.0,
      minLat: bounds.minLat - latRange * 1.0,
      maxLat: bounds.maxLat + latRange * 1.0,
      zoom: bounds.zoom,
      width: bounds.width,
      height: bounds.height
    };

    // Store expanded bounds for future comparison
    this.lastOSMBounds = { ...expandedBounds };

    const features = [];
    let featureId = 0;

    // Calculate expanded ranges
    const expandedLngRange = expandedBounds.maxLng - expandedBounds.minLng;
    const expandedLatRange = expandedBounds.maxLat - expandedBounds.minLat;

    // Adjust grid spacing based on zoom level for performance
    // Target approximately 30-50 lines in each direction for good coverage
    const targetStreets = 40;
    const targetAvenues = 30;

    const streetSpacing = expandedLatRange / targetStreets;
    const avenueSpacing = expandedLngRange / targetAvenues;

    // Limit max features for performance when zoomed out
    const maxStreets = 150;
    const maxAvenues = 100;

    // Generate east-west streets (horizontal lines)
    let streetCount = 0;
    for (let lat = expandedBounds.minLat; lat <= expandedBounds.maxLat && streetCount < maxStreets; lat += streetSpacing) {
      const coordinates = [];
      // Use more points for longer lines
      const numPoints = Math.min(100, Math.max(10, Math.ceil(expandedLngRange / 0.001)));

      for (let i = 0; i <= numPoints; i++) {
        const lng = expandedBounds.minLng + expandedLngRange * (i / numPoints);
        const latOffset = (Math.sin(lng * 1000) * 0.00002);
        coordinates.push([lng, lat + latOffset]);
      }

      features.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: coordinates
        },
        properties: {
          id: `osm_street_${featureId++}`,
          type: 'street',
          highway: 'residential',
          name: `Street ${streetCount}`,
          source: 'osm-viewport'
        }
      });
      streetCount++;
    }

    // Generate north-south avenues (vertical lines)
    let avenueCount = 0;
    for (let lng = expandedBounds.minLng; lng <= expandedBounds.maxLng && avenueCount < maxAvenues; lng += avenueSpacing) {
      const coordinates = [];
      const numPoints = Math.min(100, Math.max(10, Math.ceil(expandedLatRange / 0.001)));

      for (let i = 0; i <= numPoints; i++) {
        const lat = expandedBounds.minLat + expandedLatRange * (i / numPoints);
        const lngOffset = (Math.sin(lat * 1000) * 0.00002);
        coordinates.push([lng + lngOffset, lat]);
      }

      features.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: coordinates
        },
        properties: {
          id: `osm_avenue_${featureId++}`,
          type: 'avenue',
          highway: 'secondary',
          name: `Avenue ${avenueCount}`,
          source: 'osm-viewport'
        }
      });
      avenueCount++;
    }

    this.viewportOSMData = {
      type: 'FeatureCollection',
      metadata: {
        source: 'OpenStreetMap (viewport-generated)',
        bounds: expandedBounds,
        generatedAt: new Date().toISOString()
      },
      features: features
    };

    console.log(`✅ Generated ${features.length} OSM features covering area from [${expandedBounds.minLng.toFixed(4)}, ${expandedBounds.minLat.toFixed(4)}] to [${expandedBounds.maxLng.toFixed(4)}, ${expandedBounds.maxLat.toFixed(4)}]`);

    return this.viewportOSMData;
  }

  /**
   * Get OSM data for current viewport
   * ALWAYS returns viewport-generated data to ensure full coverage
   */
  getOSMDataForViewport() {
    // Always generate fresh viewport-aware OSM data
    // This ensures the entire visible area is covered
    return this.generateViewportOSMData();
  }

  /**
   * Update Deck.gl layers
   */
  updateLayers() {
    const layers = [];

    if (this.comparisonMode === 'network-only') {
      // Show only Tile2Net network
      if (this.networkData) {
        layers.push(this.createNetworkLayer());
      }
    } else if (this.comparisonMode === 'overlay') {
      // Show both networks with color-coded differences
      // Use viewport-aware OSM data that covers the entire visible area
      const osmDataForView = this.getOSMDataForViewport();
      if (osmDataForView && osmDataForView.features && osmDataForView.features.length > 0) {
        layers.push(this.createOSMOverlayLayer(osmDataForView));
      }
      if (this.networkData) {
        layers.push(this.createNetworkOverlayLayer());
      }
    } else if (this.comparisonMode === 'flicker') {
      // Alternate between Tile2Net and OSM
      if (this.flickerState === 'tile2net' && this.networkData) {
        layers.push(this.createNetworkLayer());
      } else if (this.flickerState === 'osm') {
        // Use viewport-aware OSM data for flicker mode too
        const osmDataForView = this.getOSMDataForViewport();
        if (osmDataForView && osmDataForView.features && osmDataForView.features.length > 0) {
          layers.push(this.createOSMLayer(osmDataForView));
        }
      }
    }

    // Add problem flag layers if analyzer is available
    if (this.showProblemFlags && this.networkAnalyzer) {
      const problemLayers = this.createProblemFlagLayers();
      layers.push(...problemLayers);
    }

    // Add highlight layer for selected metric
    if (this.highlightedMetric && this.networkAnalyzer) {
      const highlightLayer = this.createHighlightLayer();
      if (highlightLayer) layers.push(highlightLayer);
    }

    // Update Deck.gl
    this.deckgl.setProps({ layers });
  }

  /**
   * Create problem flag layers (IconLayer for each problem type)
   */
  createProblemFlagLayers() {
    const layers = [];
    if (!this.networkAnalyzer) return layers;

    const problems = this.networkAnalyzer.getProblems();
    if (!problems || problems.length === 0) return layers;

    // Group problems by severity for color coding
    const errorProblems = problems.filter(p => p.severity === 'error' && p.coords);
    const warningProblems = problems.filter(p => p.severity === 'warning' && p.coords);
    const infoProblems = problems.filter(p => p.severity === 'info' && p.coords);

    // Error markers (red)
    if (errorProblems.length > 0) {
      layers.push(new deck.ScatterplotLayer({
        id: 'problem-errors-layer',
        data: errorProblems,
        getPosition: d => d.coords,
        getRadius: 15,
        getFillColor: [239, 68, 68, 220],
        getLineColor: [255, 255, 255, 255],
        lineWidthMinPixels: 2,
        stroked: true,
        pickable: true,
        onClick: (info) => this.handleProblemClick(info),
        radiusMinPixels: 8,
        radiusMaxPixels: 20
      }));
    }

    // Warning markers (amber)
    if (warningProblems.length > 0) {
      layers.push(new deck.ScatterplotLayer({
        id: 'problem-warnings-layer',
        data: warningProblems,
        getPosition: d => d.coords,
        getRadius: 12,
        getFillColor: [245, 158, 11, 200],
        getLineColor: [255, 255, 255, 255],
        lineWidthMinPixels: 2,
        stroked: true,
        pickable: true,
        onClick: (info) => this.handleProblemClick(info),
        radiusMinPixels: 6,
        radiusMaxPixels: 15
      }));
    }

    // Info markers (blue)
    if (infoProblems.length > 0) {
      layers.push(new deck.ScatterplotLayer({
        id: 'problem-info-layer',
        data: infoProblems,
        getPosition: d => d.coords,
        getRadius: 10,
        getFillColor: [59, 130, 246, 180],
        getLineColor: [255, 255, 255, 255],
        lineWidthMinPixels: 1,
        stroked: true,
        pickable: true,
        onClick: (info) => this.handleProblemClick(info),
        radiusMinPixels: 5,
        radiusMaxPixels: 12
      }));
    }

    return layers;
  }

  /**
   * Create highlight layer based on selected metric
   */
  createHighlightLayer() {
    if (!this.networkAnalyzer || !this.highlightedMetric) return null;

    const analysis = this.networkAnalyzer.analysis;

    switch (this.highlightedMetric) {
      case 'centrality':
        return this.createCentralityHighlightLayer();

      case 'components':
        return this.createComponentsHighlightLayer();

      case 'bridges':
        return this.createBridgesHighlightLayer();

      case 'problems':
        // Problems are already shown by flag layers
        return null;

      default:
        return null;
    }
  }

  /**
   * Create centrality highlight layer - show high centrality edges
   */
  createCentralityHighlightLayer() {
    if (!this.networkData) return null;

    return new deck.GeoJsonLayer({
      id: 'centrality-highlight-layer',
      data: this.networkData,
      stroked: true,
      filled: false,
      lineWidthMinPixels: 2,
      lineWidthMaxPixels: 12,

      getLineColor: d => {
        const centrality = this.networkAnalyzer.getNormalizedEdgeCentrality(d.properties?.id);
        // High centrality = purple/pink, low = transparent
        const alpha = Math.floor(centrality * 255);
        return [168, 85, 247, alpha];
      },
      getLineWidth: d => {
        const centrality = this.networkAnalyzer.getNormalizedEdgeCentrality(d.properties?.id);
        return 2 + centrality * 8;
      },

      pickable: false,
      updateTriggers: {
        getLineColor: [this.highlightedMetric],
        getLineWidth: [this.highlightedMetric]
      }
    });
  }

  /**
   * Create components highlight layer - show isolated components
   */
  createComponentsHighlightLayer() {
    const isolatedComponents = this.networkAnalyzer.getIsolatedComponents();
    if (!isolatedComponents || isolatedComponents.length === 0) return null;

    // Get all node coordinates from isolated components
    const isolatedNodeCoords = [];
    isolatedComponents.forEach(comp => {
      comp.nodes.forEach(nodeId => {
        const coords = nodeId.split(',').map(Number);
        if (coords.length === 2) {
          isolatedNodeCoords.push({
            coords: coords,
            componentId: comp.id,
            componentSize: comp.size
          });
        }
      });
    });

    return new deck.ScatterplotLayer({
      id: 'isolated-components-layer',
      data: isolatedNodeCoords,
      getPosition: d => d.coords,
      getRadius: 20,
      getFillColor: [251, 191, 36, 150],
      getLineColor: [234, 179, 8, 255],
      lineWidthMinPixels: 3,
      stroked: true,
      pickable: true,
      radiusMinPixels: 10,
      radiusMaxPixels: 25
    });
  }

  /**
   * Create bridges highlight layer
   */
  createBridgesHighlightLayer() {
    if (!this.networkData) return null;

    const bridgeIds = this.networkAnalyzer.analysis.topology.bridges;

    // Filter network data to only show bridges
    const bridgeFeatures = {
      type: 'FeatureCollection',
      features: this.networkData.features.filter(f => bridgeIds.includes(f.properties?.id))
    };

    return new deck.GeoJsonLayer({
      id: 'bridges-highlight-layer',
      data: bridgeFeatures,
      stroked: true,
      filled: false,
      lineWidthMinPixels: 4,

      getLineColor: [168, 85, 247, 255], // Purple
      getLineWidth: 6,

      pickable: true,
      autoHighlight: true,
      highlightColor: [236, 72, 153, 200]
    });
  }

  /**
   * Handle click on problem marker
   */
  handleProblemClick(info) {
    if (!info.object) return;

    const problem = info.object;
    this.showImageryViewer(problem.coords, problem.type);
  }

  /**
   * Create main network layer
   */
  createNetworkLayer() {
    const {GeoJsonLayer} = deck;

    return new GeoJsonLayer({
      id: 'network-layer',
      data: this.networkData,

      // Styling
      stroked: true,
      filled: false,
      lineWidthMinPixels: 2,
      lineWidthMaxPixels: 10,

      // Dynamic properties
      getLineColor: d => this.getQualityColor(d.properties.quality),
      getLineWidth: d => this.getQualityWidth(d.properties.quality),

      // Interactivity
      pickable: true,
      autoHighlight: true,
      highlightColor: [139, 92, 246, 128],

      // Transitions
      transitions: {
        getLineColor: {
          duration: 300,
          easing: d3.easeCubicInOut
        },
        getLineWidth: {
          duration: 300,
          easing: d3.easeCubicInOut
        }
      },

      // Update triggers
      updateTriggers: {
        getLineColor: [this.stateManager.getState('filters')],
        getLineWidth: [this.stateManager.getState('filters')]
      }
    });
  }

  /**
   * Create OSM layer (for flicker mode)
   * @param {Object} osmDataOverride - Optional OSM data to use (for viewport-aware rendering)
   */
  createOSMLayer(osmDataOverride = null) {
    const {GeoJsonLayer} = deck;
    const dataToUse = osmDataOverride || this.osmData;

    return new GeoJsonLayer({
      id: 'osm-layer',
      data: dataToUse,

      // Styling
      stroked: true,
      filled: false,
      lineWidthMinPixels: 3,

      getLineColor: [99, 102, 241, 255], // Indigo for OSM in flicker mode
      getLineWidth: 4,

      // Interactivity
      pickable: true,
      autoHighlight: true,
      highlightColor: [139, 92, 246, 128],

      // Transitions
      transitions: {
        getLineColor: { duration: 300 },
        getLineWidth: { duration: 300 }
      },

      // Update trigger based on viewport changes
      updateTriggers: {
        data: [this.viewState.longitude, this.viewState.latitude, this.viewState.zoom]
      }
    });
  }

  /**
   * Create OSM overlay layer (for overlay comparison mode)
   * @param {Object} osmDataOverride - Optional OSM data to use (for viewport-aware rendering)
   */
  createOSMOverlayLayer(osmDataOverride = null) {
    const {GeoJsonLayer} = deck;
    const dataToUse = osmDataOverride || this.osmData;

    return new GeoJsonLayer({
      id: 'osm-overlay-layer',
      data: dataToUse,

      // Styling - orange for OSM-only segments
      stroked: true,
      filled: false,
      lineWidthMinPixels: 2,
      getDashArray: [6, 3],

      getLineColor: [249, 115, 22, 200], // Orange - OSM only
      getLineWidth: 3,

      // Semi-transparent
      opacity: 0.8,

      // Interactivity
      pickable: true,
      autoHighlight: true,
      highlightColor: [249, 115, 22, 128],

      // Update trigger based on viewport changes
      updateTriggers: {
        data: [this.viewState.longitude, this.viewState.latitude, this.viewState.zoom]
      }
    });
  }

  /**
   * Create network overlay layer (for overlay comparison mode)
   * Color-codes based on match type
   */
  createNetworkOverlayLayer() {
    const {GeoJsonLayer} = deck;

    return new GeoJsonLayer({
      id: 'network-overlay-layer',
      data: this.networkData,

      // Styling
      stroked: true,
      filled: false,
      lineWidthMinPixels: 2,

      // Color based on match type
      getLineColor: d => this.getComparisonColor(d.properties),
      getLineWidth: d => d.properties.osmMatch ? 4 : 3,

      // Interactivity
      pickable: true,
      autoHighlight: true,
      highlightColor: [139, 92, 246, 128],

      // Transitions
      transitions: {
        getLineColor: { duration: 300 },
        getLineWidth: { duration: 300 }
      },

      // Update triggers
      updateTriggers: {
        getLineColor: [this.networkData],
        getLineWidth: [this.networkData]
      }
    });
  }

  /**
   * Get color based on comparison result
   * @param {Object} properties - Feature properties
   * @returns {Array} RGBA color
   */
  getComparisonColor(properties) {
    if (!properties.osmMatch) {
      // Tile2Net only (not in OSM)
      return [59, 130, 246, 255]; // Blue
    } else if (properties.matchType === 'exact') {
      // Exact match
      return [16, 185, 129, 255]; // Green
    } else if (properties.matchType === 'geometry-mismatch') {
      // Exists in both but geometry differs
      return [168, 85, 247, 255]; // Purple
    } else {
      // Default match
      return [16, 185, 129, 255]; // Green
    }
  }

  /**
   * Get color based on quality score
   * @param {Number} quality - Quality score (0-1)
   * @returns {Array} RGBA color
   */
  getQualityColor(quality) {
    if (!quality && quality !== 0) quality = 0.5;

    // Quality gradient: Red → Orange → Yellow → Cyan → Green
    if (quality >= 0.8) return [16, 185, 129, 255];     // Excellent - Emerald
    if (quality >= 0.6) return [6, 182, 212, 255];      // Good - Cyan
    if (quality >= 0.4) return [245, 158, 11, 255];     // Fair - Amber
    if (quality >= 0.2) return [249, 115, 22, 255];     // Poor - Orange
    return [239, 68, 68, 255];                          // Critical - Red
  }

  /**
   * Get line width based on quality
   * @param {Number} quality - Quality score (0-1)
   * @returns {Number} Width in pixels
   */
  getQualityWidth(quality) {
    if (!quality && quality !== 0) quality = 0.5;
    // Higher quality = thicker line (2-8 pixels)
    return 2 + (quality * 6);
  }

  /**
   * Handle view state changes
   */
  handleViewStateChange({viewState, interactionState, oldViewState}) {
    const previousViewState = this.viewState;
    this.viewState = viewState;

    // Check if we need to update OSM overlay (significant movement or zoom change)
    const shouldUpdateOSM = this.comparisonMode === 'overlay' || this.comparisonMode === 'flicker';
    if (shouldUpdateOSM) {
      // Check for ANY zoom change (zoom affects viewport size significantly)
      const zoomed = Math.abs(viewState.zoom - previousViewState.zoom) > 0.05;

      // Check for significant pan movement (relative to current zoom)
      // Use actual viewport dimensions for threshold calculation
      const bounds = this.getViewportBounds();
      const lngRange = bounds.maxLng - bounds.minLng;
      const latRange = bounds.maxLat - bounds.minLat;
      const panThresholdLng = lngRange * 0.1; // 10% of visible range
      const panThresholdLat = latRange * 0.1;

      const moved = Math.abs(viewState.longitude - previousViewState.longitude) > panThresholdLng ||
                    Math.abs(viewState.latitude - previousViewState.latitude) > panThresholdLat;

      if (moved || zoomed) {
        // Debounce the OSM update
        if (this._osmUpdateTimeout) {
          clearTimeout(this._osmUpdateTimeout);
        }
        this._osmUpdateTimeout = setTimeout(() => {
          // Invalidate cached bounds to force regeneration
          this.lastOSMBounds = null;
          this.updateLayers();
          this._osmUpdateTimeout = null;
        }, 50); // Very fast response time
      }
    }

    // Update state manager (debounced)
    if (!this._updateTimeout) {
      this._updateTimeout = setTimeout(() => {
        if (!this._suppressStateUpdate) {
          this.stateManager.batchUpdate({
            'viewport.center': [viewState.latitude, viewState.longitude],
            'viewport.zoom': viewState.zoom
          });
        }
        this._updateTimeout = null;
      }, 100);
    }
  }

  /**
   * Handle click on network
   */
  handleClick(info, event) {
    if (!info.object) {
      // Clicked on empty space - clear selection
      this.stateManager.updateState('selection.networkSegments', []);
      this.updateDetailPanel(null);
      return;
    }

    const feature = info.object;
    const segmentId = feature.properties.id;

    // Toggle selection
    const currentSelection = this.stateManager.getState('selection.networkSegments');
    const isSelected = currentSelection.includes(segmentId);

    const newSelection = isSelected
      ? currentSelection.filter(id => id !== segmentId)
      : [...currentSelection, segmentId];

    this.stateManager.updateState('selection.networkSegments', newSelection);

    // Update detail panel
    this.updateDetailPanel(feature.properties);
  }

  /**
   * Handle hover over network
   */
  handleHover(info, event) {
    if (!info.object) {
      this.hideTooltip();
      this.stateManager.updateState('selection.hoverTarget', null);
      return;
    }

    const feature = info.object;

    // Update hover state
    this.stateManager.updateState('selection.hoverTarget', {
      type: 'network',
      id: feature.properties.id,
      data: feature.properties
    });

    // Show tooltip
    this.showTooltip(info, feature.properties);
  }

  /**
   * Show tooltip
   */
  showTooltip(info, properties) {
    const tooltip = this.getOrCreateTooltip();

    const quality = properties.quality || 0.5;
    const qualityLabel = this.getQualityLabel(quality);
    const qualityColor = this.getQualityColorHex(quality);

    tooltip.innerHTML = `
      <div class="glass-panel-elevated" style="padding: 12px; min-width: 200px;">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
          <div style="width: 12px; height: 12px; border-radius: 50%; background: ${qualityColor}; box-shadow: 0 0 10px ${qualityColor};"></div>
          <strong style="font-size: 14px;">Segment ${properties.id}</strong>
        </div>
        <div style="display: grid; grid-template-columns: auto 1fr; gap: 8px 12px; font-size: 13px;">
          <span style="color: var(--color-text-secondary);">Quality:</span>
          <span style="color: ${qualityColor}; font-weight: 600;">${(quality * 100).toFixed(1)}% (${qualityLabel})</span>

          <span style="color: var(--color-text-secondary);">Length:</span>
          <span>${properties.length ? properties.length.toFixed(1) + 'm' : 'N/A'}</span>

          <span style="color: var(--color-text-secondary);">Type:</span>
          <span style="text-transform: capitalize;">${properties.type || 'sidewalk'}</span>

          ${properties.osmMatch !== undefined ? `
            <span style="color: var(--color-text-secondary);">OSM Match:</span>
            <span>${properties.osmMatch ? '✓ Yes' : '✗ No'}</span>
          ` : ''}
        </div>
      </div>
    `;

    tooltip.style.left = (info.x + 15) + 'px';
    tooltip.style.top = (info.y - 10) + 'px';
    tooltip.style.opacity = '1';
    tooltip.style.pointerEvents = 'none';
  }

  /**
   * Hide tooltip
   */
  hideTooltip() {
    const tooltip = document.getElementById('deck-tooltip');
    if (tooltip) {
      tooltip.style.opacity = '0';
    }
  }

  /**
   * Get or create tooltip element
   */
  getOrCreateTooltip() {
    let tooltip = document.getElementById('deck-tooltip');
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.id = 'deck-tooltip';
      tooltip.style.position = 'fixed';
      tooltip.style.zIndex = '10000';
      tooltip.style.opacity = '0';
      tooltip.style.transition = 'opacity 0.2s';
      document.body.appendChild(tooltip);
    }
    return tooltip;
  }

  /**
   * Get quality label
   */
  getQualityLabel(quality) {
    if (quality >= 0.8) return 'Excellent';
    if (quality >= 0.6) return 'Good';
    if (quality >= 0.4) return 'Fair';
    if (quality >= 0.2) return 'Poor';
    return 'Critical';
  }

  /**
   * Get quality color as hex
   */
  getQualityColorHex(quality) {
    if (quality >= 0.8) return '#10b981';
    if (quality >= 0.6) return '#06b6d4';
    if (quality >= 0.4) return '#f59e0b';
    if (quality >= 0.2) return '#f97316';
    return '#ef4444';
  }

  /**
   * Update detail panel
   */
  updateDetailPanel(properties) {
    const contextInfo = document.getElementById('context-info');
    if (!contextInfo) return;

    if (!properties) {
      contextInfo.innerHTML = `
        <p class="info-message" style="color: var(--color-text-secondary); font-size: 14px; text-align: center; padding: 20px;">
          Click on a network segment to see details
        </p>
      `;
      return;
    }

    const quality = properties.quality || 0.5;
    const qualityLabel = this.getQualityLabel(quality);
    const qualityColor = this.getQualityColorHex(quality);

    contextInfo.innerHTML = `
      <div class="glass-panel-elevated" style="padding: 16px;">
        <h3 style="margin: 0 0 16px 0; font-size: 16px; font-weight: 600; color: var(--color-text-primary);">
          Network Segment Details
        </h3>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
          <div>
            <div style="font-size: 12px; color: var(--color-text-secondary); margin-bottom: 4px;">Segment ID</div>
            <div style="font-size: 14px; font-weight: 500; font-family: var(--font-monospace);">${properties.id}</div>
          </div>
          <div>
            <div style="font-size: 12px; color: var(--color-text-secondary); margin-bottom: 4px;">Quality Score</div>
            <div style="font-size: 14px; font-weight: 600; color: ${qualityColor};">
              ${(quality * 100).toFixed(1)}% (${qualityLabel})
            </div>
          </div>
          <div>
            <div style="font-size: 12px; color: var(--color-text-secondary); margin-bottom: 4px;">Length</div>
            <div style="font-size: 14px; font-weight: 500;">${properties.length ? properties.length.toFixed(1) + ' meters' : 'N/A'}</div>
          </div>
          <div>
            <div style="font-size: 12px; color: var(--color-text-secondary); margin-bottom: 4px;">Type</div>
            <div style="font-size: 14px; font-weight: 500; text-transform: capitalize;">${properties.type || 'sidewalk'}</div>
          </div>
          ${properties.osmMatch !== undefined ? `
            <div>
              <div style="font-size: 12px; color: var(--color-text-secondary); margin-bottom: 4px;">OSM Match</div>
              <div style="font-size: 14px; font-weight: 500;">
                ${properties.osmMatch ?
                  '<span style="color: #10b981;">✓ Matches OSM</span>' :
                  '<span style="color: #ef4444;">✗ No OSM match</span>'
                }
              </div>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  /**
   * Update network statistics
   */
  updateNetworkStatistics(geojson) {
    const segments = geojson.features;
    const totalSegments = segments.length;

    // Calculate average quality
    const avgQuality = segments.reduce((sum, f) => {
      return sum + (f.properties.quality || 0.5);
    }, 0) / totalSegments;

    // Count OSM matches
    const osmMatches = segments.filter(f => f.properties.osmMatch).length;
    const completeness = (osmMatches / totalSegments) * 100;

    // Update state
    this.stateManager.batchUpdate({
      'data.statistics.networkMetrics.totalSegments': totalSegments,
      'data.statistics.networkMetrics.completeness': completeness,
      'data.network.tile2net': geojson
    });

    // Update UI
    this.updateStatisticsUI(totalSegments, avgQuality, completeness);
  }

  /**
   * Update statistics in UI
   */
  updateStatisticsUI(totalSegments, avgQuality, completeness) {
    const segmentsStat = document.getElementById('stat-segments');
    const connectivityStat = document.getElementById('stat-connectivity');

    if (segmentsStat) {
      segmentsStat.textContent = totalSegments;
    }

    if (connectivityStat) {
      connectivityStat.textContent = (avgQuality * 100).toFixed(1) + '%';
    }
  }

  /**
   * Set view programmatically (for sync)
   */
  setView(center, zoom) {
    this._suppressStateUpdate = true;

    this.viewState = {
      ...this.viewState,
      latitude: center[0],
      longitude: center[1],
      zoom: zoom,
      transitionDuration: 300,
      transitionEasing: d3.easeCubicOut
    };

    this.deckgl.setProps({
      initialViewState: this.viewState
    });

    setTimeout(() => {
      this._suppressStateUpdate = false;
    }, 400);
  }

  /**
   * Get current view state
   */
  getViewState() {
    return this.viewState;
  }

  /**
   * Subscribe to state changes
   */
  subscribeToState() {
    // Listen for comparison mode changes
    this.stateManager.subscribe((state, path) => {
      if (path === 'ui.comparisonMode') {
        this.updateLayers();
      }
    }, 'ui');

    // Listen for filter changes
    this.stateManager.subscribe((state, path) => {
      if (path.startsWith('filters.')) {
        this.updateLayers();
      }
    }, 'filters');
  }

  /**
   * Cleanup
   */
  destroy() {
    if (this.deckgl) {
      this.deckgl.finalize();
    }
  }
}

// Make available globally
if (typeof window !== 'undefined') {
  window.ModernNetworkPanel = ModernNetworkPanel;
}
