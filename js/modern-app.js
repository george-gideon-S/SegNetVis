/**
 * Modern Pedestrian Network Inspector - Main Application
 * Two-section layout: Idea A (Segmentation Detective) + Idea B (Network Inspector)
 */

class ModernPedestrianNetworkInspector {
  constructor() {
    // Mapbox token
    this.mapboxToken = '## Paste your TOKEN here!';

    // Maps
    this.segmentationMap = null;  // Left map - segmentation overlay
    this.errorMap = null;         // Right map - error/confusion overlay
    this.networkMap = null;       // Bottom section - network view

    // Overlays
    this.segOverlay = null;       // Segmentation overlay for left map
    this.errorOverlay = null;     // Error overlay for right map

    // Magnification lens
    this.magLens = null;

    // State
    this.stateManager = null;

    // Configuration
    this.config = {
      center: [-73.9857, 40.7484], // [lng, lat] for Mapbox
      zoom: 16,
      // Different styles for different maps
      segmentationStyle: 'mapbox://styles/mapbox/streets-v12',  // Street map for left panel
      errorStyle: 'mapbox://styles/mapbox/dark-v11',            // Dark for error visualization
      networkStyle: 'mapbox://styles/mapbox/dark-v11'           // Dark for network
    };

    // Sync state
    this.syncing = false;

    // OSM overlay state for viewport-aware updates
    this.osmOverlayActive = false;
    this.lastOSMFetchBounds = null;
    this.osmMoveHandler = null;

    this.init();
  }

  /**
   * Initialize application
   */
  async init() {
    console.log('🚀 Initializing Modern Pedestrian Network Inspector...');

    try {
      this.showLoading('Initializing...');

      // Set Mapbox token
      mapboxgl.accessToken = this.mapboxToken;

      // Initialize state manager
      this.initStateManager();

      // Load configuration
      await this.loadConfiguration();

      // Initialize maps (Idea A dual maps + Idea B network map)
      await this.initMaps();

      // Initialize overlays
      this.initOverlays();

      // Setup controls
      this.setupControls();

      // Initial statistics
      this.updateStatistics();

      // CRITICAL: Ensure filter panel is visible after initialization
      this.ensureFilterPanelVisible();

      // Set up keyboard shortcuts
      this.setupKeyboardShortcuts();

      // Initialize settings manager
      this.initSettingsManager();

      // Initialize export manager
      this.initExportManager();

      // Listen for synthetic data usage
      this.syntheticDataWarningShown = false;
      document.addEventListener('syntheticDataUsed', (e) => {
        if (!this.syntheticDataWarningShown) {
          this.syntheticDataWarningShown = true;
          this.showSyntheticDataWarning();
          console.warn('⚠️ Using synthetic demo data:', e.detail);
        }
      });

      this.hideLoading();
      this.showToast('Ready', 'Pedestrian Network Inspector loaded. Press H for keyboard shortcuts.', 'success');

      console.log('✅ Application initialized');

    } catch (error) {
      console.error('❌ Initialization failed:', error);
      this.hideLoading();
      this.showToast('Error', 'Failed to initialize: ' + error.message, 'error');
    }
  }

  /**
   * Initialize state manager
   */
  initStateManager() {
    if (typeof StateManager !== 'undefined') {
      this.stateManager = new StateManager();
    } else {
      // Minimal state manager fallback
      this.stateManager = {
        state: {},
        getState: (path) => this.state[path],
        updateState: (path, value) => { this.state[path] = value; },
        subscribe: () => {}
      };
    }
    console.log('✓ State manager initialized');
  }

  /**
   * Initialize settings manager
   */
  initSettingsManager() {
    if (typeof SettingsManager !== 'undefined') {
      this.settingsManager = new SettingsManager(this.stateManager);
      console.log('✓ Settings manager initialized');
    } else {
      console.warn('SettingsManager not found, settings panel disabled');
    }
  }

  /**
   * Initialize export manager
   */
  initExportManager() {
    if (typeof ExportManager !== 'undefined') {
      this.exportManager = new ExportManager(this.stateManager);

      // Setup export FAB and menu
      const exportFab = document.getElementById('export-fab');
      const exportMenu = document.getElementById('export-menu');

      if (exportFab && exportMenu) {
        // Toggle menu on FAB click
        exportFab.addEventListener('click', () => {
          const isVisible = exportMenu.style.display !== 'none';
          exportMenu.style.display = isVisible ? 'none' : 'block';
          exportFab.classList.toggle('active', !isVisible);
        });

        // Handle menu item clicks
        exportMenu.querySelectorAll('.export-menu-item').forEach(item => {
          item.addEventListener('click', () => {
            const exportType = item.dataset.export;
            this.handleExport(exportType);
            exportMenu.style.display = 'none';
            exportFab.classList.remove('active');
          });
        });

        // Close menu when clicking outside
        document.addEventListener('click', (e) => {
          if (!exportFab.contains(e.target) && !exportMenu.contains(e.target)) {
            exportMenu.style.display = 'none';
            exportFab.classList.remove('active');
          }
        });
      }

      console.log('✓ Export manager initialized');
    } else {
      console.warn('ExportManager not found, export features disabled');
    }
  }

  /**
   * Handle export requests
   */
  handleExport(type) {
    if (!this.exportManager) return;

    switch (type) {
      case 'network-geojson':
        this.exportManager.exportNetwork('geojson');
        break;
      case 'network-csv':
        this.exportManager.exportNetwork('csv');
        break;
      case 'errors':
        this.exportManager.exportErrors('json');
        break;
      case 'report':
        this.exportManager.exportReport('html');
        break;
      case 'screenshot-seg':
        this.exportManager.exportScreenshot('segmentation');
        break;
      case 'screenshot-net':
        this.exportManager.exportScreenshot('network');
        break;
      default:
        console.warn('Unknown export type:', type);
    }
  }

  /**
   * Load configuration
   */
  async loadConfiguration() {
    try {
      const response = await fetch('data/config.json');
      if (response.ok) {
        const config = await response.json();
        if (config.extent?.center) {
          this.config.center = [config.extent.center[1], config.extent.center[0]]; // Convert [lat, lng] to [lng, lat]
        }
        console.log('✓ Configuration loaded');
      }
    } catch (e) {
      console.warn('Using default configuration');
    }
  }

  /**
   * Initialize all maps
   */
  async initMaps() {
    this.showLoading('Creating maps...');

    try {
      // Create segmentation map (left - Idea A) - STREET basemap for real context
      this.segmentationMap = new mapboxgl.Map({
        container: 'segmentation-map',
        style: this.config.segmentationStyle,
        center: this.config.center,
        zoom: this.config.zoom,
        attributionControl: false
      });

      // Create error map (right - Idea A) - DARK for error visualization contrast
      this.errorMap = new mapboxgl.Map({
        container: 'error-map',
        style: this.config.errorStyle,
        center: this.config.center,
        zoom: this.config.zoom,
        attributionControl: false
      });

      // Create network map (Idea B) - DARK for network visualization
      this.networkMap = new mapboxgl.Map({
        container: 'network-map',
        style: this.config.networkStyle,
        center: this.config.center,
        zoom: this.config.zoom,
        attributionControl: false
      });

      console.log('Maps created, waiting for load...');

      // Wait for all maps to load
      await Promise.all([
        this.waitForMapLoad(this.segmentationMap),
        this.waitForMapLoad(this.errorMap),
        this.waitForMapLoad(this.networkMap)
      ]);
    } catch (error) {
      console.error('❌ Failed to initialize maps:', error);
      this.hideLoading();
      this.showToast('Map Error', error.message, 'error');
      throw error;
    }

    // Synchronize the two Idea A maps
    this.setupMapSync();

    // Add navigation controls with reset view functionality
    // The compass icon resets bearing to north when clicked
    // showCompass: true enables the compass/reset button
    const navControlOptions = {
      showCompass: true,
      showZoom: true,
      visualizePitch: true
    };

    this.segmentationMap.addControl(new mapboxgl.NavigationControl(navControlOptions), 'top-left');
    this.errorMap.addControl(new mapboxgl.NavigationControl(navControlOptions), 'top-left');
    this.networkMap.addControl(new mapboxgl.NavigationControl(navControlOptions), 'top-left');

    // Set strict zoom limits for Idea A maps (keep overlays stable)
    this.setupZoomLimits();

    // Add zoom level indicator to Idea A
    this.setupZoomIndicator();

    // Add zoom limits and indicator to Idea B (network map)
    this.setupNetworkMapZoomLimits();
    this.setupNetworkZoomIndicator();

    // Add double-click to reset view behavior
    this.setupMapResetBehavior();

    // Add custom compass control
    this.setupCompassControl();

    console.log('✓ All maps initialized');
  }

  /**
   * Set up strict zoom limits for Idea A maps
   * Range: 14.95 (min) to 17.8 (max)
   * UI displays normalized scale 2-5
   */
  setupZoomLimits() {
    // Zoom range: level 2 to level 5
    this.zoomConfig = {
      min: 14.95,  // Level 2 (zoomed out limit)
      max: 17.8,   // Level 5 (zoomed in - detail view)
      default: 16.0 // Middle of range
    };

    // Apply to both Idea A maps
    this.segmentationMap.setMinZoom(this.zoomConfig.min);
    this.segmentationMap.setMaxZoom(this.zoomConfig.max);
    this.errorMap.setMinZoom(this.zoomConfig.min);
    this.errorMap.setMaxZoom(this.zoomConfig.max);

    // Set initial zoom to middle of range if outside bounds
    const currentZoom = this.segmentationMap.getZoom();
    if (currentZoom < this.zoomConfig.min || currentZoom > this.zoomConfig.max) {
      this.segmentationMap.setZoom(this.zoomConfig.default);
      this.errorMap.setZoom(this.zoomConfig.default);
    }

    console.log(`✓ Zoom limits set: ${this.zoomConfig.min} - ${this.zoomConfig.max} (normalized 2-5)`);
  }

  /**
   * Convert raw zoom level to normalized scale (2-5)
   */
  zoomToNormalized(zoom) {
    const { min, max } = this.zoomConfig;
    // Linear mapping: min -> 2, max -> 5
    const normalized = 2 + ((zoom - min) / (max - min)) * 3;
    return Math.max(2, Math.min(5, normalized));
  }

  /**
   * Convert normalized scale (2-5) to raw zoom level
   */
  normalizedToZoom(level) {
    const { min, max } = this.zoomConfig;
    // Linear mapping: 2 -> min, 5 -> max
    return min + ((level - 2) / 3) * (max - min);
  }

  /**
   * Set up zoom level indicator UI with normalized 2-5 scale
   */
  setupZoomIndicator() {
    // Create zoom indicator element for the segmentation panel
    const zoomIndicator = document.createElement('div');
    zoomIndicator.className = 'zoom-indicator';
    zoomIndicator.innerHTML = `
      <div class="zoom-indicator-title">Zoom Level</div>
      <div class="zoom-bar-container">
        <div class="zoom-bar-track">
          <div class="zoom-bar-fill" id="zoom-fill"></div>
          <div class="zoom-bar-handle" id="zoom-handle"></div>
        </div>
        <div class="zoom-labels">
          <span class="zoom-min">2</span>
          <span class="zoom-current" id="zoom-current">3</span>
          <span class="zoom-max">5</span>
        </div>
        <div class="zoom-ticks">
          <span class="zoom-tick" data-level="2">2</span>
          <span class="zoom-tick" data-level="3">3</span>
          <span class="zoom-tick" data-level="4">4</span>
          <span class="zoom-tick" data-level="5">5</span>
        </div>
      </div>
      <div class="zoom-limit-hint">
        <span class="limit-reached" id="limit-min" style="display:none">← Min</span>
        <span class="limit-reached" id="limit-max" style="display:none">Max →</span>
      </div>
    `;

    // Add to the segmentation panel
    const segPanel = document.getElementById('seg-map-panel');
    if (segPanel) {
      segPanel.appendChild(zoomIndicator);
    }

    // Make ticks clickable
    const ticks = zoomIndicator.querySelectorAll('.zoom-tick');
    ticks.forEach(tick => {
      tick.addEventListener('click', () => {
        const level = parseInt(tick.dataset.level);
        const targetZoom = this.normalizedToZoom(level);
        this.segmentationMap.zoomTo(targetZoom, { duration: 300 });
      });
    });

    // Update indicator on zoom
    const updateZoomIndicator = () => {
      const zoom = this.segmentationMap.getZoom();
      const normalized = this.zoomToNormalized(zoom);
      const percent = ((normalized - 2) / 3) * 100;

      const fill = document.getElementById('zoom-fill');
      const handle = document.getElementById('zoom-handle');
      const current = document.getElementById('zoom-current');
      const limitMin = document.getElementById('limit-min');
      const limitMax = document.getElementById('limit-max');

      if (fill) fill.style.width = percent + '%';
      if (handle) handle.style.left = percent + '%';
      if (current) current.textContent = normalized.toFixed(1);

      // Show limit indicators
      const atMin = zoom <= this.zoomConfig.min + 0.05;
      const atMax = zoom >= this.zoomConfig.max - 0.05;

      if (limitMin) limitMin.style.display = atMin ? 'inline' : 'none';
      if (limitMax) limitMax.style.display = atMax ? 'inline' : 'none';

      // Highlight current tick
      ticks.forEach(tick => {
        const tickLevel = parseInt(tick.dataset.level);
        tick.classList.toggle('active', Math.abs(normalized - tickLevel) < 0.5);
      });
    };

    this.segmentationMap.on('zoom', updateZoomIndicator);
    updateZoomIndicator(); // Initial update
  }

  /**
   * Set up zoom limits for Idea B network map
   */
  setupNetworkMapZoomLimits() {
    // Same zoom config as Idea A for consistency
    this.networkMap.setMinZoom(this.zoomConfig.min);
    this.networkMap.setMaxZoom(this.zoomConfig.max);

    // Set initial zoom if outside bounds
    const currentZoom = this.networkMap.getZoom();
    if (currentZoom < this.zoomConfig.min || currentZoom > this.zoomConfig.max) {
      this.networkMap.setZoom(this.zoomConfig.default);
    }

    // Note: Network layer is generated once with full coverage
    // No need to regenerate on viewport changes

    console.log('✓ Network map zoom limits set');
  }

