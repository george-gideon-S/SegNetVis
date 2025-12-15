/**
 * Quality Scorecard - Network Quality Assessment
 *
 * Automatically analyzes network quality based on:
 * - Connectivity (graph metrics)
 * - Completeness (OSM comparison)
 * - Topology (dead-ends, isolated components)
 * - Overall grade (A-F)
 */

class QualityScorecard {
  constructor(stateManager) {
    this.stateManager = stateManager;

    // Metrics
    this.metrics = {
      connectivity: 0,
      completeness: 0,
      topology: 0,
      overall: 0,
      grade: 'F'
    };

    // Network data
    this.networkData = null;
    this.osmData = null;

    // Graph analysis
    this.graph = {
      nodes: new Map(),
      edges: [],
      components: [],
      deadEnds: []
    };

    this.init();
  }

  /**
   * Initialize scorecard
   */
  init() {
    console.log('📊 Initializing Quality Scorecard...');

    // Subscribe to data changes
    this.subscribeToState();

    console.log('✅ Quality Scorecard initialized');
  }

  /**
   * Subscribe to state changes
   */
  subscribeToState() {
    // Listen for network data updates
    this.stateManager.subscribe((state) => {
      const networkData = this.stateManager.getState('data.network.tile2net');
      if (networkData && networkData !== this.networkData) {
        this.networkData = networkData;
        this.analyzeNetwork();
      }
    }, 'data');
  }

  /**
   * Analyze network and calculate all metrics
   */
  analyzeNetwork() {
    if (!this.networkData) {
      console.warn('No network data to analyze');
      return;
    }

    console.log('📊 Analyzing network quality...');

    // Build graph from network
    this.buildGraph();

    // Calculate metrics
    this.calculateConnectivity();
    this.calculateCompleteness();
    this.calculateTopology();
    this.calculateOverallGrade();

    // Update UI
    this.updateScorecard();

    // Update state
    this.stateManager.batchUpdate({
      'data.statistics.scorecard.connectivity': this.metrics.connectivity,
      'data.statistics.scorecard.completeness': this.metrics.completeness,
      'data.statistics.scorecard.topology': this.metrics.topology,
      'data.statistics.scorecard.overall': this.metrics.overall,
      'data.statistics.scorecard.grade': this.metrics.grade
    });

    console.log('✅ Quality analysis complete:', this.metrics);
  }

  /**
   * Build graph structure from GeoJSON
   */
  buildGraph() {
    this.graph.nodes.clear();
    this.graph.edges = [];

    const features = this.networkData.features;

    features.forEach(feature => {
      if (feature.geometry.type !== 'LineString') return;

      const coords = feature.geometry.coordinates;
      const startKey = coords[0].join(',');
      const endKey = coords[coords.length - 1].join(',');

      // Add nodes
      if (!this.graph.nodes.has(startKey)) {
        this.graph.nodes.set(startKey, {
          id: startKey,
          coords: coords[0],
          degree: 0,
          edges: []
        });
      }

      if (!this.graph.nodes.has(endKey)) {
        this.graph.nodes.set(endKey, {
          id: endKey,
          coords: coords[coords.length - 1],
          degree: 0,
          edges: []
        });
      }

      // Add edge
      const edge = {
        id: feature.properties.id,
        start: startKey,
        end: endKey,
        length: feature.properties.length || 0,
        quality: feature.properties.quality || 0.5
      };

      this.graph.edges.push(edge);

      // Update node degrees
      this.graph.nodes.get(startKey).degree++;
      this.graph.nodes.get(startKey).edges.push(edge.id);
      this.graph.nodes.get(endKey).degree++;
      this.graph.nodes.get(endKey).edges.push(edge.id);
    });

    console.log(`🔗 Graph: ${this.graph.nodes.size} nodes, ${this.graph.edges.length} edges`);
  }

