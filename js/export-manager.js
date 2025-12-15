/**
 * Export Manager
 * Handles exporting data, reports, and visualizations
 */

class ExportManager {
  constructor(stateManager) {
    this.stateManager = stateManager;
    this.init();
  }

  init() {
    console.log('📦 Initializing Export Manager...');
    this.setupEventListeners();
    console.log('✅ Export Manager initialized');
  }

  setupEventListeners() {
    // Listen for export requests
    document.addEventListener('exportRequest', (e) => {
      this.handleExportRequest(e.detail);
    });
  }

  handleExportRequest(options) {
    switch (options.type) {
      case 'network':
        this.exportNetwork(options.format);
        break;
      case 'errors':
        this.exportErrors(options.format);
        break;
      case 'report':
        this.exportReport(options.format);
        break;
      case 'screenshot':
        this.exportScreenshot(options.target);
        break;
      default:
        console.warn('Unknown export type:', options.type);
    }
  }

  /**
   * Export network data as GeoJSON
   */
  exportNetwork(format = 'geojson') {
    const networkData = this.stateManager.getState('data.network.tile2net');

    if (!networkData) {
      this.showToast('No network data to export', 'warning');
      return;
    }

    const enrichedNetwork = this.enrichNetworkData(networkData);

    if (format === 'geojson') {
      this.downloadJSON(enrichedNetwork, 'pedestrian-network-export.geojson');
    } else if (format === 'csv') {
      const csv = this.networkToCSV(enrichedNetwork);
      this.downloadText(csv, 'pedestrian-network-export.csv', 'text/csv');
    }

    this.showToast('Network data exported successfully', 'success');
  }

  /**
   * Enrich network data with analysis results
   */
  enrichNetworkData(networkData) {
    if (!networkData.features) return networkData;

    // Get analysis data if available
    const analysisData = this.stateManager.getState('data.analysis');

    const enrichedFeatures = networkData.features.map(feature => {
      const props = { ...feature.properties };

      // Add analysis results if available
      if (window.app && window.app.networkAnalyzer) {
        const analyzer = window.app.networkAnalyzer;
        const edgeId = props.id;

        if (edgeId) {
          props.betweennessCentrality = analyzer.getEdgeCentrality(edgeId);
          props.isBridge = analyzer.isBridge(edgeId);
          props.smoothness = analyzer.getEdgeSmoothness(edgeId);
        }
      }

      return {
        ...feature,
        properties: props
      };
    });

    return {
      ...networkData,
      features: enrichedFeatures,
      metadata: {
        exportDate: new Date().toISOString(),
        featureCount: enrichedFeatures.length,
        source: 'Pedestrian Network Inspector'
      }
    };
  }

  /**
   * Convert network to CSV format
   */
  networkToCSV(networkData) {
    if (!networkData.features || networkData.features.length === 0) {
      return '';
    }

    // Get all property keys
    const allKeys = new Set();
    networkData.features.forEach(f => {
      Object.keys(f.properties || {}).forEach(k => allKeys.add(k));
    });
    allKeys.add('geometry_type');
    allKeys.add('coordinates');

    const headers = Array.from(allKeys);
    const rows = [headers.join(',')];

    networkData.features.forEach(feature => {
      const row = headers.map(key => {
        if (key === 'geometry_type') {
          return feature.geometry?.type || '';
        } else if (key === 'coordinates') {
          return JSON.stringify(feature.geometry?.coordinates || []);
        } else {
          const val = feature.properties?.[key];
          if (val === undefined || val === null) return '';
          if (typeof val === 'string') return `"${val.replace(/"/g, '""')}"`;
          return val;
        }
      });
      rows.push(row.join(','));
    });

    return rows.join('\n');
  }

  /**
   * Export error analysis as JSON
   */
  exportErrors(format = 'json') {
    const errorData = this.stateManager.getState('data.errors');
    const statistics = this.stateManager.getState('data.statistics');

    if (!errorData && !statistics) {
      this.showToast('No error data to export', 'warning');
      return;
    }

    const exportData = {
      exportDate: new Date().toISOString(),
      source: 'Pedestrian Network Inspector - Segmentation Analysis',
      statistics: statistics || {},
      errors: errorData || { features: [] },
      confusionMatrix: this.getConfusionMatrix()
    };

    if (format === 'json') {
      this.downloadJSON(exportData, 'error-analysis-export.json');
    }

    this.showToast('Error analysis exported successfully', 'success');
  }

  /**
   * Get confusion matrix from data loader
   */
  getConfusionMatrix() {
    if (window.app && window.app.dataLoader) {
      return window.app.dataLoader.statistics?.confusionMatrix || null;
    }
    return null;
  }

