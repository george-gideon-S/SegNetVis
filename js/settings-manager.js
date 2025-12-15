/**
 * Settings Manager
 * Handles the settings modal and persists user preferences
 */

class SettingsManager {
  constructor(stateManager) {
    this.stateManager = stateManager;

    // Default settings
    this.defaults = {
      // Map settings
      mapStyle: 'mapbox://styles/mapbox/satellite-streets-v12',
      syncPanels: true,

      // Segmentation settings
      segmentationOpacity: 70,
      errorHighlightIntensity: 150,
      showCrosswalks: true,

      // Network settings
      edgeWidth: 4,
      nodeSize: 6,
      flickerSpeed: 1000,

      // Analysis thresholds
      shortStubThreshold: 5,
      longLinkThreshold: 200,
      sharpAngleThreshold: 30
    };

    // Load saved settings or use defaults
    this.settings = this.loadSettings();

    // Bind methods
    this.open = this.open.bind(this);
    this.close = this.close.bind(this);
    this.apply = this.apply.bind(this);
    this.reset = this.reset.bind(this);

    this.init();
  }

  init() {
    console.log('⚙️ Initializing Settings Manager...');
    this.setupEventListeners();
    this.updateUIFromSettings();
    this.updateDataSourceInfo();
    console.log('✅ Settings Manager initialized');
  }

  setupEventListeners() {
    // Settings FAB button
    const fab = document.getElementById('settings-fab');
    if (fab) {
      fab.addEventListener('click', this.open);
    }

    // Modal controls
    const closeBtn = document.getElementById('settings-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', this.close);
    }

    const applyBtn = document.getElementById('settings-apply');
    if (applyBtn) {
      applyBtn.addEventListener('click', this.apply);
    }

    const resetBtn = document.getElementById('settings-reset');
    if (resetBtn) {
      resetBtn.addEventListener('click', this.reset);
    }

    // Reload data button
    const reloadBtn = document.getElementById('btn-reload-data');
    if (reloadBtn) {
      reloadBtn.addEventListener('click', () => this.reloadData());
    }

