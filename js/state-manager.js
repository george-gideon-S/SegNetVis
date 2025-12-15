/**
 * State Manager - Centralized State Management
 * Implements Observer pattern for reactive state updates
 */

class StateManager {
  constructor() {
    // Initialize application state
    this.state = {
      // Viewport State (shared between panels)
      viewport: {
        center: [40.7484, -73.9857], // Default: Empire State Building, NYC
        zoom: 16,
        bounds: null
      },

      // Filter State
      filters: {
        errorTypes: {
          falsePositive: true,
          falseNegative: true,
          truePositive: false,
          confidenceMismatch: false
        },
        confidenceRange: {
          min: 0,
          max: 100
        },
        spatialRegions: [] // Array of selected region IDs
      },

      // Display State
      layers: {
        aerialImagery: true,
        predictionMask: true,
        groundTruth: false,
        errorOverlay: true,
        confidenceHeatmap: false,
        osmNetwork: false,
        segmentationOverlay: true
      },

      // Segmentation Display State (NEW: For tile2net integration)
      segmentation: {
        displayMode: 'prediction', // 'prediction', 'groundTruth', 'error', 'comparison'
        classVisibility: {
          road: true,
          sidewalk: true,
          crosswalk: true
        },
        opacity: 0.6
      },

      // Selection State
      selection: {
        segmentationRegions: [],
        networkSegments: [],
        hoverTarget: null
      },

      // Traceability State
      trace: {
        active: false,
        source: null, // { type: 'segmentation|network', id: string }
        targets: []   // Array of { type, id, coordinates }
      },

      // Data State
      data: {
        loaded: false,
        loading: false,
        error: null,
        segmentation: {
          tiles: null,
          predictions: null,
          groundTruth: null,
          errors: null
        },
        network: {
          tile2net: null,
          osm: null,
          comparison: null
        },
        statistics: {
          totalErrors: 0,
          errorCounts: {
            falsePositive: 0,
            falseNegative: 0,
            truePositive: 0
          },
          accuracy: 0,
          networkMetrics: {
            totalSegments: 0,
            connectivity: 0,
            completeness: 0
          }
        }
      },

      // UI State
      ui: {
        detailPanelExpanded: true,
        syncEnabled: true,
        comparisonMode: 'network-only', // 'network-only' | 'osm-overlay' | 'side-by-side' | 'flicker'
        viewLevel: 'simple' // 'simple' | 'intermediate' | 'advanced'
      }
    };

    // Listeners for state changes
    this.listeners = [];

    // History for undo/redo (optional enhancement)
    this.history = [];
    this.historyIndex = -1;
  }

  /**
   * Subscribe to state changes
   * @param {Function} listener - Callback function to execute on state change
   * @param {String} path - Optional path to listen to specific state changes
   */
  subscribe(listener, path = null) {
    this.listeners.push({ callback: listener, path: path });
    return () => this.unsubscribe(listener);
  }

  /**
   * Unsubscribe from state changes
   * @param {Function} listener - Listener to remove
   */
  unsubscribe(listener) {
    this.listeners = this.listeners.filter(l => l.callback !== listener);
  }

  /**
   * Update state at a given path
   * @param {String} path - Dot-notation path (e.g., 'viewport.center')
   * @param {*} value - New value
   * @param {Boolean} notify - Whether to notify listeners (default: true)
   */
  updateState(path, value, notify = true) {
    const keys = path.split('.');
    let current = this.state;

    // Navigate to the parent of the target property
    for (let i = 0; i < keys.length - 1; i++) {
      if (!current[keys[i]]) {
        current[keys[i]] = {};
      }
      current = current[keys[i]];
    }

    // Set the value
    const lastKey = keys[keys.length - 1];
    const oldValue = current[lastKey];
    current[lastKey] = value;

    // Add to history
    this.addToHistory(path, oldValue, value);

    // Notify listeners
    if (notify) {
      this.notifyListeners(path, value, oldValue);
    }
  }

  /**
   * Batch update multiple state paths
   * @param {Object} updates - Object with paths as keys and new values
   */
  batchUpdate(updates) {
    Object.entries(updates).forEach(([path, value]) => {
      this.updateState(path, value, false);
    });

    // Notify all listeners once after batch
    this.notifyListeners('*', this.state);
  }

  /**
   * Get state value at a given path
   * @param {String} path - Dot-notation path
   * @returns {*} State value
   */
  getState(path) {
    if (!path) return this.state;

    const keys = path.split('.');
    let current = this.state;

    for (const key of keys) {
      if (current[key] === undefined) {
        return undefined;
      }
      current = current[key];
    }

    return current;
  }

  /**
   * Notify all subscribed listeners of state change
   * @param {String} path - Path that changed
   * @param {*} newValue - New value
   * @param {*} oldValue - Old value
   */
  notifyListeners(path, newValue, oldValue = null) {
    this.listeners.forEach(({ callback, path: listenerPath }) => {
      // If listener has no specific path or path matches
      if (!listenerPath || path.startsWith(listenerPath) || path === '*') {
        callback(this.state, path, newValue, oldValue);
      }
    });
  }