  /**
   * Export comprehensive quality report
   */
  exportReport(format = 'html') {
    const report = this.generateReport();

    if (format === 'html') {
      this.downloadText(report.html, 'quality-report.html', 'text/html');
    } else if (format === 'json') {
      this.downloadJSON(report.data, 'quality-report.json');
    }

    this.showToast('Quality report exported successfully', 'success');
  }

  /**
   * Generate comprehensive quality report
   */
  generateReport() {
    const networkData = this.stateManager.getState('data.network.tile2net');
    const osmData = this.stateManager.getState('data.network.osm');
    const statistics = this.stateManager.getState('data.statistics');
    const analysisData = this.stateManager.getState('data.analysis');

    // Get quality scorecard data
    let scorecardData = null;
    if (window.app && window.app.qualityScorecard) {
      scorecardData = window.app.qualityScorecard.getReport();
    }

    // Get network analyzer data
    let networkAnalysis = null;
    if (window.app && window.app.networkAnalyzer) {
      const analyzer = window.app.networkAnalyzer;
      networkAnalysis = {
        nodes: analyzer.nodes.size,
        edges: analyzer.edges.length,
        components: analyzer.analysis.topology.components.length,
        isolatedComponents: analyzer.analysis.topology.isolatedComponents.length,
        bridges: analyzer.analysis.topology.bridges.length,
        articulationPoints: analyzer.analysis.topology.articulationPoints.length,
        problems: analyzer.analysis.problems.length,
        smoothness: analyzer.getOverallSmoothness()
      };
    }

    const data = {
      generatedAt: new Date().toISOString(),
      summary: {
        overallGrade: scorecardData?.grade || 'N/A',
        overallScore: scorecardData?.score || 0
      },
      segmentation: {
        accuracy: statistics?.accuracy || 0,
        precision: statistics?.precision || 0,
        recall: statistics?.recall || 0,
        f1Score: statistics?.f1Score || 0,
        meanIoU: statistics?.meanIoU || 0
      },
      network: networkAnalysis,
      comparison: {
        tile2netSegments: networkData?.features?.length || 0,
        osmSegments: osmData?.features?.length || 0
      },
      scorecard: scorecardData
    };

    const html = this.generateHTMLReport(data);

    return { data, html };
  }