  /**
   * Set up zoom indicator for Idea B network map
   */
  setupNetworkZoomIndicator() {
    // Create zoom indicator element for the network map container
    const zoomIndicator = document.createElement('div');
    zoomIndicator.className = 'zoom-indicator zoom-indicator-network';
    zoomIndicator.id = 'network-zoom-indicator';
    zoomIndicator.innerHTML = `
      <div class="zoom-indicator-title">ZOOM LEVEL</div>
      <div class="zoom-bar-container">
        <input type="range" class="zoom-slider" id="network-zoom-slider"
               min="2" max="5" step="0.1" value="3">
        <div class="zoom-value-display" id="network-zoom-value">3.0</div>
        <div class="zoom-ticks">
          <span class="zoom-tick" data-level="2">2</span>
          <span class="zoom-tick" data-level="3">3</span>
          <span class="zoom-tick" data-level="4">4</span>
          <span class="zoom-tick" data-level="5">5</span>
        </div>
      </div>
    `;

    // Add to the network map container
    const networkContainer = document.querySelector('.network-map-container');
    if (networkContainer) {
      networkContainer.appendChild(zoomIndicator);
    }

    // Get elements
    const slider = document.getElementById('network-zoom-slider');
    const valueDisplay = document.getElementById('network-zoom-value');
    const ticks = zoomIndicator.querySelectorAll('.zoom-tick');

    // Slider input handler
    if (slider) {
      slider.addEventListener('input', (e) => {
        const level = parseFloat(e.target.value);
        const targetZoom = this.normalizedToZoom(level);
        this.networkMap.zoomTo(targetZoom, { duration: 200 });
      });
    }

    // Make ticks clickable
    ticks.forEach(tick => {
      tick.addEventListener('click', () => {
        const level = parseInt(tick.dataset.level);
        const targetZoom = this.normalizedToZoom(level);
        this.networkMap.zoomTo(targetZoom, { duration: 300 });
      });
    });

    // Update indicator on zoom
    const updateNetworkZoomIndicator = () => {
      const zoom = this.networkMap.getZoom();
      const normalized = this.zoomToNormalized(zoom);

      if (slider) slider.value = normalized;
      if (valueDisplay) valueDisplay.textContent = normalized.toFixed(1);

      // Highlight current tick
      ticks.forEach(tick => {
        const tickLevel = parseInt(tick.dataset.level);
        tick.classList.toggle('active', Math.abs(normalized - tickLevel) < 0.5);
      });
    };

    this.networkMap.on('zoom', updateNetworkZoomIndicator);
    updateNetworkZoomIndicator(); // Initial update

    console.log('✓ Network map zoom indicator added');
  }

  /**
   * Wait for a map to finish loading with timeout and error handling
   */
  waitForMapLoad(map) {
    return new Promise((resolve, reject) => {
      // Timeout after 30 seconds
      const timeout = setTimeout(() => {
        reject(new Error('Map load timeout - check your internet connection and Mapbox token'));
      }, 30000);

      if (map.loaded()) {
        clearTimeout(timeout);
        resolve();
      } else {
        map.on('load', () => {
          clearTimeout(timeout);
          resolve();
        });
        map.on('error', (e) => {
          clearTimeout(timeout);
          console.error('Map load error:', e);
          reject(new Error(`Map failed to load: ${e.error?.message || 'Unknown error'}`));
        });
      }
    });
  }

  /**
   * Synchronize the segmentation and error maps
   */
  setupMapSync() {
    const syncMaps = (sourceMap, targetMap) => {
      if (this.syncing) return;
      this.syncing = true;

      targetMap.setCenter(sourceMap.getCenter());
      targetMap.setZoom(sourceMap.getZoom());
      targetMap.setBearing(sourceMap.getBearing());
      targetMap.setPitch(sourceMap.getPitch());

      this.syncing = false;
    };

    // Sync segmentation -> error
    this.segmentationMap.on('move', () => {
      syncMaps(this.segmentationMap, this.errorMap);
    });

    // Sync error -> segmentation
    this.errorMap.on('move', () => {
      syncMaps(this.errorMap, this.segmentationMap);
    });

    console.log('✓ Map sync enabled');
  }

