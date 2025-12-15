/**
 * Sync Controller - Coordinates Multiple Views
 * Implements bidirectional pan/zoom synchronization between panels
 * Compatible with Mapbox GL + Deck.gl panels
 */

class SyncController {
  constructor(segmentationPanel, networkPanel, stateManager) {
    this.segPanel = segmentationPanel;
    this.netPanel = networkPanel;
    this.stateManager = stateManager;

    // Synchronization state
    this.syncEnabled = true;
    this.isSyncing = false; // Prevents infinite loops
    this.syncTimeout = null;

    // Debounce settings
    this.debounceDelay = 100; // ms

    this.init();
  }

  /**
   * Initialize synchronization
   */
  init() {
    console.log('🔄 Initializing Sync Controller...');

    // Set up synchronization listeners
    this.setupSync();

    // Subscribe to state changes
    this.subscribeToState();

    console.log('✅ Sync Controller initialized');
  }

  /**
   * Set up bidirectional synchronization between panels
   * Uses panel-agnostic approach via state manager
   */
  setupSync() {
    // Listen to viewport state changes from state manager
    // This is triggered by both panels when they move
    this.stateManager.subscribe((state, path) => {
      if (path === 'viewport.center' || path === 'viewport.zoom') {
        // Don't sync if we're already syncing (prevents loops)
        if (this.isSyncing) return;

        // Don't sync if disabled
        if (!this.syncEnabled) return;

        // Get the current viewport from state
        const center = this.stateManager.getState('viewport.center');
        const zoom = this.stateManager.getState('viewport.zoom');

        if (center && zoom) {
          this.syncBothPanels(center, zoom);
        }
      }
    }, 'viewport');

    // Also set up direct map event listeners for segmentation panel (Mapbox)
    if (this.segPanel && this.segPanel.map) {
      this.segPanel.map.on('moveend', () => {
        if (!this.shouldSync()) return;
        this.syncFromSegmentation();
      });
    }

    // For network panel (Deck.gl), we rely on the onViewStateChange callback
    // which is already set up to update state manager
  }

  /**
   * Check if synchronization should occur
   * @returns {Boolean} True if should sync
   */
  shouldSync() {
    return this.syncEnabled && !this.isSyncing;
  }

  /**
   * Synchronize from segmentation panel to network panel
   */
  syncFromSegmentation() {
    if (!this.segPanel) return;

    this.performSync(() => {
      const viewState = this.segPanel.getViewState();
      const center = viewState.center;
      const zoom = viewState.zoom;

      // Update network panel view
      if (this.netPanel) {
        this.netPanel.setView(center, zoom);
      }

      // Update state
      this.stateManager.batchUpdate({
        'viewport.center': center,
        'viewport.zoom': zoom
      });

      console.log(`🔄 Synced: Segmentation → Network [${center[0].toFixed(5)}, ${center[1].toFixed(5)}] @ zoom ${zoom.toFixed(1)}`);
    });
  }

  /**
   * Synchronize from network panel to segmentation panel
   */
  syncFromNetwork() {
    if (!this.netPanel) return;

    this.performSync(() => {
      const viewState = this.netPanel.getViewState();
      const center = [viewState.latitude, viewState.longitude];
      const zoom = viewState.zoom;

      // Update segmentation panel view
      if (this.segPanel) {
        this.segPanel.setView(center, zoom);
      }

      // Update state
      this.stateManager.batchUpdate({
        'viewport.center': center,
        'viewport.zoom': zoom
      });

      console.log(`🔄 Synced: Network → Segmentation [${center[0].toFixed(5)}, ${center[1].toFixed(5)}] @ zoom ${zoom.toFixed(1)}`);
    });
  }

  /**
   * Sync both panels to given viewport
   */
  syncBothPanels(center, zoom) {
    this.performSync(() => {
      // Update both panels
      if (this.segPanel) {
        this.segPanel.setView(center, zoom);
      }
      if (this.netPanel) {
        this.netPanel.setView(center, zoom);
      }
    });
  }

  /**
   * Perform synchronization with loop prevention
   * @param {Function} syncFn - Synchronization function to execute
   */
  performSync(syncFn) {
    // Set syncing flag to prevent infinite loops
    this.isSyncing = true;

    // Clear any pending sync timeout
    if (this.syncTimeout) {
      clearTimeout(this.syncTimeout);
    }

    // Execute sync function
    syncFn();

    // Reset syncing flag after a delay
    this.syncTimeout = setTimeout(() => {
      this.isSyncing = false;
      this.syncTimeout = null;
    }, this.debounceDelay);
  }