  /**
   * Add state change to history
   * @param {String} path - Path that changed
   * @param {*} oldValue - Old value
   * @param {*} newValue - New value
   */
  addToHistory(path, oldValue, newValue) {
    // Keep history limited to last 50 changes
    if (this.history.length >= 50) {
      this.history.shift();
    }

    this.history.push({
      timestamp: Date.now(),
      path: path,
      oldValue: oldValue,
      newValue: newValue
    });

    this.historyIndex = this.history.length - 1;
  }

  /**
   * Undo last state change
   */
  undo() {
    if (this.historyIndex >= 0) {
      const change = this.history[this.historyIndex];
      this.updateState(change.path, change.oldValue, true);
      this.historyIndex--;
    }
  }

  /**
   * Redo state change
   */
  redo() {
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++;
      const change = this.history[this.historyIndex];
      this.updateState(change.path, change.newValue, true);
    }
  }

  /**
   * Reset state to initial values
   */
  reset() {
    this.state = this.getInitialState();
    this.notifyListeners('*', this.state);
  }

  /**
   * Get initial state (for reset)
   * @returns {Object} Initial state object
   */
  getInitialState() {
    return {
      viewport: {
        center: [40.7484, -73.9857],
        zoom: 16,
        bounds: null
      },
      filters: {
        errorTypes: {
          falsePositive: true,
          falseNegative: true,
          truePositive: false,
          confidenceMismatch: false
        },
        confidenceRange: {
          min: 0,
          max: 100
        },
        spatialRegions: []
      },
      layers: {
        aerialImagery: true,
        predictionMask: true,
        groundTruth: false,
        errorOverlay: true,
        confidenceHeatmap: false,
        osmNetwork: false
      },
      selection: {
        segmentationRegions: [],
        networkSegments: [],
        hoverTarget: null
      },
      trace: {
        active: false,
        source: null,
        targets: []
      },
      data: {
        loaded: false,
        loading: false,
        error: null,
        segmentation: {
          tiles: null,
          predictions: null,
          groundTruth: null,
          errors: null
        },
        network: {
          tile2net: null,
          osm: null,
          comparison: null
        },
        statistics: {
          totalErrors: 0,
          errorCounts: {
            falsePositive: 0,
            falseNegative: 0,
            truePositive: 0
          },
          accuracy: 0,
          networkMetrics: {
            totalSegments: 0,
            connectivity: 0,
            completeness: 0
          }
        }
      },
      ui: {
        detailPanelExpanded: true,
        syncEnabled: true,
        comparisonMode: 'network-only',
        viewLevel: 'simple'
      }
    };
  }

  /**
   * Export current state as JSON (for sharing/debugging)
   * @returns {String} JSON string of current state
   */
  exportState() {
    return JSON.stringify(this.state, null, 2);
  }

  /**
   * Import state from JSON
   * @param {String} jsonString - JSON string of state
   */
  importState(jsonString) {
    try {
      const importedState = JSON.parse(jsonString);
      this.state = importedState;
      this.notifyListeners('*', this.state);
      return true;
    } catch (error) {
      console.error('Failed to import state:', error);
      return false;
    }
  }

  /**
   * Generate shareable URL with current state
   * @returns {String} URL with state encoded
   */
  generateShareableURL() {
    const baseURL = window.location.href.split('?')[0];
    const stateParams = {
      center: this.state.viewport.center,
      zoom: this.state.viewport.zoom,
      filters: this.state.filters.errorTypes,
      layers: this.state.layers
    };

    const params = new URLSearchParams();
    params.set('state', btoa(JSON.stringify(stateParams)));

    return `${baseURL}?${params.toString()}`;
  }

  /**
   * Load state from URL parameters
   */
  loadStateFromURL() {
    const params = new URLSearchParams(window.location.search);
    const stateParam = params.get('state');

    if (stateParam) {
      try {
        const decodedState = JSON.parse(atob(stateParam));

        // Update state from URL params
        if (decodedState.center) {
          this.updateState('viewport.center', decodedState.center);
        }
        if (decodedState.zoom) {
          this.updateState('viewport.zoom', decodedState.zoom);
        }
        if (decodedState.filters) {
          this.updateState('filters.errorTypes', decodedState.filters);
        }
        if (decodedState.layers) {
          this.updateState('layers', { ...this.state.layers, ...decodedState.layers });
        }

        return true;
      } catch (error) {
        console.error('Failed to load state from URL:', error);
        return false;
      }
    }

    return false;
  }

  /**
   * Debug helper: Log current state
   */
  debug() {
    console.group('🔍 State Manager Debug');
    console.log('Current State:', this.state);
    console.log('Active Listeners:', this.listeners.length);
    console.log('History Length:', this.history.length);
    console.log('History Index:', this.historyIndex);
    console.groupEnd();
  }
}

// Make StateManager available globally for debugging
if (typeof window !== 'undefined') {
  window.StateManager = StateManager;
}