  /**
   * Set up custom compass control for orientation
   */
  setupCompassControl() {
    // Create compass element
    const compass = document.createElement('div');
    compass.className = 'compass-control';
    compass.title = 'Click to reset to North. Click again to cycle orientations.';
    compass.innerHTML = `
      <div class="compass-needle">
        <svg viewBox="0 0 24 24" fill="none">
          <!-- North pointer (red) -->
          <path d="M12 2 L15 12 L12 10 L9 12 Z" fill="#ef4444"/>
          <!-- South pointer (white) -->
          <path d="M12 22 L15 12 L12 14 L9 12 Z" fill="#94a3b8"/>
        </svg>
      </div>
      <span class="compass-label north">N</span>
    `;

    // Add to segmentation panel
    const segPanel = document.getElementById('seg-map-panel');
    if (segPanel) {
      segPanel.appendChild(compass);
    }

    // Track orientation state for cycling
    this.orientationIndex = 0;
    const orientations = [0, 90, 180, 270]; // N, E, S, W

    // Click handler - cycle through orientations or reset to north
    compass.addEventListener('click', () => {
      const currentBearing = this.segmentationMap.getBearing();

      // If not aligned to a cardinal direction, reset to north
      if (Math.abs(currentBearing % 90) > 5) {
        this.orientationIndex = 0;
      } else {
        // Cycle to next orientation
        this.orientationIndex = (this.orientationIndex + 1) % orientations.length;
      }

      const newBearing = orientations[this.orientationIndex];

      // Animate to new bearing
      this.segmentationMap.easeTo({
        bearing: newBearing,
        duration: 300
      });

      const directions = ['North', 'East', 'South', 'West'];
      this.showToast('Orientation', `Facing ${directions[this.orientationIndex]}`, 'info');
    });

    // Double-click to reset to default view entirely
    compass.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();

      this.orientationIndex = 0;
      this.segmentationMap.easeTo({
        center: this.config.center,
        zoom: this.config.zoom,
        bearing: 0,
        pitch: 0,
        duration: 500
      });

      this.showToast('View Reset', 'Map reset to default view', 'info');
    });

    // Update compass rotation based on map bearing
    const needle = compass.querySelector('.compass-needle');
    const updateCompass = () => {
      const bearing = this.segmentationMap.getBearing();
      if (needle) {
        needle.style.transform = `rotate(${-bearing}deg)`;
      }
    };

    this.segmentationMap.on('rotate', updateCompass);
    updateCompass(); // Initial update

    console.log('✓ Custom compass control added');
  }

  /**
   * Setup map reset behavior - compass resets to north, double-click on compass resets full view
   */
  setupMapResetBehavior() {
    const resetToDefault = (map) => {
      map.easeTo({
        center: this.config.center,
        zoom: this.config.zoom,
        bearing: 0,
        pitch: 0,
        duration: 500
      });
    };

    // The Mapbox NavigationControl compass already handles:
    // - Click: Reset bearing to 0 (north)
    // - The compass rotates to show current bearing
    //
    // We can add a keyboard shortcut for full reset
    document.addEventListener('keydown', (e) => {
      // Press 'R' to reset all maps to default view
      if (e.key === 'r' || e.key === 'R') {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        resetToDefault(this.segmentationMap);
        resetToDefault(this.errorMap);
        resetToDefault(this.networkMap);
        this.showToast('View Reset', 'Maps reset to default view (press R)', 'info');
      }
    });

    console.log('✓ Map reset behavior configured (press R to reset view)');
  }

  /**
   * Initialize segmentation overlays
   */
  initOverlays() {
    this.showLoading('Initializing overlays...');

    // Create segmentation overlay for left map (shows prediction/groundTruth)
    this.segOverlay = new ViewportSegmentationOverlay(
      this.segmentationMap,
      this.stateManager
    );
    this.segOverlay.setDisplayMode('prediction');

    // Create error overlay for right map (shows FP/FN/TP)
    this.errorOverlay = new ViewportSegmentationOverlay(
      this.errorMap,
      this.stateManager
    );
    this.errorOverlay.setDisplayMode('error');

    // Share segmentation data between overlays so they show the same content
    // When left overlay regenerates, copy data to right overlay
    this.setupOverlaySync();

    // Load network data for Idea B
    this.loadNetworkData();

    // Initialize magnification lens
    this.initMagnificationLens();

    console.log('✓ Overlays initialized');
  }

  /**
   * Initialize magnification lens for layer inspection
   */
  initMagnificationLens() {
    if (typeof MagnificationLens === 'undefined') {
      console.warn('MagnificationLens not loaded');
      return;
    }

    this.magLens = new MagnificationLens({
      containerId: 'seg-map-panel',
      segOverlay: this.segOverlay,
      map: this.segmentationMap,
      stateManager: this.stateManager,
      onStateChange: (state) => {
        // Sync the toggle button state
        const lensToggle = document.getElementById('lens-toggle');
        if (lensToggle) {
          lensToggle.classList.toggle('active', state.enabled);
        }
      }
    });

    console.log('✓ Magnification lens initialized');
  }

  /**
   * Set up synchronization between left and right overlays
   * Both overlays now render independently based on their map's state
   * They share the same error region definitions for consistency
   */
  setupOverlaySync() {
    // Share error regions between overlays so they show consistent FP/FN areas
    // Both overlays are initialized with the same map center, so their error regions
    // are already in the same geographic location

    // Copy the error regions from the left overlay to the right overlay
    // so they reference the exact same geographic areas
    this.errorOverlay.errorRegions = this.segOverlay.errorRegions;

    // Update statistics when either map finishes moving
    this.segmentationMap.on('moveend', () => {
      setTimeout(() => this.updateStatistics(), 200);
    });

    console.log('✓ Overlay sync configured');
  }

  /**
   * Load network data for Idea B
   *
   * STRATEGY:
   * - Load the REAL pedestrian network from Tile2Net pipeline data
   * - Load OSM network for comparison
   * - Extract nodes from actual intersections and endpoints
   * - Use the true geometry of sidewalks and paths as edges
   * - NO synthetic grid generation - data-driven only
   */
  async loadNetworkData() {
    console.log('🌐 Loading real pedestrian network data for Idea B');
    this.showLoading('Loading network data...');

    let networkData = null;

    // Load the real pedestrian network from Tile2Net pipeline
    try {
      const response = await fetch('data/sample/pedestrian-network.geojson');
      if (response.ok) {
        networkData = await response.json();
        console.log('✓ Loaded pedestrian network:', networkData.features?.length, 'features');
      } else {
        this.showNetworkLoadError('Failed to load pedestrian network: ' + response.status);
      }
    } catch (e) {
      console.warn('Could not load pedestrian network file:', e.message);
      this.showNetworkLoadError('Network file not found: ' + e.message);
    }

    // OSM network data will be fetched dynamically from Overpass API when OSM Overlay is enabled
    // This ensures the OSM data matches the current map viewport
    this.osmNetworkData = null;
    console.log('ℹ️ OSM data will be fetched dynamically from Overpass API when enabled');

    // Fallback: try the general network.geojson
    if (!networkData || !networkData.features || networkData.features.length < 5) {
      try {
        const response = await fetch('data/sample/network.geojson');
        if (response.ok) {
          const fallbackData = await response.json();
          if (fallbackData.features && fallbackData.features.length > 5) {
            networkData = fallbackData;
            console.log('✓ Loaded fallback network data:', networkData.features?.length, 'features');
          }
        }
      } catch (e) {
        console.warn('Could not load fallback network file:', e.message);
      }
    }

    if (!networkData || !networkData.features || networkData.features.length === 0) {
      console.error('❌ No network data available');
      this.showNetworkLoadError('No network data available. Please check data files.');
      this.hideLoading();
      return;
    }

    // OSM match statistics will be computed when OSM overlay is enabled
    // (OSM data is now fetched dynamically from Overpass API)

    console.log('✓ Network data ready:', networkData.features?.length, 'segments');

    // Store reference for later use
    this.networkData = networkData;

    // Extract graph nodes from the real network data
    this.extractNetworkGraph(networkData);

    // Compute network bounds for proper viewport fitting
    this.networkBounds = this.computeNetworkBounds(networkData);
    console.log('📐 Network bounds:', this.networkBounds);

    // Initialize semantic segmentation base layer for Network mode (canvas layer)
    // This will also set up the network graph overlay if data is already available
    this.initNetworkSegmentationLayer();

    // NOTE: Network graph is now derived dynamically from Mapbox vector tiles
    // No need to pass static GeoJSON data - the graph will automatically span
    // the entire visible viewport, updating on pan/zoom.

    // Fit map to initial center (canvas overlay handles all visual rendering)
    // No Mapbox layers needed - everything is rendered on canvas
    if (this.networkMap.loaded()) {
      this.fitMapToNetwork();
    } else {
      this.networkMap.once('load', () => {
        this.fitMapToNetwork();
      });
    }

    // Initialize analyzer for topology/quality analysis
    this.initNetworkAnalyzer(networkData);
  }

  /**
   * Compute bounding box of the network data
   */
  computeNetworkBounds(networkData) {
    let minLng = Infinity, maxLng = -Infinity;
    let minLat = Infinity, maxLat = -Infinity;

    for (const feature of networkData.features) {
      if (feature.geometry?.type !== 'LineString') continue;
      for (const coord of feature.geometry.coordinates) {
        const [lng, lat] = coord;
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }

    return {
      sw: [minLng, minLat],
      ne: [maxLng, maxLat],
      center: [(minLng + maxLng) / 2, (minLat + maxLat) / 2]
    };
  }

  /**
   * Fit the network map to show the full network extent
   */
  fitMapToNetwork() {
    if (!this.networkMap || !this.networkBounds) return;

    const { sw, ne } = this.networkBounds;

    // Add padding to show a bit beyond the network
    const padding = 0.002; // ~200m at this latitude

    this.networkMap.fitBounds(
      [[sw[0] - padding, sw[1] - padding], [ne[0] + padding, ne[1] + padding]],
      {
        padding: { top: 50, bottom: 50, left: 50, right: 50 },
        duration: 1000,
        maxZoom: 17
      }
    );

    console.log('📍 Map fitted to network bounds');
  }

  /**
   * Extract graph structure (nodes and edges) from real pedestrian network data
   * Nodes are placed at:
   * - Intersections (where 3+ segments share a coordinate)
   * - Junctions (where 2 segments meet)
   * - Endpoints (segment ends that don't connect to anything)
   */
  extractNetworkGraph(networkData) {
    console.log('📊 Extracting graph from real network data...');

    // Map to track all coordinates and which segments use them
    // Key: "lng,lat" (rounded for matching)
    // Value: { coord: [lng, lat], segmentIds: [], degree: number }
    const coordMap = new Map();

    // Tolerance for coordinate matching (in degrees, ~1m at this latitude)
    const tolerance = 0.00001;

    // Round coordinate for consistent matching
    const roundCoord = (coord) => {
      return [
        Math.round(coord[0] / tolerance) * tolerance,
        Math.round(coord[1] / tolerance) * tolerance
      ];
    };

    const coordKey = (coord) => {
      const rounded = roundCoord(coord);
      return `${rounded[0].toFixed(5)},${rounded[1].toFixed(5)}`;
    };

    // First pass: collect all endpoints from all segments
    for (const feature of networkData.features) {
      if (feature.geometry?.type !== 'LineString') continue;

      const coords = feature.geometry.coordinates;
      if (coords.length < 2) continue;

      const segmentId = feature.properties?.id || `seg_${Math.random().toString(36).substr(2, 9)}`;

      // Register start point
      const startKey = coordKey(coords[0]);
      if (!coordMap.has(startKey)) {
        coordMap.set(startKey, { coord: coords[0], segmentIds: [], degree: 0 });
      }
      coordMap.get(startKey).segmentIds.push(segmentId);
      coordMap.get(startKey).degree++;

      // Register end point
      const endKey = coordKey(coords[coords.length - 1]);
      if (!coordMap.has(endKey)) {
        coordMap.set(endKey, { coord: coords[coords.length - 1], segmentIds: [], degree: 0 });
      }
      coordMap.get(endKey).segmentIds.push(segmentId);
      coordMap.get(endKey).degree++;
    }

    // Build node list with classification
    const nodes = [];
    for (const [key, data] of coordMap) {
      const nodeType = data.degree >= 3 ? 'intersection' :
                       data.degree === 2 ? 'junction' :
                       'endpoint';

      nodes.push({
        id: key,
        coord: data.coord,
        type: nodeType,
        degree: data.degree,
        segmentIds: data.segmentIds
      });
    }

    // Store the extracted graph
    this.networkNodes = nodes;
    this.networkNodeMap = coordMap;

    // Create GeoJSON for nodes
    this.networkNodesGeoJSON = {
      type: 'FeatureCollection',
      features: nodes.map(node => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: node.coord
        },
        properties: {
          id: node.id,
          type: node.type,
          degree: node.degree
        }
      }))
    };

    console.log(`✓ Extracted ${nodes.length} nodes:`);
    console.log(`  - Intersections (3+ connections): ${nodes.filter(n => n.type === 'intersection').length}`);
    console.log(`  - Junctions (2 connections): ${nodes.filter(n => n.type === 'junction').length}`);
    console.log(`  - Endpoints (1 connection): ${nodes.filter(n => n.type === 'endpoint').length}`);
  }

  /**
   * Add the edge layer showing the real network geometry
   * This displays the actual sidewalk/path LineStrings from the data
   */
  addNetworkEdgeLayer(networkData) {
    const map = this.networkMap;
    if (!map) return;

    if (!map.loaded()) {
      map.once('load', () => this.addNetworkEdgeLayer(networkData));
      return;
    }

    console.log('🔧 Adding network edge layer with', networkData.features?.length, 'edges');

    // Verify data is valid
    if (!networkData || !networkData.features || networkData.features.length === 0) {
      console.error('❌ No edge data to add!');
      return;
    }

    // Count valid LineString features
    const lineFeatures = networkData.features.filter(f => f.geometry?.type === 'LineString');
    console.log('📏 Valid LineString features:', lineFeatures.length);

    if (lineFeatures.length === 0) {
      console.error('❌ No LineString features in data!');
      return;
    }

    // Log sample edge data
    const sample = lineFeatures[0];
    console.log('📋 Sample edge:', {
      id: sample.properties?.id,
      coords: sample.geometry.coordinates.slice(0, 2),
      quality: sample.properties?.quality
    });

    // Remove existing layers/sources if present
    if (map.getLayer('network-edges')) map.removeLayer('network-edges');
    if (map.getLayer('network-edges-outline')) map.removeLayer('network-edges-outline');
    if (map.getSource('network-edges')) map.removeSource('network-edges');

    // Add source with the real network data
    map.addSource('network-edges', {
      type: 'geojson',
      data: networkData
    });

    // Verify source was added
    const source = map.getSource('network-edges');
    if (!source) {
      console.error('❌ Failed to add network-edges source!');
      return;
    }
    console.log('✓ Source added successfully');

    // Add outline layer for better visibility (thicker, more opaque)
    map.addLayer({
      id: 'network-edges-outline',
      type: 'line',
      source: 'network-edges',
      layout: {
        'line-cap': 'round',
        'line-join': 'round'
      },
      paint: {
        'line-color': '#1e293b',
        'line-width': 8,
        'line-opacity': 0.7
      }
    });

    // Add main edge layer with quality-based coloring (thicker for visibility)
    map.addLayer({
      id: 'network-edges',
      type: 'line',
      source: 'network-edges',
      layout: {
        'line-cap': 'round',
        'line-join': 'round'
      },
      paint: {
        'line-color': [
          'interpolate',
          ['linear'],
          ['coalesce', ['get', 'quality'], 0.5],
          0, '#ef4444',    // Red - low quality (critical)
          0.25, '#f97316', // Orange - poor
          0.5, '#f59e0b',  // Amber - fair
          0.75, '#10b981', // Green - good
          1, '#06b6d4'     // Cyan - excellent
        ],
        'line-width': 5,
        'line-opacity': 1.0
      }
    });

    // Add click handler for edges
    map.on('click', 'network-edges', (e) => {
      if (e.features && e.features.length > 0) {
        const feature = e.features[0];
        const quality = feature.properties.quality || 0.5;
        const qualityLabel = quality >= 0.8 ? 'Excellent' :
                             quality >= 0.6 ? 'Good' :
                             quality >= 0.4 ? 'Fair' :
                             quality >= 0.2 ? 'Poor' : 'Critical';

        this.showToast('Segment Info',
          `ID: ${feature.properties.id || 'unknown'}\nQuality: ${qualityLabel} (${(quality * 100).toFixed(0)}%)\nType: ${feature.properties.type || 'sidewalk'}`,
          quality >= 0.6 ? 'success' : quality >= 0.4 ? 'warning' : 'error'
        );
      }
    });

    // Change cursor on hover
    map.on('mouseenter', 'network-edges', () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'network-edges', () => {
      map.getCanvas().style.cursor = '';
    });

    // Update segment count display
    const segments = networkData.features?.length || 0;
    const segmentsEl = document.getElementById('stat-segments');
    if (segmentsEl) segmentsEl.textContent = segments;

    // Verify layers were added
    const edgeLayer = map.getLayer('network-edges');
    const outlineLayer = map.getLayer('network-edges-outline');
    console.log('✓ Network edge layer added:', {
      edgeLayer: !!edgeLayer,
      outlineLayer: !!outlineLayer,
      featureCount: segments
    });

    // Log current map bounds vs network bounds
    const mapBounds = map.getBounds();
    console.log('📍 Current map bounds:', {
      sw: [mapBounds.getWest().toFixed(4), mapBounds.getSouth().toFixed(4)],
      ne: [mapBounds.getEast().toFixed(4), mapBounds.getNorth().toFixed(4)]
    });
  }

  /**
   * Add the node layer showing intersections and endpoints
   * Nodes are rendered as circles with size/color based on their type
   */
  addNetworkNodeLayer() {
    const map = this.networkMap;
    if (!map || !this.networkNodesGeoJSON) return;

    if (!map.loaded()) {
      map.once('load', () => this.addNetworkNodeLayer());
      return;
    }

    console.log('Adding network node layer with', this.networkNodesGeoJSON.features?.length, 'nodes');

    // Remove existing layers/sources if present
    if (map.getLayer('network-nodes')) map.removeLayer('network-nodes');
    if (map.getLayer('network-nodes-outline')) map.removeLayer('network-nodes-outline');
    if (map.getSource('network-nodes')) map.removeSource('network-nodes');

    // Add source
    map.addSource('network-nodes', {
      type: 'geojson',
      data: this.networkNodesGeoJSON
    });

    // Add outline layer for better visibility
    map.addLayer({
      id: 'network-nodes-outline',
      type: 'circle',
      source: 'network-nodes',
      paint: {
        'circle-radius': [
          'case',
          ['==', ['get', 'type'], 'intersection'], 9,
          ['==', ['get', 'type'], 'junction'], 7,
          5  // endpoint
        ],
        'circle-color': '#000000',
        'circle-opacity': 0.5
      }
    });

    // Add main node layer with type-based styling
    map.addLayer({
      id: 'network-nodes',
      type: 'circle',
      source: 'network-nodes',
      paint: {
        'circle-radius': [
          'case',
          ['==', ['get', 'type'], 'intersection'], 7,
          ['==', ['get', 'type'], 'junction'], 5,
          4  // endpoint
        ],
        'circle-color': [
          'case',
          ['==', ['get', 'type'], 'intersection'], '#f59e0b', // Amber for intersections
          ['==', ['get', 'type'], 'junction'], '#3b82f6',     // Blue for junctions
          '#ef4444'  // Red for endpoints (potential dead ends)
        ],
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
        'circle-opacity': 0.95
      }
    });

    // Add click handler for nodes
    map.on('click', 'network-nodes', (e) => {
      if (e.features && e.features.length > 0) {
        const feature = e.features[0];
        const nodeType = feature.properties.type;
        const degree = feature.properties.degree;

        const typeLabels = {
          'intersection': 'Intersection',
          'junction': 'Junction',
          'endpoint': 'Dead End / Endpoint'
        };

        this.showToast('Node Info',
          `Type: ${typeLabels[nodeType] || nodeType}\nConnections: ${degree}`,
          nodeType === 'endpoint' ? 'warning' : 'info'
        );
      }
    });

    // Change cursor on hover
    map.on('mouseenter', 'network-nodes', () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'network-nodes', () => {
      map.getCanvas().style.cursor = '';
    });

    console.log('✓ Network node layer added');
  }

  /**
   * Initialize semantic segmentation base layer for Network mode
   * Uses the SAME ViewportSegmentationOverlay approach as Idea A for consistent rendering
   * This ensures the base layer remains stable across the full zoom range (1-5)
   */
  initNetworkSegmentationLayer() {
    if (!this.networkMap) return;

    // Wait for map to be ready
    if (!this.networkMap.loaded()) {
      this.networkMap.once('load', () => this.initNetworkSegmentationLayer());
      return;
    }

    // Use ViewportSegmentationOverlay (IDENTICAL to Idea A's left panel) for the base layer
    // This canvas-based approach is zoom-stable across the entire 14-17.8 (normalized 1-5) range
    if (typeof ViewportSegmentationOverlay !== 'undefined') {
      this.networkSegOverlay = new ViewportSegmentationOverlay(
        this.networkMap,
        this.stateManager
      );

      // CRITICAL: Enforce the same zoom limits as Idea A to maintain stability
      // The ViewportSegmentationOverlay's enforceZoomLimits() sets these already,
      // but we double-check here for consistency
      this.networkMap.setMinZoom(this.zoomConfig.min);  // 14
      this.networkMap.setMaxZoom(this.zoomConfig.max);  // 17.8

      // Set to prediction mode to show roads/sidewalks/crosswalks
      this.networkSegOverlay.setDisplayMode('prediction');
      // Lower opacity for base layer to let edge/node graph overlay (layer 2) show clearly
      this.networkSegOverlay.setOpacity(0.18);

      // CRITICAL: Enable network graph rendering
      // The graph is now derived dynamically from Mapbox vector tiles (same as base layer)
      // This ensures the network spans the ENTIRE visible map, not just the static GeoJSON area
      this.networkSegOverlay.setNetworkGraphVisible(true);

      // Force initial render to ensure canvas is properly sized
      setTimeout(() => {
        if (this.networkSegOverlay) {
          this.networkSegOverlay.forceRegenerate(false);
        }
      }, 100);

      // Start flicker for network mode by default (after a brief delay to let layers load)
      setTimeout(() => {
        if (this.flickerEnabled) {
          this.startNetworkFlicker();
        }
      }, 500);

      console.log('✓ Network segmentation base layer initialized (using ViewportSegmentationOverlay, zoom-stable)');
    } else {
      console.warn('ViewportSegmentationOverlay not available for network base layer');
    }
  }

  /**
   * Initialize network analyzer for Idea B
   */
  initNetworkAnalyzer(networkData) {
    // Initialize the network analyzer
    if (typeof NetworkAnalyzer !== 'undefined') {
      this.networkAnalyzer = new NetworkAnalyzer(this.stateManager);

      // Store network data in state
      this.stateManager.updateState('data.network.tile2net', networkData);

      // Directly trigger analysis (don't rely solely on state subscription timing)
      setTimeout(() => {
        if (this.networkAnalyzer && networkData && networkData.features) {
          this.networkAnalyzer.analyze(networkData);

          // After analysis completes, update the canvas overlay with problem data
          // Problem visualization is handled through styling in the canvas overlay
          // No separate markers are added to avoid duplicate visual elements
          setTimeout(() => {
            if (this.networkSegOverlay && this.networkAnalyzer) {
              const problems = this.networkAnalyzer.getProblems();
              this.networkSegOverlay.setProblemData(problems);
            }
          }, 200);
        }
      }, 100);

      console.log('✓ Network Analyzer initialized');
    } else {
      console.warn('NetworkAnalyzer not loaded');
    }

    // Set up Idea B controls
    this.setupIdeaBControls();
  }

  /**
   * Set up controls for Idea B section
   */
  setupIdeaBControls() {
    // Store current visual mode
    this.currentVisualMode = 'quality';
    this.showProblemFlags = true;

    // Visual mode toggle buttons
    const visualModeBtns = document.querySelectorAll('.visual-mode-btn');
    console.log('🔧 Setting up visual mode buttons:', visualModeBtns.length, 'found');

    visualModeBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const mode = btn.dataset.mode;

        console.log('🖱️ Visual mode button clicked:', mode);

        // Update active state
        visualModeBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // Update visualization mode
        this.currentVisualMode = mode;

        // Update the map visualization
        this.updateNetworkVisualization();

        // Show toast notification
        const modeLabels = {
          'quality': 'Quality Mode - Red=Critical, Cyan=Excellent',
          'centrality': 'Centrality Mode - Pink=High traffic corridors',
          'problems': 'Problems Mode - Muted network, markers highlighted'
        };
        this.showToast('Visualization Mode', modeLabels[mode] || `Showing ${mode} view`, 'info');
      });
    });

    // Problem flags toggle
    const problemFlagsToggle = document.getElementById('toggle-problem-flags');
    if (problemFlagsToggle) {
      problemFlagsToggle.addEventListener('change', (e) => {
        this.showProblemFlags = e.target.checked;
        this.updateProblemFlagsVisibility();
        console.log('Problem flags:', this.showProblemFlags ? 'visible' : 'hidden');
      });
    }

    // Set up custom event listeners for network interactions
    this.setupNetworkEventListeners();

    // Apply initial visualization after a short delay
    setTimeout(() => {
      if (this.networkMap && this.networkMap.loaded()) {
        console.log('Applying initial network visualization');
        this.updateNetworkVisualization();
      }
    }, 1000);
  }

  /**
   * Set up event listeners for network map interactions
   */
  setupNetworkEventListeners() {
    // Listen for fly-to events from the network analyzer
    document.addEventListener('flyToLocation', (e) => {
      const { lng, lat, zoom } = e.detail;
      if (this.networkMap) {
        this.networkMap.flyTo({
          center: [lng, lat],
          zoom: zoom || 18,
          duration: 1000
        });
      }
    });

    // Listen for highlight metric events
    document.addEventListener('highlightMetric', (e) => {
      const { metric, analysis } = e.detail;
      this.highlightMetricOnMap(metric, analysis);
    });

    // Listen for imagery viewer requests
    document.addEventListener('showImageryViewer', (e) => {
      this.showImageryViewerModal(e.detail.coords, e.detail.problemType);
    });
  }

  /**
   * Highlight a specific metric on the network map
   * Updates visualization mode and problem data on the canvas overlay
   */
  highlightMetricOnMap(metric, analysis) {
    if (!this.networkMap || !analysis) return;

    switch (metric) {
      case 'centrality':
        this.highlightCentrality(analysis);
        break;
      case 'components':
        this.highlightIsolatedComponents(analysis);
        break;
      case 'bridges':
        this.highlightBridges(analysis);
        break;
      case 'problems':
        // Switch to problems mode
        this.currentVisualMode = 'problems';
        this.showProblemFlags = true;
        const flagToggle = document.getElementById('toggle-problem-flags');
        if (flagToggle) flagToggle.checked = true;
        this.updateProblemFlagsVisibility();
        this.updateNetworkVisualization();
        break;
    }
  }

  /**
   * Remove existing highlight layers (legacy - now handled by canvas overlay)
   */
  removeHighlightLayers() {
    // Clear any Mapbox layers that might have been added previously
    const layersToRemove = ['centrality-highlight', 'isolated-nodes', 'bridge-highlight',
                           'problem-markers-error', 'problem-markers-warning', 'problem-markers-info',
                           'network-edges', 'network-edges-outline', 'network-nodes', 'network-nodes-outline'];
    layersToRemove.forEach(layerId => {
      if (this.networkMap && this.networkMap.getLayer(layerId)) {
        this.networkMap.removeLayer(layerId);
      }
    });
    const sourcesToRemove = ['isolated-nodes-source', 'bridge-source',
                            'problem-source-error', 'problem-source-warning', 'problem-source-info',
                            'network-edges', 'network-nodes'];
    sourcesToRemove.forEach(sourceId => {
      if (this.networkMap && this.networkMap.getSource(sourceId)) {
        this.networkMap.removeSource(sourceId);
      }
    });
  }

  /**
   * Highlight centrality on the map
   * Switches to centrality visualization mode
   */
  highlightCentrality(analysis) {
    // Switch to centrality mode
    this.currentVisualMode = 'centrality';
    const visualModeBtns = document.querySelectorAll('.visual-mode-btn');
    visualModeBtns.forEach(b => {
      b.classList.toggle('active', b.dataset.mode === 'centrality');
    });

    if (this.networkSegOverlay) {
      this.networkSegOverlay.setNetworkVisualMode('centrality');
    }

    this.showToast('Centrality View', 'Purple/pink edges have higher betweenness centrality', 'info');
  }

  /**
   * Highlight isolated components on the map
   * Updates problem data on the canvas overlay to highlight isolated component nodes
   */
  highlightIsolatedComponents(analysis) {
    if (!analysis.topology.isolatedComponents || analysis.topology.isolatedComponents.length === 0) {
      this.showToast('Components', 'No isolated components found', 'info');
      return;
    }

    // Switch to problems mode and update problem data with isolated nodes
    this.currentVisualMode = 'problems';
    const visualModeBtns = document.querySelectorAll('.visual-mode-btn');
    visualModeBtns.forEach(b => {
      b.classList.toggle('active', b.dataset.mode === 'problems');
    });

    // Build problem list from isolated component nodes
    const problems = [];
    analysis.topology.isolatedComponents.forEach(comp => {
      comp.nodes.forEach(nodeId => {
        const parts = nodeId.split(',');
        if (parts.length === 2) {
          problems.push({
            coords: [parseFloat(parts[0]), parseFloat(parts[1])],
            type: 'isolated-component',
            severity: 'warning'
          });
        }
      });
    });

    if (this.networkSegOverlay) {
      this.networkSegOverlay.setProblemData(problems);
      this.networkSegOverlay.setNetworkVisualMode('problems');
    }

    this.showToast('Isolated Components', `Found ${analysis.topology.isolatedComponents.length} isolated subgraphs`, 'warning');
  }

  /**
   * Highlight bridge edges on the map
   * Updates visualization to highlight critical bridge edges
   */
  highlightBridges(analysis) {
    if (!analysis.topology.bridges || analysis.topology.bridges.length === 0) {
      this.showToast('Bridges', 'No bridge edges found', 'info');
      return;
    }

    // Switch to problems mode
    this.currentVisualMode = 'problems';
    const visualModeBtns = document.querySelectorAll('.visual-mode-btn');
    visualModeBtns.forEach(b => {
      b.classList.toggle('active', b.dataset.mode === 'problems');
    });

    // Build problem list from bridge edge endpoints
    const problems = [];
    analysis.topology.bridges.forEach(bridge => {
      if (bridge.coords) {
        problems.push({
          coords: bridge.coords,
          edgeId: bridge.id,
          type: 'bridge-edge',
          severity: 'warning'
        });
      }
    });

    if (this.networkSegOverlay) {
      this.networkSegOverlay.setProblemData(problems);
      this.networkSegOverlay.setNetworkVisualMode('problems');
    }

    this.showToast('Bridge Edges', `Found ${analysis.topology.bridges.length} critical bridge edges`, 'info');
  }

  /**
   * Update network visualization based on current mode
   * Delegates to the canvas overlay for actual rendering
   */
  updateNetworkVisualization() {
    if (!this.networkMap) {
      console.warn('Network map not initialized');
      return;
    }

    console.log('🎨 Updating network visualization to mode:', this.currentVisualMode);

    // Update the canvas overlay's visualization mode
    if (this.networkSegOverlay) {
      this.networkSegOverlay.setNetworkVisualMode(this.currentVisualMode);
    }

    // Update the legend to match the mode
    this.updateNetworkLegend(this.currentVisualMode);

    // Show toast for mode change
    const modeLabels = {
      'quality': 'Quality Mode - Edges colored by quality score',
      'centrality': 'Centrality Mode - Highlighting high-traffic corridors',
      'problems': 'Problems Mode - Highlighting flagged issues'
    };
    console.log('✓ Applied', this.currentVisualMode, 'visualization');
  }

  /**
   * Flash effect to indicate mode change (legacy - canvas overlay re-renders automatically)
   */
  flashNetworkLayer() {
    // Canvas overlay re-renders automatically on mode change
    // This is now a no-op but kept for API compatibility
  }

  /**
   * Set the opacity of the network layer
   * Used by header mode buttons (Network/OSM/Flicker)
   */
  setNetworkLayerOpacity(opacity) {
    // Network graph is rendered on the canvas overlay - toggle visibility
    if (this.networkSegOverlay) {
      this.networkSegOverlay.setNetworkGraphVisible(opacity > 0);
      // Also adjust segmentation opacity if needed
      if (opacity === 0) {
        this.networkSegOverlay.setOpacity(0);
      } else {
        this.networkSegOverlay.setOpacity(0.18); // Lower opacity so layer 2 graph is clearly visible
      }
    }
  }

  /**
   * Update network legend based on visual mode
   */
  updateNetworkLegend(mode) {
    const networkLegend = document.getElementById('network-legend');
    if (!networkLegend) return;

    const legendTitle = networkLegend.querySelector('.legend-title');
    const gradientLabels = networkLegend.querySelector('.gradient-labels');
    const qualityGradient = networkLegend.querySelector('.quality-gradient');

    // Update gradient class for color scheme
    if (qualityGradient) {
      qualityGradient.classList.remove('centrality-mode', 'problems-mode');
      if (mode === 'centrality') {
        qualityGradient.classList.add('centrality-mode');
      } else if (mode === 'problems') {
        qualityGradient.classList.add('problems-mode');
      }
    }

    switch (mode) {
      case 'quality':
        if (legendTitle) legendTitle.textContent = 'Quality Scale';
        if (gradientLabels) {
          gradientLabels.innerHTML = `
            <span>Critical</span>
            <span>Poor</span>
            <span>Fair</span>
            <span>Good</span>
            <span>Excellent</span>
          `;
        }
        break;

      case 'centrality':
        if (legendTitle) legendTitle.textContent = 'Centrality Scale';
        if (gradientLabels) {
          gradientLabels.innerHTML = `
            <span>Low</span>
            <span></span>
            <span>Medium</span>
            <span></span>
            <span>High</span>
          `;
        }
        break;

      case 'problems':
        if (legendTitle) legendTitle.textContent = 'Problem Severity';
        if (gradientLabels) {
          gradientLabels.innerHTML = `
            <span>Error</span>
            <span></span>
            <span>Warning</span>
            <span></span>
            <span>Info</span>
          `;
        }
        break;
    }
  }

  /**
   * Update problem flags visibility on map
   */
  updateProblemFlagsVisibility() {
    if (!this.networkSegOverlay) return;

    // If showing problem flags and in problems mode, ensure problem data is set
    if (this.showProblemFlags && this.networkAnalyzer) {
      const problems = this.networkAnalyzer.getProblems();
      this.networkSegOverlay.setProblemData(problems);

      // Switch to problems mode if not already there
      if (this.currentVisualMode === 'problems') {
        this.networkSegOverlay.setNetworkVisualMode('problems');
      }
    } else {
      // Clear problem highlighting
      this.networkSegOverlay.setProblemData([]);
    }
  }

  /**
   * Add problem flag markers to the network map
   */
  addProblemFlagMarkers() {
    if (!this.networkAnalyzer || !this.networkMap) return;

    const problems = this.networkAnalyzer.getProblems();
    if (!problems || problems.length === 0) return;

    // Group by severity
    const errorProblems = problems.filter(p => p.severity === 'error' && p.coords);
    const warningProblems = problems.filter(p => p.severity === 'warning' && p.coords);
    const infoProblems = problems.filter(p => p.severity === 'info' && p.coords);

    // Add error markers
    this.addProblemLayer('error', errorProblems, '#ef4444', 12);
    this.addProblemLayer('warning', warningProblems, '#f59e0b', 10);
    this.addProblemLayer('info', infoProblems, '#3b82f6', 8);
  }

  /**
   * Add a problem layer to the map
   */
  addProblemLayer(severity, problems, color, radius) {
    if (problems.length === 0) return;

    const sourceId = `problem-source-${severity}`;
    const layerId = `problem-markers-${severity}`;

    // Remove existing layer if present
    if (this.networkMap.getLayer(layerId)) {
      this.networkMap.removeLayer(layerId);
    }
    if (this.networkMap.getSource(sourceId)) {
      this.networkMap.removeSource(sourceId);
    }

    // Create GeoJSON features
    const features = problems.map(p => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: p.coords
      },
      properties: {
        type: p.type,
        message: p.message,
        severity: p.severity
      }
    }));

    // Add source
    this.networkMap.addSource(sourceId, {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: features
      }
    });

    // Add circle layer
    this.networkMap.addLayer({
      id: layerId,
      type: 'circle',
      source: sourceId,
      paint: {
        'circle-radius': radius,
        'circle-color': color,
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
        'circle-opacity': 0.85
      }
    });

    // Add click handler for problem markers
    this.networkMap.on('click', layerId, (e) => {
      if (e.features && e.features.length > 0) {
        const feature = e.features[0];
        const coords = feature.geometry.coordinates;
        this.showImageryViewerModal(coords, feature.properties.type);
      }
    });

    // Change cursor on hover
    this.networkMap.on('mouseenter', layerId, () => {
      this.networkMap.getCanvas().style.cursor = 'pointer';
    });
    this.networkMap.on('mouseleave', layerId, () => {
      this.networkMap.getCanvas().style.cursor = '';
    });
  }

  /**
   * Show imagery viewer modal for problem validation
   */
  showImageryViewerModal(coords, problemType) {
    // Create or get modal
    let modal = document.getElementById('imagery-viewer-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'imagery-viewer-modal';
      modal.className = 'imagery-modal';
      document.body.appendChild(modal);
    }

    const [lng, lat] = coords;

    // Create satellite imagery URL (using Mapbox Static API)
    const satelliteUrl = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${lng},${lat},18,0/400x300@2x?access_token=${this.mapboxToken}`;

    modal.innerHTML = `
      <div class="imagery-modal-content glass-panel-elevated">
        <div class="imagery-header">
          <h3>Validate Issue: ${problemType.replace(/-/g, ' ')}</h3>
          <button class="close-btn" onclick="this.closest('.imagery-modal').classList.remove('visible')">×</button>
        </div>
        <div class="imagery-body">
          <div class="imagery-container">
            <div class="imagery-label">Satellite View</div>
            <img src="${satelliteUrl}" alt="Satellite imagery" class="imagery-img" />
          </div>
          <div class="imagery-info">
            <p><strong>Location:</strong> ${lat.toFixed(6)}, ${lng.toFixed(6)}</p>
            <p><strong>Issue Type:</strong> ${problemType.replace(/-/g, ' ')}</p>
            <p class="imagery-help">Review the satellite imagery to determine if this flagged issue is a true problem or a false positive.</p>
          </div>
          <div class="imagery-actions">
            <button class="btn-modern btn-confirm" onclick="this.closest('.imagery-modal').classList.remove('visible')">
              Confirm Issue
            </button>
            <button class="btn-modern btn-dismiss" onclick="this.closest('.imagery-modal').classList.remove('visible')">
              Dismiss
            </button>
          </div>
        </div>
      </div>
    `;

    modal.classList.add('visible');
  }

  /**
   * Legacy method - redirects to new addNetworkEdgeLayer
   * @deprecated Use addNetworkEdgeLayer instead
   */
  addNetworkLayer(networkData) {
    console.log('addNetworkLayer called - redirecting to addNetworkEdgeLayer');
    this.addNetworkEdgeLayer(networkData);
  }

  /**
   * Set up scroll-based visibility for section-specific UI elements
   * Hides advanced filters when in Idea B, shows when in Idea A
   */
  setupScrollBasedVisibility() {
    const appContainer = document.getElementById('app');
    const filterPanel = document.getElementById('filter-panel');
    const ideaBSection = document.getElementById('idea-b-section');

    if (!appContainer || !filterPanel || !ideaBSection) {
      console.warn('Filter visibility setup failed - missing elements:', {
        appContainer: !!appContainer,
        filterPanel: !!filterPanel,
        ideaBSection: !!ideaBSection
      });
      return;
    }

    console.log('🔧 Setting up filter panel visibility...');

    // CRITICAL: Force the filter panel to be visible initially
    // Remove any hidden class and reset inline styles
    filterPanel.classList.remove('hidden-in-idea-b');
    filterPanel.removeAttribute('style');

    // Simple class-based visibility toggle
    const showFilterPanel = () => {
      filterPanel.classList.remove('hidden-in-idea-b');
      console.log('📋 Filter panel: VISIBLE');
    };

    const hideFilterPanel = () => {
      filterPanel.classList.add('hidden-in-idea-b');
      console.log('📋 Filter panel: HIDDEN');
    };

    // Check if we're currently viewing Idea B
    const isInIdeaB = () => {
      const scrollTop = appContainer.scrollTop;
      const ideaBTop = ideaBSection.offsetTop;
      const viewportHeight = appContainer.clientHeight;

      // If scroll position puts us past 50% into Idea B section
      return scrollTop > (ideaBTop - viewportHeight * 0.5);
    };

    // Update visibility based on scroll position
    const updateVisibility = () => {
      if (isInIdeaB()) {
        hideFilterPanel();
      } else {
        showFilterPanel();
      }
    };

    // Listen to scroll events
    appContainer.addEventListener('scroll', updateVisibility, { passive: true });

    // Initial check - ensure filter is visible on load (default to Idea A)
    // Use multiple delays to handle any async layout issues
    showFilterPanel(); // Immediate
    setTimeout(updateVisibility, 100);
    setTimeout(updateVisibility, 500);
    setTimeout(updateVisibility, 1000);

    console.log('✓ Scroll-based visibility configured for filter panel');
  }

  /**
   * Ensure the filter panel is visible - fallback method
   */
  ensureFilterPanelVisible() {
    const filterPanel = document.getElementById('filter-panel');
    if (!filterPanel) {
      console.warn('Filter panel not found!');
      return;
    }

    // Force visibility by removing any hiding classes and resetting styles
    filterPanel.classList.remove('hidden-in-idea-b');

    // Check current scroll position to determine if we should show it
    const appContainer = document.getElementById('app');
    const ideaBSection = document.getElementById('idea-b-section');

    if (appContainer && ideaBSection) {
      const scrollTop = appContainer.scrollTop;
      const ideaBTop = ideaBSection.offsetTop;
      const viewportHeight = appContainer.clientHeight;

      // Only show if we're in Idea A (not scrolled to Idea B)
      const inIdeaA = scrollTop < (ideaBTop - viewportHeight * 0.5);

      if (inIdeaA) {
        filterPanel.classList.remove('hidden-in-idea-b');
        console.log('✓ Filter panel ensured visible (in Idea A)');
      } else {
        filterPanel.classList.add('hidden-in-idea-b');
        console.log('✓ Filter panel hidden (in Idea B)');
      }
    } else {
      // Default to visible if we can't determine position
      filterPanel.classList.remove('hidden-in-idea-b');
      console.log('✓ Filter panel defaulted to visible');
    }
  }

  /**
   * Set up UI controls
   */
  setupControls() {
    // Set up scroll-based visibility for filters
    this.setupScrollBasedVisibility();

    // Display mode buttons (Prediction / Ground Truth / Errors)
    const modeButtons = document.querySelectorAll('.seg-mode-btn');
    modeButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;

        // Update active state
        modeButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // Update left overlay
        if (this.segOverlay) {
          this.segOverlay.setDisplayMode(mode);
        }

        // Update legend colors based on mode
        this.updateLegendForMode(mode);

        this.showToast('Display Mode', `Showing ${mode}`, 'info');
      });
    });

    // Opacity slider
    const opacitySlider = document.getElementById('seg-opacity');
    if (opacitySlider) {
      opacitySlider.addEventListener('input', (e) => {
        const opacity = parseInt(e.target.value) / 100;
        if (this.segOverlay) this.segOverlay.setOpacity(opacity);
        if (this.errorOverlay) this.errorOverlay.setOpacity(opacity);
      });
    }

    // Class visibility toggles
    const classToggles = document.querySelectorAll('.class-toggle');
    classToggles.forEach(toggle => {
      toggle.addEventListener('click', () => {
        const className = toggle.dataset.class;
        toggle.classList.toggle('active');

        const visible = toggle.classList.contains('active');
        if (this.segOverlay) {
          this.segOverlay.setClassVisibility(className, visible);
        }
      });
    });

    // Scroll hint (down to Idea B)
    const scrollHintDown = document.querySelector('.scroll-hint:not(.scroll-up)');
    if (scrollHintDown) {
      scrollHintDown.addEventListener('click', () => {
        const ideaB = document.getElementById('idea-b-section');
        if (ideaB) {
          ideaB.scrollIntoView({ behavior: 'smooth' });
        }
      });
    }

    // Scroll to Idea A button (in Idea B section)
    const scrollToIdeaA = document.getElementById('scroll-to-idea-a');
    if (scrollToIdeaA) {
      scrollToIdeaA.addEventListener('click', () => {
        const ideaA = document.getElementById('idea-a-section');
        if (ideaA) {
          ideaA.scrollIntoView({ behavior: 'smooth' });
        }
      });
    }

    // Network header mode buttons (Network / OSM Overlay / City Data)
    // NEW: Flicker is now a toggle that works with any mode
    const networkModeButtons = document.querySelectorAll('.mode-btn');
    this.currentHeaderMode = 'network-only';
    this.flickerInterval = null;
    this.flickerState = true;
    this.flickerEnabled = true; // Flicker ON by default

    networkModeButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        networkModeButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // Stop existing flicker when changing modes
        this.stopFlicker();

        this.currentHeaderMode = mode;

        // Toggle legends and map layers
        const networkLegend = document.getElementById('network-legend');
        const osmLegend = document.getElementById('osm-legend');
        const cityDataLegend = document.getElementById('city-data-legend');
        const flickerControl = document.getElementById('flicker-control');

        // Hide all layers first (show plain map)
        this.showPlainMap();

        if (mode === 'network-only') {
          // Network mode: flicker between plain map and network layer
          if (networkLegend) networkLegend.style.display = 'block';
          if (osmLegend) osmLegend.style.display = 'none';
          if (cityDataLegend) cityDataLegend.style.display = 'none';
          if (flickerControl) flickerControl.style.display = this.flickerEnabled ? 'block' : 'none';
          this.hideOSMLayer();
          this.hideCityDataLayer();
          this.showToast('Network View', 'Showing Tile2Net extracted network', 'info');

          // Start flicker for network mode if enabled, otherwise show static
          if (this.flickerEnabled) {
            this.startNetworkFlicker();
          } else {
            this.setNetworkLayerOpacity(0.95);
          }

        } else if (mode === 'overlay') {
          // OSM mode: flicker between plain map and OSM overlay
          if (networkLegend) networkLegend.style.display = 'none';
          if (osmLegend) osmLegend.style.display = 'block';
          if (cityDataLegend) cityDataLegend.style.display = 'none';
          if (flickerControl) flickerControl.style.display = this.flickerEnabled ? 'block' : 'none';
          this.hideCityDataLayer();
          this.showOSMOverlay();
          this.showToast('OSM Overlay', 'Comparing with OpenStreetMap data', 'info');

          // Start flicker for OSM mode if enabled, otherwise show static
          if (this.flickerEnabled) {
            this.startOSMFlicker();
          } else {
            this.setOSMLayerOpacity(0.9);
          }

        } else if (mode === 'city-data') {
          // City Data mode: flicker between plain map and city GIS layers
          if (networkLegend) networkLegend.style.display = 'none';
          if (osmLegend) osmLegend.style.display = 'none';
          if (cityDataLegend) cityDataLegend.style.display = 'block';
          if (flickerControl) flickerControl.style.display = this.flickerEnabled ? 'block' : 'none';
          this.hideOSMLayer();
          this.showCityDataOverlay();
          this.showToast('City Data', 'City GIS sidewalk/building data', 'info');

          // Start flicker for city data mode if enabled, otherwise show static
          if (this.flickerEnabled) {
            this.startCityDataFlicker();
          } else {
            this.setCityLayersOpacity(0.7);
          }
        }
      });
    });

    // Flicker Toggle Button
    const flickerToggle = document.getElementById('flicker-toggle');
    if (flickerToggle) {
      flickerToggle.addEventListener('click', () => {
        this.flickerEnabled = !this.flickerEnabled;
        flickerToggle.classList.toggle('active', this.flickerEnabled);

        const flickerControl = document.getElementById('flicker-control');
        if (flickerControl) {
          flickerControl.style.display = this.flickerEnabled ? 'block' : 'none';
        }

        if (this.flickerEnabled) {
          // Restart flicker for current mode
          this.restartFlickerForCurrentMode();
          this.showToast('Flicker', 'Flicker comparison enabled', 'info');
        } else {
          // Stop flicker and show static view
          this.stopFlicker();
          this.setStaticModeView();
          this.showToast('Flicker', 'Flicker comparison disabled', 'info');
        }
      });
    }

    // 3D button
    const btn3d = document.getElementById('btn-3d');
    if (btn3d) {
      btn3d.addEventListener('click', () => {
        const currentPitch = this.networkMap.getPitch();
        const newPitch = currentPitch > 0 ? 0 : 45;
        this.networkMap.easeTo({ pitch: newPitch, duration: 500 });

        this.showToast('View', newPitch > 0 ? '3D Mode' : '2D Mode', 'info');
      });
    }

    // === Advanced Filter Panel Controls ===
    this.setupFilterControls();

    // === Magnification Lens Toggle ===
    this.setupLensControls();

    // === Confusion Matrix Button ===
    const matrixBtn = document.getElementById('show-confusion-matrix');
    if (matrixBtn) {
      matrixBtn.addEventListener('click', () => this.showConfusionMatrix());
    }

    // === Flicker Speed Slider ===
    const flickerSpeedSlider = document.getElementById('flicker-speed');
    const flickerSpeedLabel = document.getElementById('flicker-speed-label');
    if (flickerSpeedSlider) {
      flickerSpeedSlider.addEventListener('input', (e) => {
        const speed = parseInt(e.target.value);
        if (flickerSpeedLabel) flickerSpeedLabel.textContent = speed + 'ms';

        // Restart flicker with new speed if active
        if (this.flickerEnabled && this.flickerInterval) {
          this.restartFlickerForCurrentMode();
        }
      });
    }

    console.log('✓ Controls set up');
  }

  /**
   * Set up magnification lens controls
   */
  setupLensControls() {
    const lensToggle = document.getElementById('lens-toggle');
    if (lensToggle && this.magLens) {
      lensToggle.addEventListener('click', () => {
        this.magLens.toggle();
        lensToggle.classList.toggle('active', this.magLens.enabled);

        if (this.magLens.enabled) {
          this.showToast('Layer Inspector', 'Move mouse to inspect layers. Press L to toggle.', 'info');
        }
      });
    }
  }

  /**
   * Set up filter panel controls
   */
  setupFilterControls() {
    // Filter toggle button
    const filterToggle = document.getElementById('filter-toggle');
    const filterContent = document.getElementById('filter-content');
    if (filterToggle && filterContent) {
      filterToggle.addEventListener('click', () => {
        const isVisible = filterContent.style.display !== 'none';
        filterContent.style.display = isVisible ? 'none' : 'block';
        filterToggle.classList.toggle('active', !isVisible);
      });
    }

    // Error type filters
    const filterTP = document.getElementById('filter-tp');
    const filterFP = document.getElementById('filter-fp');
    const filterFN = document.getElementById('filter-fn');

    if (filterTP) {
      filterTP.addEventListener('change', () => {
        if (this.segOverlay) {
          this.segOverlay.setErrorTypeVisibility('truePositive', filterTP.checked);
        }
        if (this.errorOverlay) {
          this.errorOverlay.setErrorTypeVisibility('truePositive', filterTP.checked);
        }
      });
    }

    if (filterFP) {
      filterFP.addEventListener('change', () => {
        if (this.segOverlay) {
          this.segOverlay.setErrorTypeVisibility('falsePositive', filterFP.checked);
        }
        if (this.errorOverlay) {
          this.errorOverlay.setErrorTypeVisibility('falsePositive', filterFP.checked);
        }
      });
    }

    if (filterFN) {
      filterFN.addEventListener('change', () => {
        if (this.segOverlay) {
          this.segOverlay.setErrorTypeVisibility('falseNegative', filterFN.checked);
        }
        if (this.errorOverlay) {
          this.errorOverlay.setErrorTypeVisibility('falseNegative', filterFN.checked);
        }
      });
    }

    // Confidence range filters
    const confMin = document.getElementById('conf-min');
    const confMax = document.getElementById('conf-max');
    const confMinLabel = document.getElementById('conf-min-label');
    const confMaxLabel = document.getElementById('conf-max-label');

    if (confMin && confMax) {
      const updateConfidenceRange = () => {
        const min = parseInt(confMin.value) / 100;
        const max = parseInt(confMax.value) / 100;

        if (confMinLabel) confMinLabel.textContent = confMin.value + '%';
        if (confMaxLabel) confMaxLabel.textContent = confMax.value + '%';

        if (this.segOverlay) {
          this.segOverlay.setConfidenceRange(min, max);
        }
        if (this.errorOverlay) {
          this.errorOverlay.setConfidenceRange(min, max);
        }
      };

      confMin.addEventListener('input', updateConfidenceRange);
      confMax.addEventListener('input', updateConfidenceRange);
    }

    // Reset filters button
    const resetFilters = document.getElementById('reset-filters');
    if (resetFilters) {
      resetFilters.addEventListener('click', () => {
        // Reset checkboxes
        if (filterTP) filterTP.checked = true;
        if (filterFP) filterFP.checked = true;
        if (filterFN) filterFN.checked = true;

        // Reset confidence sliders
        if (confMin) {
          confMin.value = 0;
          if (confMinLabel) confMinLabel.textContent = '0%';
        }
        if (confMax) {
          confMax.value = 100;
          if (confMaxLabel) confMaxLabel.textContent = '100%';
        }

        // Reset overlays
        if (this.segOverlay) this.segOverlay.resetFilters();
        if (this.errorOverlay) this.errorOverlay.resetFilters();

        this.showToast('Filters', 'All filters reset', 'info');
      });
    }
  }

  /**
   * Update statistics display with detailed metrics
   */
  updateStatistics() {
    // Get stats from segmentation overlay
    setTimeout(() => {
      if (this.segOverlay) {
        const stats = this.segOverlay.computeStatistics();
        if (stats) {
          // Basic metrics
          const accuracyEl = document.getElementById('stat-accuracy');
          const precisionEl = document.getElementById('stat-precision');
          const recallEl = document.getElementById('stat-recall');
          const f1El = document.getElementById('stat-f1');
          const iouEl = document.getElementById('stat-iou');

          if (accuracyEl) accuracyEl.textContent = (stats.accuracy * 100).toFixed(1) + '%';
          if (precisionEl) precisionEl.textContent = (stats.precision * 100).toFixed(1) + '%';
          if (recallEl) recallEl.textContent = (stats.recall * 100).toFixed(1) + '%';
          if (f1El) f1El.textContent = (stats.f1Score * 100).toFixed(1) + '%';
          if (iouEl) iouEl.textContent = (stats.meanIoU * 100).toFixed(1) + '%';

          console.log('Statistics updated:', stats);
        }
      }
    }, 500); // Wait for overlays to generate data
  }

  /**
   * Update legend colors based on display mode
   * Prediction: Green/Blue/Red
   * Ground Truth: Orange/Purple/Magenta
   */
  updateLegendForMode(mode) {
    const legend = document.querySelector('#seg-map-panel .map-legend');
    if (!legend) return;

    const roadColor = legend.querySelector('[data-class="road"] .legend-color');
    const sidewalkColor = legend.querySelector('[data-class="sidewalk"] .legend-color');
    const crosswalkColor = legend.querySelector('[data-class="crosswalk"] .legend-color');

    if (mode === 'groundTruth') {
      // Ground Truth colors: Orange/Purple/Magenta
      if (roadColor) roadColor.style.background = '#ff9800';
      if (sidewalkColor) sidewalkColor.style.background = '#9c27b0';
      if (crosswalkColor) crosswalkColor.style.background = '#e91e63';

      // Update legend title
      const title = legend.querySelector('.legend-title');
      if (title) title.textContent = 'Ground Truth Classes';
    } else {
      // Prediction colors: Green/Blue/Red
      if (roadColor) roadColor.style.background = '#4caf50';
      if (sidewalkColor) sidewalkColor.style.background = '#2196f3';
      if (crosswalkColor) crosswalkColor.style.background = '#f44336';

      // Reset legend title
      const title = legend.querySelector('.legend-title');
      if (title) title.textContent = 'Classes';
    }
  }

  /**
   * Show loading overlay
   */
  showLoading(message = 'Loading...') {
    const loading = document.getElementById('loading');
    if (loading) {
      const text = loading.querySelector('.loading-text');
      if (text) text.textContent = message;
      loading.classList.remove('hidden');
    }
  }

  /**
   * Hide loading overlay
   */
  hideLoading() {
    const loading = document.getElementById('loading');
    if (loading) {
      loading.classList.add('hidden');
    }
  }

  /**
   * Show toast notification
   */
  showToast(title, message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast glass-panel-elevated';

    const colors = {
      success: '#10b981',
      error: '#ef4444',
      info: '#06b6d4',
      warning: '#f59e0b'
    };

    const icons = {
      success: '✓',
      error: '✗',
      info: 'ℹ',
      warning: '⚠'
    };

    toast.innerHTML = `
      <div style="display: flex; align-items: start; gap: 12px;">
        <div style="width: 24px; height: 24px; border-radius: 50%; background: ${colors[type]}20; color: ${colors[type]}; display: flex; align-items: center; justify-content: center; font-weight: bold;">
          ${icons[type]}
        </div>
        <div style="flex: 1;">
          <div style="font-weight: 600; color: var(--color-text-primary);">${title}</div>
          <div style="font-size: 13px; color: var(--color-text-secondary);">${message}</div>
        </div>
      </div>
    `;

    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // ============================================
  // OSM COMPARISON FEATURES (Idea B)
  // ============================================

  /**
   * Fetch real OSM pedestrian/road data from Overpass API for current map bounds
   * @param {Object} expandedBounds - Optional pre-expanded bounds to use
   * @returns {Promise<Object>} GeoJSON FeatureCollection of OSM ways
   */
  async fetchOSMDataFromOverpass(expandedBounds = null) {
    if (!this.networkMap) {
      throw new Error('Network map not initialized');
    }

    let south, west, north, east;

    if (expandedBounds) {
      // Use provided expanded bounds
      south = expandedBounds.south;
      west = expandedBounds.west;
      north = expandedBounds.north;
      east = expandedBounds.east;
    } else {
      // Get current bounds and expand by 200% for better coverage
      const bounds = this.networkMap.getBounds();
      const latRange = bounds.getNorth() - bounds.getSouth();
      const lngRange = bounds.getEast() - bounds.getWest();

      // Expand bounds by 2x in each direction (total 5x the visible area)
      south = bounds.getSouth() - latRange * 2;
      west = bounds.getWest() - lngRange * 2;
      north = bounds.getNorth() + latRange * 2;
      east = bounds.getEast() + lngRange * 2;
    }

    // Store the bounds we're fetching for later comparison
    this.lastOSMFetchBounds = { south, west, north, east };

    // Overpass QL query for pedestrian-relevant ways (footways, sidewalks, paths, pedestrian areas, and roads)
    const query = `
      [out:json][timeout:30];
      (
        way["highway"="footway"](${south},${west},${north},${east});
        way["highway"="path"](${south},${west},${north},${east});
        way["highway"="pedestrian"](${south},${west},${north},${east});
        way["highway"="steps"](${south},${west},${north},${east});
        way["sidewalk"](${south},${west},${north},${east});
        way["highway"="residential"](${south},${west},${north},${east});
        way["highway"="tertiary"](${south},${west},${north},${east});
        way["highway"="secondary"](${south},${west},${north},${east});
        way["highway"="primary"](${south},${west},${north},${east});
        way["highway"="service"]["service"!="parking_aisle"](${south},${west},${north},${east});
        way["highway"="living_street"](${south},${west},${north},${east});
        way["highway"="crossing"](${south},${west},${north},${east});
      );
      out body;
      >;
      out skel qt;
    `;

    const overpassUrl = 'https://overpass-api.de/api/interpreter';

    console.log('📡 Fetching OSM data from Overpass API...');
    this.showToast('OSM Data', 'Fetching real OSM data...', 'info');

    try {
      const response = await fetch(overpassUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'data=' + encodeURIComponent(query)
      });

      if (!response.ok) {
        throw new Error(`Overpass API error: ${response.status}`);
      }

      const osmJson = await response.json();

      // Convert Overpass JSON to GeoJSON
      const geojson = this.convertOverpassToGeoJSON(osmJson);

      console.log(`✓ Fetched ${geojson.features.length} OSM features`);
      return geojson;

    } catch (error) {
      console.error('Failed to fetch OSM data:', error);
      throw error;
    }
  }

  /**
   * Convert Overpass API JSON response to GeoJSON
   * @param {Object} osmJson - Raw Overpass API response
   * @returns {Object} GeoJSON FeatureCollection
   */
  convertOverpassToGeoJSON(osmJson) {
    const features = [];

    // Build a map of node ID -> coordinates
    const nodeMap = new Map();
    for (const element of osmJson.elements) {
      if (element.type === 'node') {
        nodeMap.set(element.id, [element.lon, element.lat]);
      }
    }

    // Convert ways to LineString features
    for (const element of osmJson.elements) {
      if (element.type === 'way' && element.nodes && element.nodes.length >= 2) {
        const coordinates = [];

        for (const nodeId of element.nodes) {
          const coord = nodeMap.get(nodeId);
          if (coord) {
            coordinates.push(coord);
          }
        }

        // Only add if we have at least 2 valid coordinates
        if (coordinates.length >= 2) {
          features.push({
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: coordinates
            },
            properties: {
              id: element.id,
              highway: element.tags?.highway || 'unknown',
              name: element.tags?.name || '',
              surface: element.tags?.surface || '',
              sidewalk: element.tags?.sidewalk || '',
              foot: element.tags?.foot || '',
              source: 'osm'
            }
          });
        }
      }
    }

    return {
      type: 'FeatureCollection',
      metadata: {
        source: 'OpenStreetMap via Overpass API',
        fetchTime: new Date().toISOString(),
        featureCount: features.length
      },
      features: features
    };
  }

  /**
   * Check if current viewport extends beyond fetched OSM bounds
   * @returns {Boolean} true if refetch is needed
   */
  needsOSMRefetch() {
    if (!this.lastOSMFetchBounds || !this.networkMap) return true;

    const bounds = this.networkMap.getBounds();
    const margin = 0.3; // 30% margin before refetch

    const fetchedLatRange = this.lastOSMFetchBounds.north - this.lastOSMFetchBounds.south;
    const fetchedLngRange = this.lastOSMFetchBounds.east - this.lastOSMFetchBounds.west;

    // Check if current viewport is getting close to the edge of fetched bounds
    return (
      bounds.getSouth() < this.lastOSMFetchBounds.south + fetchedLatRange * margin ||
      bounds.getNorth() > this.lastOSMFetchBounds.north - fetchedLatRange * margin ||
      bounds.getWest() < this.lastOSMFetchBounds.west + fetchedLngRange * margin ||
      bounds.getEast() > this.lastOSMFetchBounds.east - fetchedLngRange * margin
    );
  }

  /**
   * Update OSM overlay data for new viewport
   */
  async updateOSMOverlayForViewport() {
    if (!this.osmOverlayActive || !this.networkMap) return;

    // Check if we need to refetch
    if (!this.needsOSMRefetch()) return;

    console.log('🔄 Viewport moved beyond OSM data bounds, refetching...');

    try {
      // Fetch new OSM data for expanded bounds
      const newOsmData = await this.fetchOSMDataFromOverpass();

      if (newOsmData && newOsmData.features.length > 0) {
        this.osmNetworkData = newOsmData;

        // Update the map source data
        const source = this.networkMap.getSource('osm-network');
        if (source) {
          source.setData(this.osmNetworkData);
          console.log(`✅ Updated OSM overlay with ${this.osmNetworkData.features.length} features`);
        }

        // Update state
        if (this.stateManager) {
          this.stateManager.updateState('data.network.osm', this.osmNetworkData);
        }
      }
    } catch (error) {
      console.warn('Failed to update OSM data:', error);
    }
  }

  /**
   * Show OSM network overlay for comparison - fetches real data from Overpass API
   */
  async showOSMOverlay() {
    if (!this.networkMap) {
      this.showToast('OSM Data', 'Network map not initialized', 'warning');
      return;
    }

    const map = this.networkMap;

    // Remove existing OSM layers first
    this.hideOSMLayer();

    // Mark OSM overlay as active
    this.osmOverlayActive = true;

    try {
      // Fetch real OSM data from Overpass API (with expanded bounds)
      this.osmNetworkData = await this.fetchOSMDataFromOverpass();

      if (!this.osmNetworkData || this.osmNetworkData.features.length === 0) {
        this.showToast('OSM Data', 'No OSM features found in this area', 'warning');
        return;
      }

      this.showToast('OSM Data', `Loaded ${this.osmNetworkData.features.length} OSM features`, 'success');

      // Store in state for comparison
      if (this.stateManager) {
        this.stateManager.updateState('data.network.osm', this.osmNetworkData);
      }

      // Recompute match stats with new data
      if (this.networkData) {
        this.computeOSMMatchStats(this.networkData, this.osmNetworkData);
      }

    } catch (error) {
      console.error('Failed to fetch OSM data:', error);
      this.showToast('OSM Data', 'Failed to fetch OSM data: ' + error.message, 'error');
      return;
    }

    // Add OSM network source
    if (!map.getSource('osm-network')) {
      map.addSource('osm-network', {
        type: 'geojson',
        data: this.osmNetworkData
      });
    }

    // Add OSM outline layer
    map.addLayer({
      id: 'osm-network-outline',
      type: 'line',
      source: 'osm-network',
      layout: {
        'line-cap': 'round',
        'line-join': 'round'
      },
      paint: {
        'line-color': '#1e293b',
        'line-width': 10,
        'line-opacity': 0.6
      }
    });

    // Add OSM network layer (orange to differentiate from Tile2Net)
    map.addLayer({
      id: 'osm-network-layer',
      type: 'line',
      source: 'osm-network',
      layout: {
        'line-cap': 'round',
        'line-join': 'round'
      },
      paint: {
        'line-color': '#f97316', // Orange for OSM
        'line-width': 6,
        'line-opacity': 0.85,
        'line-dasharray': [2, 1] // Dashed to distinguish from Tile2Net
      }
    });

    // Add click handler for OSM segments
    map.on('click', 'osm-network-layer', (e) => {
      if (e.features && e.features.length > 0) {
        const feature = e.features[0];
        const props = feature.properties;
        this.showToast('OSM Segment',
          `Type: ${props.highway || 'path'}\nName: ${props.name || 'Unnamed'}\nSurface: ${props.surface || 'unknown'}`,
          'info'
        );
      }
    });

    map.on('mouseenter', 'osm-network-layer', () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'osm-network-layer', () => {
      map.getCanvas().style.cursor = '';
    });

    // Add viewport change handler to refetch OSM data when user pans/zooms significantly
    // Remove any existing handler first
    if (this.osmMoveHandler) {
      map.off('moveend', this.osmMoveHandler);
    }

    // Create debounced handler for viewport changes
    let moveTimeout = null;
    this.osmMoveHandler = () => {
      if (moveTimeout) clearTimeout(moveTimeout);
      moveTimeout = setTimeout(() => {
        this.updateOSMOverlayForViewport();
      }, 500); // Debounce 500ms after movement stops
    };

    map.on('moveend', this.osmMoveHandler);

    console.log('✓ OSM overlay shown with', this.osmNetworkData.features.length, 'features');
    console.log('📍 OSM data covers bounds:', this.lastOSMFetchBounds);
  }

  /**
   * Hide OSM network layer
   */
  hideOSMLayer() {
    if (!this.networkMap) return;

    const map = this.networkMap;

    // Mark overlay as inactive
    this.osmOverlayActive = false;

    // Remove moveend handler
    if (this.osmMoveHandler) {
      map.off('moveend', this.osmMoveHandler);
      this.osmMoveHandler = null;
    }

    // Clear cached bounds
    this.lastOSMFetchBounds = null;

    const layersToRemove = ['osm-network-layer', 'osm-network-outline'];

    layersToRemove.forEach(layerId => {
      if (map.getLayer(layerId)) {
        map.removeLayer(layerId);
      }
    });

    if (map.getSource('osm-network')) {
      map.removeSource('osm-network');
    }
  }

  /**
   * Show City GIS data overlay (placeholder for city sidewalk/centerline data)
   * In production, this would load data from city GIS portals
   */
  async showCityDataOverlay() {
    if (!this.networkMap) return;

    // Check if we have city data loaded
    if (!this.citySidewalksData && !this.cityBuildingsData) {
      // Try to load city data (will fail gracefully if not available)
      console.log('🔄 City data not loaded yet, loading now...');
      await this.loadCityGISData();
      return;
    }

    console.log('🗺️ Showing city data overlay...');

    const map = this.networkMap;

    // Remove existing city layers
    this.hideCityDataLayer();

    // Add city sidewalks layer (polygon data - purple)
    if (this.citySidewalksData) {
      if (!map.getSource('city-sidewalks')) {
        map.addSource('city-sidewalks', {
          type: 'geojson',
          data: this.citySidewalksData
        });
      }

      // Add sidewalks fill layer
      map.addLayer({
        id: 'city-sidewalks-layer',
        type: 'fill',
        source: 'city-sidewalks',
        layout: {
          'visibility': this.cityLayerVisibility?.sidewalks !== false ? 'visible' : 'none'
        },
        paint: {
          'fill-color': '#a855f7', // Purple for sidewalks
          'fill-opacity': 0.4
        }
      });

      // Add sidewalks outline layer
      map.addLayer({
        id: 'city-sidewalks-outline',
        type: 'line',
        source: 'city-sidewalks',
        layout: {
          'visibility': this.cityLayerVisibility?.sidewalks !== false ? 'visible' : 'none'
        },
        paint: {
          'line-color': '#a855f7',
          'line-width': 1,
          'line-opacity': 0.8
        }
      });

      console.log('✓ City sidewalks overlay shown:', this.citySidewalksData.features?.length, 'features');
    }

    // Add city buildings layer (polygon data - amber/orange)
    if (this.cityBuildingsData) {
      if (!map.getSource('city-buildings')) {
        map.addSource('city-buildings', {
          type: 'geojson',
          data: this.cityBuildingsData
        });
      }

      // Add buildings fill layer
      map.addLayer({
        id: 'city-buildings-layer',
        type: 'fill',
        source: 'city-buildings',
        layout: {
          'visibility': this.cityLayerVisibility?.buildings !== false ? 'visible' : 'none'
        },
        paint: {
          'fill-color': '#f59e0b', // Amber for buildings
          'fill-opacity': 0.3
        }
      });

      // Add buildings outline layer
      map.addLayer({
        id: 'city-buildings-outline',
        type: 'line',
        source: 'city-buildings',
        layout: {
          'visibility': this.cityLayerVisibility?.buildings !== false ? 'visible' : 'none'
        },
        paint: {
          'line-color': '#f59e0b',
          'line-width': 1,
          'line-opacity': 0.6
        }
      });

      console.log('✓ City buildings overlay shown:', this.cityBuildingsData.features?.length, 'features');
    }

    console.log('✓ City GIS overlay shown');
  }

  /**
   * Load city GIS data (sidewalks and buildings)
   */
  async loadCityGISData() {
    console.log('📦 Loading city GIS data...');

    // Check if running from file:// protocol
    const isFileProtocol = window.location.protocol === 'file:';
    if (isFileProtocol) {
      console.warn('⚠️ Running from file:// protocol - fetch may not work');
      console.warn('💡 For best results, run a local server: python -m http.server 8000');
    }

    try {
      // Load smaller sample files (extracted from full NYC datasets)
      // Full datasets are too large for browser memory (~500MB+)
      const sidewalksPath = 'data/sample/city-sidewalks-sample.geojson';
      const buildingsPath = 'data/sample/city-buildings-sample.geojson';

      console.log('📂 Fetching:', sidewalksPath);
      console.log('📂 Fetching:', buildingsPath);

      // Show loading indicator
      this.showToast('Loading', 'Loading city GIS data (this may take a moment)...', 'info');

      let hasData = false;

      // Load sidewalks
      try {
        console.log('📂 Fetching sidewalks...');
        const sidewalksResponse = await fetch(sidewalksPath);
        console.log('📄 Sidewalks response:', sidewalksResponse.status, sidewalksResponse.ok, sidewalksResponse.statusText);

        if (sidewalksResponse.ok) {
          console.log('📄 Parsing sidewalks JSON...');
          this.citySidewalksData = await sidewalksResponse.json();
          console.log('✓ Loaded city sidewalks data:', this.citySidewalksData.features?.length, 'features');
          hasData = true;
        } else {
          console.error('❌ Sidewalks fetch failed:', sidewalksResponse.status, sidewalksResponse.statusText);
        }
      } catch (sidewalksErr) {
        console.error('❌ Sidewalks loading error:', sidewalksErr);
      }

      // Load buildings
      try {
        console.log('📂 Fetching buildings...');
        const buildingsResponse = await fetch(buildingsPath);
        console.log('📄 Buildings response:', buildingsResponse.status, buildingsResponse.ok, buildingsResponse.statusText);

        if (buildingsResponse.ok) {
          console.log('📄 Parsing buildings JSON...');
          this.cityBuildingsData = await buildingsResponse.json();
          console.log('✓ Loaded city buildings data:', this.cityBuildingsData.features?.length, 'features');
          hasData = true;
        } else {
          console.error('❌ Buildings fetch failed:', buildingsResponse.status, buildingsResponse.statusText);
        }
      } catch (buildingsErr) {
        console.error('❌ Buildings loading error:', buildingsErr);
      }

      if (hasData) {
        console.log('✅ City data loaded successfully!');
        // Initialize visibility states
        this.cityLayerVisibility = {
          sidewalks: true,
          buildings: true
        };
        this.setupCityLayerToggles();
        this.showCityDataOverlay();
        this.showToast('City Data Loaded', `Loaded sidewalks and buildings data`, 'success');
      } else {
        console.warn('⚠️ No city data could be loaded');
        if (isFileProtocol) {
          this.showFileProtocolError();
        } else {
          this.showCityDataPlaceholder();
        }
      }
    } catch (e) {
      console.error('❌ City GIS data loading error:', e);
      if (window.location.protocol === 'file:') {
        this.showFileProtocolError();
      } else {
        this.showCityDataPlaceholder();
      }
    }
  }

  /**
   * Show error when running from file:// protocol
   */
  showFileProtocolError() {
    let modal = document.getElementById('city-data-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'city-data-modal';
      modal.className = 'modal-overlay';
      document.body.appendChild(modal);
    }

    modal.innerHTML = `
      <div class="modal-content glass-panel-elevated" style="max-width: 550px;">
        <div class="modal-header">
          <h2>Local Server Required</h2>
          <button class="modal-close" onclick="document.getElementById('city-data-modal').classList.remove('visible')">×</button>
        </div>
        <div class="modal-body" style="text-align: left;">
          <p style="color: #f87171; margin-bottom: 16px; font-weight: 500;">
            ⚠️ Cannot load city data from file:// protocol due to browser security restrictions.
          </p>

          <h4 style="color: var(--color-text-primary); margin-bottom: 8px;">Quick Fix - Run a Local Server:</h4>

          <div style="background: rgba(0,0,0,0.3); padding: 12px; border-radius: 8px; margin-bottom: 16px; font-family: monospace;">
            <p style="color: #60a5fa; margin-bottom: 8px;"># Using Python 3:</p>
            <code style="color: #4ade80;">python -m http.server 8000</code>

            <p style="color: #60a5fa; margin-top: 12px; margin-bottom: 8px;"># Then open:</p>
            <code style="color: #4ade80;">http://localhost:8000/index-modern.html</code>
          </div>

          <p style="color: var(--color-text-secondary); font-size: 13px;">
            This is a browser security feature that prevents loading local files via JavaScript fetch().
            Running a local web server solves this issue.
          </p>
        </div>
      </div>
    `;

    modal.classList.add('visible');
  }

  /**
   * Setup city layer toggle button event listeners
   */
  setupCityLayerToggles() {
    // Prevent duplicate setup
    if (this.cityTogglesSetup) return;
    this.cityTogglesSetup = true;

    const sidewalksToggle = document.getElementById('toggle-city-sidewalks');
    const buildingsToggle = document.getElementById('toggle-city-buildings');

    console.log('🔘 Setting up city layer toggles:', { sidewalksToggle: !!sidewalksToggle, buildingsToggle: !!buildingsToggle });

    if (sidewalksToggle) {
      sidewalksToggle.addEventListener('click', () => {
        sidewalksToggle.classList.toggle('active');
        this.cityLayerVisibility.sidewalks = sidewalksToggle.classList.contains('active');
        console.log('🔀 Toggling sidewalks:', this.cityLayerVisibility.sidewalks);
        this.toggleCityLayer('sidewalks', this.cityLayerVisibility.sidewalks);
      });
    }

    if (buildingsToggle) {
      buildingsToggle.addEventListener('click', () => {
        buildingsToggle.classList.toggle('active');
        this.cityLayerVisibility.buildings = buildingsToggle.classList.contains('active');
        console.log('🔀 Toggling buildings:', this.cityLayerVisibility.buildings);
        this.toggleCityLayer('buildings', this.cityLayerVisibility.buildings);
      });
    }
  }

  /**
   * Toggle visibility of a specific city layer
   */
  toggleCityLayer(layerType, visible) {
    if (!this.networkMap) {
      console.warn('⚠️ toggleCityLayer: networkMap not available');
      return;
    }
    const map = this.networkMap;

    if (layerType === 'sidewalks') {
      const hasLayer = map.getLayer('city-sidewalks-layer');
      console.log('🔀 Sidewalks layer exists:', hasLayer, '-> Setting visibility:', visible);
      if (hasLayer) {
        map.setLayoutProperty('city-sidewalks-layer', 'visibility', visible ? 'visible' : 'none');
      }
      if (map.getLayer('city-sidewalks-outline')) {
        map.setLayoutProperty('city-sidewalks-outline', 'visibility', visible ? 'visible' : 'none');
      }
    } else if (layerType === 'buildings') {
      const hasLayer = map.getLayer('city-buildings-layer');
      console.log('🔀 Buildings layer exists:', hasLayer, '-> Setting visibility:', visible);
      if (hasLayer) {
        map.setLayoutProperty('city-buildings-layer', 'visibility', visible ? 'visible' : 'none');
      }
      if (map.getLayer('city-buildings-outline')) {
        map.setLayoutProperty('city-buildings-outline', 'visibility', visible ? 'visible' : 'none');
      }
    }
  }

  /**
   * Show placeholder when city data is not available
   */
  showCityDataPlaceholder() {
    // Show informational modal about city data integration
    let modal = document.getElementById('city-data-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'city-data-modal';
      modal.className = 'modal-overlay';
      document.body.appendChild(modal);
    }

    modal.innerHTML = `
      <div class="modal-content glass-panel-elevated" style="max-width: 500px;">
        <div class="modal-header">
          <h2>City GIS Data Integration</h2>
          <button class="modal-close" onclick="document.getElementById('city-data-modal').classList.remove('visible')">×</button>
        </div>
        <div class="modal-body" style="text-align: left;">
          <p style="color: var(--color-text-secondary); margin-bottom: 16px;">
            City GIS data comparison allows you to validate the Tile2Net network against official city sidewalk and street centerline data.
          </p>

          <h4 style="color: var(--color-text-primary); margin-bottom: 8px;">Supported Data Sources:</h4>
          <ul style="color: var(--color-text-secondary); margin-bottom: 16px; padding-left: 20px;">
            <li>NYC Open Data - Sidewalks</li>
            <li>City Planning Department - Centerlines</li>
            <li>DOT - Pedestrian Infrastructure</li>
            <li>Any GeoJSON sidewalk/path data</li>
          </ul>

          <h4 style="color: var(--color-text-primary); margin-bottom: 8px;">To Add City Data:</h4>
          <ol style="color: var(--color-text-secondary); padding-left: 20px;">
            <li>Download sidewalk GeoJSON from your city's open data portal</li>
            <li>Save as <code style="background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px;">data/sample/city-sidewalks.geojson</code></li>
            <li>Refresh and select "City Data" mode</li>
          </ol>

          <div style="margin-top: 20px; padding: 12px; background: rgba(168, 85, 247, 0.1); border-radius: 8px; border: 1px solid rgba(168, 85, 247, 0.3);">
            <strong style="color: #a855f7;">NYC Example:</strong>
            <p style="color: var(--color-text-secondary); font-size: 13px; margin-top: 4px;">
              Visit <a href="https://data.cityofnewyork.us" target="_blank" style="color: #60a5fa;">data.cityofnewyork.us</a> and search for "sidewalk" to download official sidewalk geometry data.
            </p>
          </div>
        </div>
      </div>
    `;

    modal.classList.add('visible');
  }

  /**
   * Hide city GIS data layer
   */
  hideCityDataLayer() {
    if (!this.networkMap) return;

    const map = this.networkMap;

    // Remove old city-gis layers (backward compatibility)
    if (map.getLayer('city-gis-layer')) {
      map.removeLayer('city-gis-layer');
    }
    if (map.getSource('city-gis')) {
      map.removeSource('city-gis');
    }

    // Remove sidewalks layers
    if (map.getLayer('city-sidewalks-layer')) {
      map.removeLayer('city-sidewalks-layer');
    }
    if (map.getLayer('city-sidewalks-outline')) {
      map.removeLayer('city-sidewalks-outline');
    }
    if (map.getSource('city-sidewalks')) {
      map.removeSource('city-sidewalks');
    }

    // Remove buildings layers
    if (map.getLayer('city-buildings-layer')) {
      map.removeLayer('city-buildings-layer');
    }
    if (map.getLayer('city-buildings-outline')) {
      map.removeLayer('city-buildings-outline');
    }
    if (map.getSource('city-buildings')) {
      map.removeSource('city-buildings');
    }
  }

  /**
   * Compute match statistics between Tile2Net and OSM networks
   */
  computeOSMMatchStats(tile2netData, osmData) {
    if (!tile2netData || !osmData) return;

    // Simple spatial matching - check if segments are within threshold distance
    const matchThreshold = 0.0001; // ~10m in degrees at this latitude
    let matchedSegments = 0;
    let tile2netOnly = 0;
    let osmOnly = 0;

    // Build spatial index for OSM segments (simple approach)
    const osmSegments = osmData.features.filter(f => f.geometry?.type === 'LineString');
    const tile2netSegments = tile2netData.features.filter(f => f.geometry?.type === 'LineString');

    // For each Tile2Net segment, check if there's a nearby OSM segment
    tile2netSegments.forEach(t2nSeg => {
      const t2nMidpoint = this.getSegmentMidpoint(t2nSeg.geometry.coordinates);
      let hasMatch = false;

      for (const osmSeg of osmSegments) {
        const osmMidpoint = this.getSegmentMidpoint(osmSeg.geometry.coordinates);
        const dist = this.pointDistance(t2nMidpoint, osmMidpoint);

        if (dist < matchThreshold) {
          hasMatch = true;
          break;
        }
      }

      if (hasMatch) {
        matchedSegments++;
      } else {
        tile2netOnly++;
      }
    });

    // Count OSM-only segments
    osmSegments.forEach(osmSeg => {
      const osmMidpoint = this.getSegmentMidpoint(osmSeg.geometry.coordinates);
      let hasMatch = false;

      for (const t2nSeg of tile2netSegments) {
        const t2nMidpoint = this.getSegmentMidpoint(t2nSeg.geometry.coordinates);
        const dist = this.pointDistance(t2nMidpoint, osmMidpoint);

        if (dist < matchThreshold) {
          hasMatch = true;
          break;
        }
      }

      if (!hasMatch) {
        osmOnly++;
      }
    });

    // Calculate match percentage
    const totalSegments = tile2netSegments.length + osmOnly;
    const matchPercent = totalSegments > 0 ? ((matchedSegments / totalSegments) * 100).toFixed(1) : '--';

    // Update UI
    const osmMatchEl = document.getElementById('stat-osm-match');
    if (osmMatchEl) {
      osmMatchEl.textContent = matchPercent + '%';
    }

    // Store stats
    this.osmMatchStats = {
      matched: matchedSegments,
      tile2netOnly: tile2netOnly,
      osmOnly: osmOnly,
      matchPercent: parseFloat(matchPercent)
    };

    console.log('📊 OSM Match Stats:', this.osmMatchStats);
  }

  /**
   * Get midpoint of a coordinate array
   */
  getSegmentMidpoint(coords) {
    if (!coords || coords.length === 0) return [0, 0];
    const midIdx = Math.floor(coords.length / 2);
    return coords[midIdx];
  }

  /**
   * Calculate distance between two points
   */
  pointDistance(p1, p2) {
    const dx = p1[0] - p2[0];
    const dy = p1[1] - p2[1];
    return Math.sqrt(dx * dx + dy * dy);
  }

  // ============================================
  // FLICKER MODE (Idea B) - PLAIN MAP ↔ MODE LAYER
  // ============================================

  /**
   * Hide all overlay layers to show plain map
   */
  showPlainMap() {
    this.setNetworkLayerOpacity(0);
    this.setOSMLayerOpacity(0);
    this.setCityLayersOpacity(0);
    console.log('✓ Plain map shown');
  }

  /**
   * Stop any active flicker interval
   */
  stopFlicker() {
    if (this.flickerInterval) {
      clearInterval(this.flickerInterval);
      this.flickerInterval = null;
    }
  }

  /**
   * Restart flicker for the current mode
   */
  restartFlickerForCurrentMode() {
    this.stopFlicker();

    switch (this.currentHeaderMode) {
      case 'network-only':
        this.startNetworkFlicker();
        break;
      case 'overlay':
        this.startOSMFlicker();
        break;
      case 'city-data':
        this.startCityDataFlicker();
        break;
    }
  }

  /**
   * Set static view for current mode (when flicker is disabled)
   */
  setStaticModeView() {
    // Hide all layers first
    this.showPlainMap();

    // Show only the current mode's layer
    switch (this.currentHeaderMode) {
      case 'network-only':
        this.setNetworkLayerOpacity(0.95);
        break;
      case 'overlay':
        this.setOSMLayerOpacity(0.9);
        break;
      case 'city-data':
        this.setCityLayersOpacity(0.7);
        break;
    }
  }

  /**
   * Get flicker speed from slider
   */
  getFlickerSpeed() {
    const speedSlider = document.getElementById('flicker-speed');
    return speedSlider ? parseInt(speedSlider.value) : 500;
  }

  /**
   * Start Network mode flicker - alternates between plain map and network layer
   */
  startNetworkFlicker() {
    const speed = this.getFlickerSpeed();
    this.flickerState = true;

    // Hide other layers
    this.setOSMLayerOpacity(0);
    this.setCityLayersOpacity(0);

    this.flickerInterval = setInterval(() => {
      this.flickerState = !this.flickerState;

      if (this.flickerState) {
        // Show network layer
        this.setNetworkLayerOpacity(0.95);
        this.updateFlickerLabel('Network', 'network');
      } else {
        // Show plain map (hide network)
        this.setNetworkLayerOpacity(0);
        this.updateFlickerLabel('Plain Map', 'base');
      }
    }, speed);

    console.log('✓ Network flicker started (plain map ↔ network)');
  }

  /**
   * Start OSM mode flicker - alternates between plain map and OSM overlay
   */
  startOSMFlicker() {
    if (!this.osmNetworkData) {
      console.log('ℹ️ Waiting for OSM data to load...');
      return;
    }

    const speed = this.getFlickerSpeed();
    this.flickerState = true;

    // Hide other layers
    this.setNetworkLayerOpacity(0);
    this.setCityLayersOpacity(0);

    this.flickerInterval = setInterval(() => {
      this.flickerState = !this.flickerState;

      if (this.flickerState) {
        // Show OSM layer
        this.setOSMLayerOpacity(0.9);
        this.updateFlickerLabel('OSM', 'osm');
      } else {
        // Show plain map (hide OSM)
        this.setOSMLayerOpacity(0);
        this.updateFlickerLabel('Plain Map', 'base');
      }
    }, speed);

    console.log('✓ OSM flicker started (plain map ↔ OSM)');
  }

  /**
   * Start City Data mode flicker - alternates between plain map and city GIS layers
   */
  startCityDataFlicker() {
    if (!this.citySidewalksData && !this.cityBuildingsData) {
      console.log('ℹ️ Waiting for city data to load...');
      return;
    }

    const speed = this.getFlickerSpeed();
    this.flickerState = true;

    // Hide other layers
    this.setNetworkLayerOpacity(0);
    this.setOSMLayerOpacity(0);

    this.flickerInterval = setInterval(() => {
      this.flickerState = !this.flickerState;

      if (this.flickerState) {
        // Show city layers
        this.setCityLayersOpacity(0.7);
        this.updateFlickerLabel('City Data', 'city-data');
      } else {
        // Show plain map (hide city layers)
        this.setCityLayersOpacity(0);
        this.updateFlickerLabel('Plain Map', 'base');
      }
    }, speed);

    console.log('✓ City Data flicker started (plain map ↔ city data)');
  }

  /**
   * Set OSM layer opacity
   */
  setOSMLayerOpacity(opacity) {
    if (!this.networkMap) return;
    const map = this.networkMap;

    if (map.getLayer('osm-network-layer')) {
      map.setPaintProperty('osm-network-layer', 'line-opacity', opacity);
    }
    if (map.getLayer('osm-network-outline')) {
      map.setPaintProperty('osm-network-outline', 'line-opacity', opacity * 0.6);
    }
  }

  /**
   * Set city layers opacity (sidewalks and buildings)
   */
  setCityLayersOpacity(opacity) {
    if (!this.networkMap) return;
    const map = this.networkMap;

    // Sidewalks layers
    if (map.getLayer('city-sidewalks-layer')) {
      map.setPaintProperty('city-sidewalks-layer', 'fill-opacity', opacity * 0.6);
    }
    if (map.getLayer('city-sidewalks-outline')) {
      map.setPaintProperty('city-sidewalks-outline', 'line-opacity', opacity);
    }

    // Buildings layers
    if (map.getLayer('city-buildings-layer')) {
      map.setPaintProperty('city-buildings-layer', 'fill-opacity', opacity * 0.45);
    }
    if (map.getLayer('city-buildings-outline')) {
      map.setPaintProperty('city-buildings-outline', 'line-opacity', opacity * 0.8);
    }
  }

  /**
   * Update flicker mode label with appropriate styling
   */
  updateFlickerLabel(label, type = 'base') {
    const flickerLabel = document.getElementById('flicker-current-label');
    if (flickerLabel) {
      flickerLabel.textContent = label;
      flickerLabel.className = 'flicker-label ' + type;
    }
  }

  // ============================================
  // ERROR HANDLING & USER FEEDBACK
  // ============================================

  /**
   * Show network load error message to user
   */
  showNetworkLoadError(message) {
    this.showToast('Data Error', message, 'error');

    // Also show inline error in the network panel
    const networkContainer = document.querySelector('.network-map-container');
    if (networkContainer) {
      let errorBanner = document.getElementById('network-error-banner');
      if (!errorBanner) {
        errorBanner = document.createElement('div');
        errorBanner.id = 'network-error-banner';
        errorBanner.className = 'error-banner';
        networkContainer.insertBefore(errorBanner, networkContainer.firstChild);
      }
      errorBanner.innerHTML = `
        <div class="error-icon">⚠️</div>
        <div class="error-message">${message}</div>
        <button class="error-dismiss" onclick="this.parentElement.remove()">×</button>
      `;
    }
  }

  /**
   * Show synthetic data warning
   */
  showSyntheticDataWarning() {
    const warningBanner = document.createElement('div');
    warningBanner.className = 'synthetic-data-warning';
    warningBanner.innerHTML = `
      <div class="warning-content">
        <span class="warning-icon">⚠️</span>
        <span class="warning-text">Viewing synthetic demo data. Real segmentation tiles not loaded.</span>
        <button class="warning-dismiss" onclick="this.parentElement.remove()">×</button>
      </div>
    `;

    const segPanel = document.getElementById('seg-map-panel');
    if (segPanel) {
      segPanel.insertBefore(warningBanner, segPanel.firstChild);
    }
  }

  // ============================================
  // CONFUSION MATRIX VISUALIZATION
  // ============================================

  /**
   * Show confusion matrix modal
   */
  showConfusionMatrix() {
    // Get confusion matrix data from overlay
    let matrix = null;
    if (this.segOverlay && this.segOverlay.lastErrorData) {
      matrix = this.segOverlay.lastErrorData.confusionMatrix;
    }

    if (!matrix) {
      // Generate sample confusion matrix for demo
      matrix = [
        [8500, 120, 80, 30],   // Background
        [150, 2200, 45, 25],   // Road
        [90, 35, 1800, 40],    // Sidewalk
        [20, 15, 30, 950]      // Crosswalk
      ];
    }

    const labels = ['Background', 'Road', 'Sidewalk', 'Crosswalk'];

    // Create modal
    let modal = document.getElementById('confusion-matrix-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'confusion-matrix-modal';
      modal.className = 'modal-overlay';
      document.body.appendChild(modal);
    }

    // Calculate per-class metrics
    const metrics = this.calculateClassMetrics(matrix);

    modal.innerHTML = `
      <div class="modal-content glass-panel-elevated confusion-modal">
        <div class="modal-header">
          <h2>Confusion Matrix</h2>
          <button class="modal-close" onclick="document.getElementById('confusion-matrix-modal').classList.remove('visible')">×</button>
        </div>
        <div class="modal-body">
          <div class="confusion-matrix-container">
            <div class="matrix-labels-y">
              <span class="axis-label">Predicted</span>
              ${labels.map(l => `<span class="class-label">${l}</span>`).join('')}
            </div>
            <div class="matrix-grid">
              <div class="matrix-labels-x">
                ${labels.map(l => `<span class="class-label">${l}</span>`).join('')}
              </div>
              <div class="matrix-cells">
                ${matrix.map((row, i) => `
                  <div class="matrix-row">
                    ${row.map((val, j) => {
                      const maxVal = Math.max(...matrix.flat());
                      const intensity = maxVal > 0 ? val / maxVal : 0;
                      const isDiagonal = i === j;
                      const color = isDiagonal
                        ? `rgba(16, 185, 129, ${0.2 + intensity * 0.6})`  // Green for TP
                        : `rgba(239, 68, 68, ${0.1 + intensity * 0.5})`;   // Red for errors
                      return `<div class="matrix-cell ${isDiagonal ? 'diagonal' : ''}" style="background: ${color}">
                        <span class="cell-value">${val}</span>
                      </div>`;
                    }).join('')}
                  </div>
                `).join('')}
              </div>
              <span class="axis-label x-axis">Actual (Ground Truth)</span>
            </div>
          </div>

          <div class="class-metrics">
            <h3>Per-Class Metrics</h3>
            <div class="metrics-table">
              <div class="metrics-header">
                <span>Class</span>
                <span>Precision</span>
                <span>Recall</span>
                <span>F1 Score</span>
                <span>IoU</span>
              </div>
              ${metrics.map(m => `
                <div class="metrics-row">
                  <span class="class-name">${m.name}</span>
                  <span class="metric-value">${(m.precision * 100).toFixed(1)}%</span>
                  <span class="metric-value">${(m.recall * 100).toFixed(1)}%</span>
                  <span class="metric-value">${(m.f1 * 100).toFixed(1)}%</span>
                  <span class="metric-value">${(m.iou * 100).toFixed(1)}%</span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    `;

    modal.classList.add('visible');
  }

  /**
   * Calculate per-class metrics from confusion matrix
   */
  calculateClassMetrics(matrix) {
    const labels = ['Background', 'Road', 'Sidewalk', 'Crosswalk'];
    const metrics = [];

    for (let i = 0; i < matrix.length; i++) {
      const tp = matrix[i][i];
      const fp = matrix.reduce((sum, row, idx) => idx !== i ? sum + row[i] : sum, 0);
      const fn = matrix[i].reduce((sum, val, idx) => idx !== i ? sum + val : sum, 0);

      const precision = tp / (tp + fp) || 0;
      const recall = tp / (tp + fn) || 0;
      const f1 = 2 * (precision * recall) / (precision + recall) || 0;
      const iou = tp / (tp + fp + fn) || 0;

      metrics.push({
        name: labels[i],
        precision,
        recall,
        f1,
        iou
      });
    }

    return metrics;
  }

  // ============================================
  // KEYBOARD SHORTCUTS
  // ============================================

  /**
   * Set up keyboard shortcuts
   */
  setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Ignore if typing in input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      switch (e.key.toLowerCase()) {
        case 'h':
          // Toggle help overlay
          this.toggleKeyboardHelp();
          break;
        case 'l':
          // Toggle magnification lens
          if (this.magLens) this.magLens.toggle();
          break;
        case 'm':
          // Show confusion matrix
          this.showConfusionMatrix();
          break;
        case '1':
          // Switch to prediction mode
          this.setDisplayMode('prediction');
          break;
        case '2':
          // Switch to ground truth mode
          this.setDisplayMode('groundTruth');
          break;
        case '3':
          // Switch to error mode
          this.setDisplayMode('error');
          break;
        case '4':
          // Switch to confidence mode
          this.setDisplayMode('confidence');
          break;
        case 'n':
          // Scroll to network section
          document.getElementById('idea-b-section')?.scrollIntoView({ behavior: 'smooth' });
          break;
        case 's':
          // Scroll to segmentation section
          document.getElementById('idea-a-section')?.scrollIntoView({ behavior: 'smooth' });
          break;
        case 'f':
          // Toggle flicker mode
          const flickerBtn = document.getElementById('flicker-toggle');
          if (flickerBtn) flickerBtn.click();
          break;
      }
    });
  }

  /**
   * Toggle keyboard shortcuts help overlay
   */
  toggleKeyboardHelp() {
    let helpOverlay = document.getElementById('keyboard-help-overlay');

    if (helpOverlay) {
      helpOverlay.classList.toggle('visible');
      return;
    }

    // Create help overlay
    helpOverlay = document.createElement('div');
    helpOverlay.id = 'keyboard-help-overlay';
    helpOverlay.className = 'keyboard-help-overlay visible';
    helpOverlay.innerHTML = `
      <div class="keyboard-help-content glass-panel-elevated">
        <div class="help-header">
          <h2>⌨️ Keyboard Shortcuts</h2>
          <button class="help-close" onclick="document.getElementById('keyboard-help-overlay').classList.remove('visible')">×</button>
        </div>
        <div class="help-body">
          <div class="shortcut-section">
            <h3>Navigation</h3>
            <div class="shortcut-item"><kbd>S</kbd> Go to Segmentation Detective</div>
            <div class="shortcut-item"><kbd>N</kbd> Go to Network Inspector</div>
            <div class="shortcut-item"><kbd>R</kbd> Reset map view</div>
          </div>
          <div class="shortcut-section">
            <h3>Display Modes</h3>
            <div class="shortcut-item"><kbd>1</kbd> Prediction view</div>
            <div class="shortcut-item"><kbd>2</kbd> Ground Truth view</div>
            <div class="shortcut-item"><kbd>3</kbd> Error view</div>
            <div class="shortcut-item"><kbd>4</kbd> Confidence view</div>
          </div>
          <div class="shortcut-section">
            <h3>Tools</h3>
            <div class="shortcut-item"><kbd>L</kbd> Toggle magnification lens</div>
            <div class="shortcut-item"><kbd>M</kbd> Show confusion matrix</div>
            <div class="shortcut-item"><kbd>F</kbd> Toggle flicker comparison</div>
            <div class="shortcut-item"><kbd>H</kbd> Toggle this help</div>
          </div>
          <div class="shortcut-section">
            <h3>Lens Controls (when active)</h3>
            <div class="shortcut-item"><kbd>+</kbd> / <kbd>-</kbd> Adjust lens size</div>
            <div class="shortcut-item"><kbd>P</kbd> Pin/unpin lens position</div>
            <div class="shortcut-item"><kbd>1-4</kbd> Switch lens layer</div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(helpOverlay);
  }

  /**
   * Set display mode programmatically
   */
  setDisplayMode(mode) {
    const modeButtons = document.querySelectorAll('.seg-mode-btn');
    modeButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });

    if (this.segOverlay) {
      this.segOverlay.setDisplayMode(mode);
    }

    this.showToast('Display Mode', `Switched to ${mode}`, 'info');
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM loaded, starting Modern Pedestrian Network Inspector...');
  window.app = new ModernPedestrianNetworkInspector();
});