  /**
   * Calculate connectivity score (0-100)
   *
   * Based on:
   * - Average node degree
   * - Number of isolated nodes
   * - Largest connected component size
   */
  calculateConnectivity() {
    const nodes = Array.from(this.graph.nodes.values());
    const totalNodes = nodes.length;

    if (totalNodes === 0) {
      this.metrics.connectivity = 0;
      return;
    }

    // Average degree
    const avgDegree = nodes.reduce((sum, n) => sum + n.degree, 0) / totalNodes;

    // Isolated nodes (degree = 0)
    const isolatedNodes = nodes.filter(n => n.degree === 0).length;

    // Dead-ends (degree = 1)
    this.graph.deadEnds = nodes.filter(n => n.degree === 1);
    const deadEndRatio = this.graph.deadEnds.length / totalNodes;

    // Find connected components
    this.findConnectedComponents();
    const largestComponent = Math.max(...this.graph.components.map(c => c.size));
    const componentRatio = largestComponent / totalNodes;

    // Score calculation (weighted)
    const degreeScore = Math.min(avgDegree / 4, 1) * 40; // Max 40 points (ideal avg degree = 4)
    const isolationPenalty = (isolatedNodes / totalNodes) * 30; // -30 points max
    const deadEndPenalty = deadEndRatio * 20; // -20 points max
    const componentScore = componentRatio * 40; // Max 40 points

    this.metrics.connectivity = Math.max(0, Math.min(100,
      degreeScore - isolationPenalty - deadEndPenalty + componentScore
    ));

    console.log(`🔗 Connectivity: ${this.metrics.connectivity.toFixed(1)}% (avg degree: ${avgDegree.toFixed(2)}, dead-ends: ${this.graph.deadEnds.length})`);
  }

  /**
   * Find connected components using DFS
   */
  findConnectedComponents() {
    this.graph.components = [];
    const visited = new Set();

    this.graph.nodes.forEach((node, nodeId) => {
      if (!visited.has(nodeId)) {
        const component = new Set();
        this.dfs(nodeId, visited, component);
        this.graph.components.push({
          size: component.size,
          nodes: Array.from(component)
        });
      }
    });

    console.log(`🔗 Connected components: ${this.graph.components.length}`);
  }

  /**
   * Depth-first search for component detection
   */
  dfs(nodeId, visited, component) {
    visited.add(nodeId);
    component.add(nodeId);

    const node = this.graph.nodes.get(nodeId);
    if (!node) return;

    // Visit neighbors
    node.edges.forEach(edgeId => {
      const edge = this.graph.edges.find(e => e.id === edgeId);
      if (!edge) return;

      const neighbor = edge.start === nodeId ? edge.end : edge.start;
      if (!visited.has(neighbor)) {
        this.dfs(neighbor, visited, component);
      }
    });
  }

  /**
   * Calculate completeness score (0-100)
   *
   * Based on OSM comparison metrics
   */
  calculateCompleteness() {
    const comparisonMetrics = this.stateManager.getState('data.statistics.comparisonMetrics');

    if (comparisonMetrics && comparisonMetrics.completeness !== undefined) {
      // Use pre-calculated OSM comparison
      this.metrics.completeness = comparisonMetrics.completeness;
    } else {
      // No OSM data - use quality-based estimate
      const avgQuality = this.graph.edges.reduce((sum, e) => sum + e.quality, 0) / this.graph.edges.length;
      this.metrics.completeness = avgQuality * 100;
    }

    console.log(`📋 Completeness: ${this.metrics.completeness.toFixed(1)}%`);
  }

  /**
   * Calculate topology score (0-100)
   *
   * Based on:
   * - Dead-end ratio
   * - Isolated component count
   * - Edge quality distribution
   */
  calculateTopology() {
    const totalNodes = this.graph.nodes.size;
    const totalEdges = this.graph.edges.length;

    if (totalNodes === 0 || totalEdges === 0) {
      this.metrics.topology = 0;
      return;
    }

    // Dead-end penalty
    const deadEndRatio = this.graph.deadEnds.length / totalNodes;
    const deadEndScore = Math.max(0, (1 - deadEndRatio) * 40);

    // Component penalty (ideally 1 component)
    const componentPenalty = Math.min((this.graph.components.length - 1) * 10, 30);

    // Quality distribution score
    const avgQuality = this.graph.edges.reduce((sum, e) => sum + e.quality, 0) / totalEdges;
    const qualityScore = avgQuality * 30;

    // Connectivity ratio (edges to nodes - ideal is ~1.5 for planar graphs)
    const edgeNodeRatio = totalEdges / totalNodes;
    const ratioScore = Math.min(edgeNodeRatio / 1.5, 1) * 30;

    this.metrics.topology = Math.max(0, Math.min(100,
      deadEndScore + qualityScore + ratioScore - componentPenalty
    ));

    console.log(`🔀 Topology: ${this.metrics.topology.toFixed(1)}% (components: ${this.graph.components.length}, dead-ends: ${this.graph.deadEnds.length})`);
  }