  /**
   * Enable synchronization
   */
  enableSync() {
    if (!this.syncEnabled) {
      this.syncEnabled = true;
      this.stateManager.updateState('ui.syncEnabled', true);
      console.log('✅ Panel synchronization enabled');

      // Immediately sync to current segmentation panel view
      this.syncFromSegmentation();
    }
  }

  /**
   * Disable synchronization
   */
  disableSync() {
    if (this.syncEnabled) {
      this.syncEnabled = false;
      this.stateManager.updateState('ui.syncEnabled', false);
      console.log('❌ Panel synchronization disabled');
    }
  }

  /**
   * Toggle synchronization on/off
   * @returns {Boolean} New sync state
   */
  toggleSync() {
    if (this.syncEnabled) {
      this.disableSync();
    } else {
      this.enableSync();
    }
    return this.syncEnabled;
  }

  /**
   * Manually trigger synchronization
   * Useful for programmatic sync after loading data
   */
  manualSync() {
    if (this.syncEnabled) {
      console.log('🔄 Manual sync triggered');
      this.syncFromSegmentation();
    } else {
      console.warn('Cannot manual sync - synchronization is disabled');
    }
  }

  /**
   * Synchronize both panels to a specific location
   * @param {Array} center - [lat, lng]
   * @param {Number} zoom - Zoom level
   */
  syncToLocation(center, zoom) {
    console.log(`🔄 Syncing both panels to: [${center[0].toFixed(5)}, ${center[1].toFixed(5)}] @ zoom ${zoom}`);

    // Temporarily disable sync to prevent loops
    const wasEnabled = this.syncEnabled;
    this.syncEnabled = false;

    // Update both panels
    if (this.segPanel) {
      this.segPanel.setView(center, zoom);
    }
    if (this.netPanel) {
      this.netPanel.setView(center, zoom);
    }

    // Update state
    this.stateManager.batchUpdate({
      'viewport.center': center,
      'viewport.zoom': zoom
    });

    // Re-enable sync if it was enabled
    setTimeout(() => {
      this.syncEnabled = wasEnabled;
    }, this.debounceDelay * 2);
  }

  /**
   * Subscribe to relevant state changes
   */
  subscribeToState() {
    // Listen for sync toggle from UI
    this.stateManager.subscribe((state, path, newValue) => {
      if (path === 'ui.syncEnabled') {
        if (newValue !== this.syncEnabled) {
          if (newValue) {
            this.enableSync();
          } else {
            this.disableSync();
          }
        }
      }
    }, 'ui');
  }

  /**
   * Get synchronization status
   * @returns {Object} Status object
   */
  getStatus() {
    const segView = this.segPanel ? this.segPanel.getViewState() : null;
    const netView = this.netPanel ? this.netPanel.getViewState() : null;

    return {
      enabled: this.syncEnabled,
      syncing: this.isSyncing,
      segmentationView: segView,
      networkView: netView ? {
        center: [netView.latitude, netView.longitude],
        zoom: netView.zoom
      } : null,
      inSync: this.areViewsInSync()
    };
  }

  /**
   * Check if both panels are showing the same view
   * @returns {Boolean} True if views are synchronized
   */
  areViewsInSync() {
    if (!this.segPanel || !this.netPanel) return false;

    const segView = this.segPanel.getViewState();
    const netView = this.netPanel.getViewState();

    if (!segView || !netView) return false;

    const segCenter = segView.center;
    const netCenter = [netView.latitude, netView.longitude];

    // Consider views in sync if center is within 0.0001 degrees and zoom within 0.5
    const centerMatch = Math.abs(segCenter[0] - netCenter[0]) < 0.0001 &&
                       Math.abs(segCenter[1] - netCenter[1]) < 0.0001;
    const zoomMatch = Math.abs(segView.zoom - netView.zoom) < 0.5;

    return centerMatch && zoomMatch;
  }

  /**
   * Debug helper: Log current sync status
   */
  debug() {
    const status = this.getStatus();
    console.group('🔄 Sync Controller Debug');
    console.log('Enabled:', status.enabled);
    console.log('Currently Syncing:', status.syncing);
    console.log('Views In Sync:', status.inSync);
    console.log('Segmentation View:', status.segmentationView);
    console.log('Network View:', status.networkView);
    console.groupEnd();
  }

  /**
   * Reset synchronization (useful for debugging)
   */
  reset() {
    this.isSyncing = false;
    if (this.syncTimeout) {
      clearTimeout(this.syncTimeout);
      this.syncTimeout = null;
    }
    console.log('🔄 Sync controller reset');
  }
}

// Make available globally
if (typeof window !== 'undefined') {
  window.SyncController = SyncController;
}