  /**
   * Generate HTML report
   */
  generateHTMLReport(data) {
    const gradeColor = this.getGradeColor(data.summary.overallGrade);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pedestrian Network Quality Report</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a1a2e;
      color: #e4e4e7;
      padding: 40px;
      line-height: 1.6;
    }
    .container { max-width: 900px; margin: 0 auto; }
    .header {
      text-align: center;
      margin-bottom: 40px;
      padding-bottom: 20px;
      border-bottom: 1px solid #333;
    }
    .header h1 { font-size: 28px; margin-bottom: 8px; }
    .header .date { color: #888; font-size: 14px; }
    .grade-badge {
      display: inline-block;
      width: 80px;
      height: 80px;
      line-height: 80px;
      text-align: center;
      font-size: 36px;
      font-weight: bold;
      border-radius: 50%;
      background: ${gradeColor};
      color: white;
      margin: 20px 0;
    }
    .section {
      background: #252542;
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 24px;
    }
    .section h2 {
      font-size: 18px;
      color: #d4af37;
      margin-bottom: 16px;
      padding-bottom: 8px;
      border-bottom: 1px solid #333;
    }
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 16px;
    }
    .metric {
      background: #1a1a2e;
      padding: 16px;
      border-radius: 8px;
      text-align: center;
    }
    .metric-value {
      font-size: 24px;
      font-weight: bold;
      color: #2dd4bf;
    }
    .metric-label {
      font-size: 12px;
      color: #888;
      margin-top: 4px;
    }
    .problems-list { list-style: none; }
    .problems-list li {
      padding: 8px 12px;
      margin: 4px 0;
      background: #1a1a2e;
      border-radius: 4px;
      font-size: 14px;
    }
    .footer {
      text-align: center;
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #333;
      color: #666;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Pedestrian Network Quality Report</h1>
      <div class="date">Generated: ${new Date(data.generatedAt).toLocaleString()}</div>
      <div class="grade-badge">${data.summary.overallGrade}</div>
      <div>Overall Score: ${(data.summary.overallScore * 100).toFixed(1)}%</div>
    </div>

    <div class="section">
      <h2>Segmentation Performance</h2>
      <div class="metrics-grid">
        <div class="metric">
          <div class="metric-value">${(data.segmentation.accuracy * 100).toFixed(1)}%</div>
          <div class="metric-label">Accuracy</div>
        </div>
        <div class="metric">
          <div class="metric-value">${(data.segmentation.precision * 100).toFixed(1)}%</div>
          <div class="metric-label">Precision</div>
        </div>
        <div class="metric">
          <div class="metric-value">${(data.segmentation.recall * 100).toFixed(1)}%</div>
          <div class="metric-label">Recall</div>
        </div>
        <div class="metric">
          <div class="metric-value">${(data.segmentation.f1Score * 100).toFixed(1)}%</div>
          <div class="metric-label">F1 Score</div>
        </div>
        <div class="metric">
          <div class="metric-value">${(data.segmentation.meanIoU * 100).toFixed(1)}%</div>
          <div class="metric-label">Mean IoU</div>
        </div>
      </div>
    </div>

    ${data.network ? `
    <div class="section">
      <h2>Network Topology</h2>
      <div class="metrics-grid">
        <div class="metric">
          <div class="metric-value">${data.network.nodes}</div>
          <div class="metric-label">Nodes</div>
        </div>
        <div class="metric">
          <div class="metric-value">${data.network.edges}</div>
          <div class="metric-label">Edges</div>
        </div>
        <div class="metric">
          <div class="metric-value">${data.network.components}</div>
          <div class="metric-label">Components</div>
        </div>
        <div class="metric">
          <div class="metric-value">${data.network.bridges}</div>
          <div class="metric-label">Bridges</div>
        </div>
        <div class="metric">
          <div class="metric-value">${data.network.problems}</div>
          <div class="metric-label">Issues Found</div>
        </div>
        <div class="metric">
          <div class="metric-value">${data.network.smoothness.toFixed(0)}%</div>
          <div class="metric-label">Smoothness</div>
        </div>
      </div>
    </div>
    ` : ''}

    <div class="section">
      <h2>Data Comparison</h2>
      <div class="metrics-grid">
        <div class="metric">
          <div class="metric-value">${data.comparison.tile2netSegments}</div>
          <div class="metric-label">Tile2Net Segments</div>
        </div>
        <div class="metric">
          <div class="metric-value">${data.comparison.osmSegments}</div>
          <div class="metric-label">OSM Segments</div>
        </div>
      </div>
    </div>

    <div class="footer">
      <p>Generated by Pedestrian Network Inspector</p>
      <p>Tile2Net ML Pipeline Visualization Tool</p>
    </div>
  </div>
</body>
</html>`;
  }

  /**
   * Get grade color
   */
  getGradeColor(grade) {
    const colors = {
      'A': '#22c55e',
      'B': '#84cc16',
      'C': '#eab308',
      'D': '#f97316',
      'F': '#ef4444'
    };
    return colors[grade] || '#6b7280';
  }

  /**
   * Export screenshot of a map panel
   */
  async exportScreenshot(target = 'segmentation') {
    try {
      let map;
      let filename;

      switch (target) {
        case 'segmentation':
          map = window.app?.segmentationMap;
          filename = 'segmentation-view.png';
          break;
        case 'network':
          map = window.app?.networkMap;
          filename = 'network-view.png';
          break;
        default:
          this.showToast('Unknown screenshot target', 'warning');
          return;
      }

      if (!map) {
        this.showToast('Map not available for screenshot', 'warning');
        return;
      }

      // Get canvas from map
      const canvas = map.getCanvas();

      // Convert to blob and download
      canvas.toBlob((blob) => {
        if (blob) {
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = filename;
          link.click();
          URL.revokeObjectURL(url);
          this.showToast('Screenshot saved successfully', 'success');
        }
      }, 'image/png');

    } catch (error) {
      console.error('Screenshot failed:', error);
      this.showToast('Failed to capture screenshot', 'error');
    }
  }

  /**
   * Download JSON file
   */
  downloadJSON(data, filename) {
    const json = JSON.stringify(data, null, 2);
    this.downloadText(json, filename, 'application/json');
  }

  /**
   * Download text file
   */
  downloadText(content, filename, mimeType = 'text/plain') {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Show toast notification
   */
  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) {
      console.log(`[${type.toUpperCase()}] ${message}`);
      return;
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <span class="toast-icon">${this.getToastIcon(type)}</span>
      <span class="toast-message">${message}</span>
    `;

    container.appendChild(toast);

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

  // Public API methods

  /**
   * Export all data as a zip (requires external library)
   */
  async exportAll() {
    // Export each type individually
    this.exportNetwork('geojson');
    this.exportErrors('json');
    this.exportReport('html');
    this.showToast('All exports initiated', 'info');
  }
}

// Make available globally
if (typeof window !== 'undefined') {
  window.ExportManager = ExportManager;
}