  /**
   * Calculate overall grade (A-F)
   *
   * Weighted average of all metrics
   */
  calculateOverallGrade() {
    // Weights
    const weights = {
      connectivity: 0.30,
      completeness: 0.40,
      topology: 0.30
    };

    // Weighted average
    this.metrics.overall = (
      this.metrics.connectivity * weights.connectivity +
      this.metrics.completeness * weights.completeness +
      this.metrics.topology * weights.topology
    );

    // Letter grade
    if (this.metrics.overall >= 90) this.metrics.grade = 'A';
    else if (this.metrics.overall >= 80) this.metrics.grade = 'B';
    else if (this.metrics.overall >= 70) this.metrics.grade = 'C';
    else if (this.metrics.overall >= 60) this.metrics.grade = 'D';
    else this.metrics.grade = 'F';

    console.log(`🎯 Overall: ${this.metrics.overall.toFixed(1)}% (Grade: ${this.metrics.grade})`);
  }

  /**
   * Update scorecard UI
   */
  updateScorecard() {
    const scorecardContent = document.getElementById('scorecard-content');
    if (!scorecardContent) return;

    const gradeColor = this.getGradeColor(this.metrics.grade);

    scorecardContent.innerHTML = `
      <div class="scorecard-grid">
        <!-- Overall Grade -->
        <div class="scorecard-grade-card glass-panel-elevated">
          <div class="grade-circle" style="border-color: ${gradeColor};">
            <div class="grade-letter" style="color: ${gradeColor};">${this.metrics.grade}</div>
            <div class="grade-score">${this.metrics.overall.toFixed(0)}%</div>
          </div>
          <div class="grade-label">Overall Quality</div>
          <div class="grade-desc">${this.getGradeDescription(this.metrics.grade)}</div>
        </div>

        <!-- Metric Cards -->
        <div class="scorecard-metrics">
          <div class="metric-card glass-panel-elevated">
            <div class="metric-header">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <circle cx="12" cy="12" r="2" stroke-width="2"/>
                <path d="M12 1v6m0 6v6M23 12h-6m-6 0H1" stroke-width="2"/>
              </svg>
              <span class="metric-name">Connectivity</span>
            </div>
            <div class="metric-value">${this.metrics.connectivity.toFixed(1)}%</div>
            <div class="metric-bar">
              <div class="metric-bar-fill" style="width: ${this.metrics.connectivity}%; background: ${this.getMetricColor(this.metrics.connectivity)};"></div>
            </div>
            <div class="metric-details">
              ${this.graph.nodes.size} nodes, ${this.graph.edges.length} edges
            </div>
          </div>

          <div class="metric-card glass-panel-elevated">
            <div class="metric-header">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" stroke-width="2" stroke-linecap="round"/>
                <path d="M22 4L12 14.01l-3-3" stroke-width="2" stroke-linecap="round"/>
              </svg>
              <span class="metric-name">Completeness</span>
            </div>
            <div class="metric-value">${this.metrics.completeness.toFixed(1)}%</div>
            <div class="metric-bar">
              <div class="metric-bar-fill" style="width: ${this.metrics.completeness}%; background: ${this.getMetricColor(this.metrics.completeness)};"></div>
            </div>
            <div class="metric-details">
              vs OpenStreetMap ground truth
            </div>
          </div>

          <div class="metric-card glass-panel-elevated">
            <div class="metric-header">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M12 2L2 7l10 5 10-5-10-5z" stroke-width="2"/>
                <path d="M2 17l10 5 10-5M2 12l10 5 10-5" stroke-width="2" stroke-linecap="round"/>
              </svg>
              <span class="metric-name">Topology</span>
            </div>
            <div class="metric-value">${this.metrics.topology.toFixed(1)}%</div>
            <div class="metric-bar">
              <div class="metric-bar-fill" style="width: ${this.metrics.topology}%; background: ${this.getMetricColor(this.metrics.topology)};"></div>
            </div>
            <div class="metric-details">
              ${this.graph.deadEnds.length} dead-ends, ${this.graph.components.length} component${this.graph.components.length !== 1 ? 's' : ''}
            </div>
          </div>
        </div>
      </div>

      <!-- Insights -->
      <div class="scorecard-insights">
        <div class="insights-title">Analysis Insights</div>
        <div class="insights-list">
          ${this.generateInsights().map(insight => `
            <div class="insight-item ${insight.type}">
              <span class="insight-icon">${this.getInsightIcon(insight.type)}</span>
              <span class="insight-text">${insight.message}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  /**
   * Generate insights based on metrics
   */
  generateInsights() {
    const insights = [];

    // Connectivity insights
    if (this.metrics.connectivity >= 80) {
      insights.push({ type: 'success', message: 'Excellent network connectivity' });
    } else if (this.metrics.connectivity < 50) {
      insights.push({ type: 'warning', message: `Low connectivity (${this.graph.deadEnds.length} dead-ends detected)` });
    }

    // Completeness insights
    if (this.metrics.completeness >= 80) {
      insights.push({ type: 'success', message: 'High OSM coverage match' });
    } else if (this.metrics.completeness < 60) {
      insights.push({ type: 'error', message: 'Significant gaps compared to OSM' });
    }

    // Topology insights
    if (this.graph.components.length > 1) {
      insights.push({ type: 'warning', message: `${this.graph.components.length} disconnected subgraphs found` });
    }

    if (this.graph.deadEnds.length > this.graph.nodes.size * 0.3) {
      insights.push({ type: 'error', message: 'High number of dead-ends (>30%)' });
    }

    // Overall insights
    if (this.metrics.grade === 'A' || this.metrics.grade === 'B') {
      insights.push({ type: 'success', message: 'Network meets production quality standards' });
    } else if (this.metrics.grade === 'D' || this.metrics.grade === 'F') {
      insights.push({ type: 'error', message: 'Significant improvements needed' });
    }

    return insights.length > 0 ? insights : [{ type: 'info', message: 'Analysis complete' }];
  }

  /**
   * Get color for grade
   */
  getGradeColor(grade) {
    const colors = {
      'A': '#10b981',
      'B': '#06b6d4',
      'C': '#f59e0b',
      'D': '#f97316',
      'F': '#ef4444'
    };
    return colors[grade] || '#6b7280';
  }

  /**
   * Get description for grade
   */
  getGradeDescription(grade) {
    const descriptions = {
      'A': 'Excellent Quality',
      'B': 'Good Quality',
      'C': 'Fair Quality',
      'D': 'Poor Quality',
      'F': 'Critical Issues'
    };
    return descriptions[grade] || 'Unknown';
  }

  /**
   * Get color for metric value
   */
  getMetricColor(value) {
    if (value >= 80) return '#10b981';
    if (value >= 60) return '#06b6d4';
    if (value >= 40) return '#f59e0b';
    return '#ef4444';
  }

  /**
   * Get icon for insight type
   */
  getInsightIcon(type) {
    const icons = {
      'success': '✓',
      'warning': '⚠',
      'error': '✗',
      'info': 'ℹ'
    };
    return icons[type] || 'ℹ';
  }

  /**
   * Set OSM data for comparison
   */
  setOSMData(osmData) {
    this.osmData = osmData;
    if (this.networkData) {
      this.analyzeNetwork();
    }
  }
}

// Make available globally
if (typeof window !== 'undefined') {
  window.QualityScorecard = QualityScorecard;
}