    // Close on overlay click
    const modal = document.getElementById('settings-modal');
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          this.close();
        }
      });
    }

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.close();
      }
    });

    // Real-time value display updates for range inputs
    this.setupRangeInputs();
  }

  setupRangeInputs() {
    const rangeInputs = [
      { id: 'setting-seg-opacity', valueId: 'setting-seg-opacity-value', suffix: '%' },
      { id: 'setting-error-highlight', valueId: 'setting-error-highlight-value', suffix: '' },
      { id: 'setting-edge-width', valueId: 'setting-edge-width-value', suffix: 'px' },
      { id: 'setting-node-size', valueId: 'setting-node-size-value', suffix: 'px' },
      { id: 'setting-flicker-speed', valueId: 'setting-flicker-speed-value', suffix: 'ms' }
    ];

    rangeInputs.forEach(({ id, valueId, suffix }) => {
      const input = document.getElementById(id);
      const valueDisplay = document.getElementById(valueId);

      if (input && valueDisplay) {
        input.addEventListener('input', () => {
          valueDisplay.textContent = input.value + suffix;
        });
      }
    });
  }

  open() {
    const modal = document.getElementById('settings-modal');
    if (modal) {
      modal.style.display = 'flex';
      this.updateUIFromSettings();
      this.updateDataSourceInfo();
    }
  }

  close() {
    const modal = document.getElementById('settings-modal');
    if (modal) {
      modal.style.display = 'none';
    }
  }

  apply() {
    // Collect all settings from UI
    this.settings = {
      // Map settings
      mapStyle: document.getElementById('setting-map-style')?.value || this.defaults.mapStyle,
      syncPanels: document.getElementById('setting-sync-panels')?.checked ?? this.defaults.syncPanels,

      // Segmentation settings
      segmentationOpacity: parseInt(document.getElementById('setting-seg-opacity')?.value) || this.defaults.segmentationOpacity,
      errorHighlightIntensity: parseInt(document.getElementById('setting-error-highlight')?.value) || this.defaults.errorHighlightIntensity,
      showCrosswalks: document.getElementById('setting-show-crosswalks')?.checked ?? this.defaults.showCrosswalks,

      // Network settings
      edgeWidth: parseInt(document.getElementById('setting-edge-width')?.value) || this.defaults.edgeWidth,
      nodeSize: parseInt(document.getElementById('setting-node-size')?.value) || this.defaults.nodeSize,
      flickerSpeed: parseInt(document.getElementById('setting-flicker-speed')?.value) || this.defaults.flickerSpeed,

      // Analysis thresholds
      shortStubThreshold: parseInt(document.getElementById('setting-short-stub')?.value) || this.defaults.shortStubThreshold,
      longLinkThreshold: parseInt(document.getElementById('setting-long-link')?.value) || this.defaults.longLinkThreshold,
      sharpAngleThreshold: parseInt(document.getElementById('setting-sharp-angle')?.value) || this.defaults.sharpAngleThreshold
    };

    // Save settings to localStorage
    this.saveSettings();

    // Apply settings to the application
    this.applyToApplication();

    // Show success toast
    this.showToast('Settings applied successfully', 'success');

    // Close modal
    this.close();
  }

  reset() {
    this.settings = { ...this.defaults };
    this.updateUIFromSettings();
    this.showToast('Settings reset to defaults', 'info');
  }

  updateUIFromSettings() {
    // Map settings
    const mapStyle = document.getElementById('setting-map-style');
    if (mapStyle) mapStyle.value = this.settings.mapStyle;

    const syncPanels = document.getElementById('setting-sync-panels');
    if (syncPanels) syncPanels.checked = this.settings.syncPanels;

    // Segmentation settings
    const segOpacity = document.getElementById('setting-seg-opacity');
    const segOpacityValue = document.getElementById('setting-seg-opacity-value');
    if (segOpacity) {
      segOpacity.value = this.settings.segmentationOpacity;
      if (segOpacityValue) segOpacityValue.textContent = this.settings.segmentationOpacity + '%';
    }

    const errorHighlight = document.getElementById('setting-error-highlight');
    const errorHighlightValue = document.getElementById('setting-error-highlight-value');
    if (errorHighlight) {
      errorHighlight.value = this.settings.errorHighlightIntensity;
      if (errorHighlightValue) errorHighlightValue.textContent = this.settings.errorHighlightIntensity;
    }

    const showCrosswalks = document.getElementById('setting-show-crosswalks');
    if (showCrosswalks) showCrosswalks.checked = this.settings.showCrosswalks;

    // Network settings
    const edgeWidth = document.getElementById('setting-edge-width');
    const edgeWidthValue = document.getElementById('setting-edge-width-value');
    if (edgeWidth) {
      edgeWidth.value = this.settings.edgeWidth;
      if (edgeWidthValue) edgeWidthValue.textContent = this.settings.edgeWidth + 'px';
    }

    const nodeSize = document.getElementById('setting-node-size');
    const nodeSizeValue = document.getElementById('setting-node-size-value');
    if (nodeSize) {
      nodeSize.value = this.settings.nodeSize;
      if (nodeSizeValue) nodeSizeValue.textContent = this.settings.nodeSize + 'px';
    }

    const flickerSpeed = document.getElementById('setting-flicker-speed');
    const flickerSpeedValue = document.getElementById('setting-flicker-speed-value');
    if (flickerSpeed) {
      flickerSpeed.value = this.settings.flickerSpeed;
      if (flickerSpeedValue) flickerSpeedValue.textContent = this.settings.flickerSpeed + 'ms';
    }

    // Analysis thresholds
    const shortStub = document.getElementById('setting-short-stub');
    if (shortStub) shortStub.value = this.settings.shortStubThreshold;

    const longLink = document.getElementById('setting-long-link');
    if (longLink) longLink.value = this.settings.longLinkThreshold;

    const sharpAngle = document.getElementById('setting-sharp-angle');
    if (sharpAngle) sharpAngle.value = this.settings.sharpAngleThreshold;
  }

  updateDataSourceInfo() {
    // Get data loader status if available
    if (window.app && window.app.dataLoader) {
      const status = window.app.dataLoader.getDataSourceStatus();

      const segType = document.getElementById('source-seg-type');
      if (segType) {
        segType.textContent = status.usingSyntheticData ?
          'Synthetic (Demo)' :
          `Real Data (${status.loadedRealTiles}/${status.totalTiles} tiles)`;
        segType.style.color = status.usingSyntheticData ? '#fbbf24' : '#2dd4bf';
      }
    }

    // Network data source
    const networkType = document.getElementById('source-network-type');
    if (networkType && this.stateManager) {
      const networkData = this.stateManager.getState('data.network.tile2net');
      if (networkData && networkData.features) {
        networkType.textContent = `pedestrian-network.geojson (${networkData.features.length} segments)`;
      }
    }

    // Ground truth sources
    const gtType = document.getElementById('source-gt-type');
    if (gtType && this.stateManager) {
      const osmData = this.stateManager.getState('data.network.osm');
      const cityData = this.stateManager.getState('data.cityData');

      const sources = [];
      if (osmData && osmData.features) sources.push(`OSM (${osmData.features.length})`);
      if (cityData) sources.push('City GIS');

      gtType.textContent = sources.length > 0 ? sources.join(' + ') : 'Not loaded';
    }
  }

  applyToApplication() {
    // Update state manager with new settings
    if (this.stateManager) {
      this.stateManager.batchUpdate({
        'settings.mapStyle': this.settings.mapStyle,
        'settings.syncPanels': this.settings.syncPanels,
        'settings.segmentationOpacity': this.settings.segmentationOpacity / 100,
        'settings.errorHighlightIntensity': this.settings.errorHighlightIntensity,
        'settings.showCrosswalks': this.settings.showCrosswalks,
        'settings.edgeWidth': this.settings.edgeWidth,
        'settings.nodeSize': this.settings.nodeSize,
        'settings.flickerSpeed': this.settings.flickerSpeed,
        'settings.shortStubThreshold': this.settings.shortStubThreshold,
        'settings.longLinkThreshold': this.settings.longLinkThreshold,
        'settings.sharpAngleThreshold': this.settings.sharpAngleThreshold
      });
    }

    // Apply map style change
    if (window.app && window.app.segmentationMap) {
      window.app.segmentationMap.setStyle(this.settings.mapStyle);
    }
    if (window.app && window.app.networkMap) {
      window.app.networkMap.setStyle(this.settings.mapStyle);
    }

    // Update network analyzer thresholds
    if (window.app && window.app.networkAnalyzer) {
      window.app.networkAnalyzer.config.shortStubThreshold = this.settings.shortStubThreshold;
      window.app.networkAnalyzer.config.longLinkThreshold = this.settings.longLinkThreshold;
      window.app.networkAnalyzer.config.sharpAngleThreshold = this.settings.sharpAngleThreshold;
    }

    // Dispatch settings changed event
    document.dispatchEvent(new CustomEvent('settingsChanged', {
      detail: this.settings
    }));
  }

  async reloadData() {
    this.showToast('Reloading data...', 'info');

    try {
      // Reload the page to refresh all data
      // In a more sophisticated implementation, we would reload just the data
      if (window.app && window.app.loadAllData) {
        await window.app.loadAllData();
        this.showToast('Data reloaded successfully', 'success');
        this.updateDataSourceInfo();
      } else {
        // Fallback: reload page
        window.location.reload();
      }
    } catch (error) {
      console.error('Failed to reload data:', error);
      this.showToast('Failed to reload data', 'error');
    }
  }

  saveSettings() {
    try {
      localStorage.setItem('pedestrianNetworkInspector_settings', JSON.stringify(this.settings));
      console.log('⚙️ Settings saved to localStorage');
    } catch (e) {
      console.warn('Could not save settings to localStorage:', e);
    }
  }

  loadSettings() {
    try {
      const saved = localStorage.getItem('pedestrianNetworkInspector_settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        // Merge with defaults to ensure all keys exist
        return { ...this.defaults, ...parsed };
      }
    } catch (e) {
      console.warn('Could not load settings from localStorage:', e);
    }
    return { ...this.defaults };
  }

  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <span class="toast-icon">${this.getToastIcon(type)}</span>
      <span class="toast-message">${message}</span>
    `;

    container.appendChild(toast);

    // Auto-remove after 3 seconds
    setTimeout(() => {
      toast.classList.add('toast-fade-out');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  getToastIcon(type) {
    switch (type) {
      case 'success': return '✓';
      case 'error': return '✗';
      case 'warning': return '⚠';
      default: return 'ℹ';
    }
  }

  // Public API
  getSetting(key) {
    return this.settings[key];
  }

  setSetting(key, value) {
    this.settings[key] = value;
    this.saveSettings();
    this.applyToApplication();
  }
}

// Make available globally
if (typeof window !== 'undefined') {
  window.SettingsManager = SettingsManager;
}
