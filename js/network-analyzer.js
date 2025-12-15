/**
 * Network Analyzer - Advanced Graph Analysis for Idea B
 *
 * Computes and visualizes:
 * - Betweenness centrality (nodes and edges)
 * - Bridges and articulation points
 * - Geometry quality (sharp angles, zigzag, segment length)
 * - Isolated components with visual flagging
 * - Problem detection and flagging
 */

class NetworkAnalyzer {
  constructor(stateManager) {
    this.stateManager = stateManager;

    // Graph structure
    this.nodes = new Map();     // nodeId -> node data
    this.edges = [];            // edge array
    this.adjacency = new Map(); // nodeId -> [neighboring nodeIds]

    // Analysis results
    this.analysis = {
      centrality: {
        nodeBetweenness: new Map(),
        edgeBetweenness: new Map(),
        maxNodeCentrality: 0,
        maxEdgeCentrality: 0
      },
      topology: {
        bridges: [],           // edge ids that are bridges
        articulationPoints: [], // node ids that are articulation points
        components: [],         // connected components
        isolatedComponents: []  // components not connected to main
      },
      geometry: {
        sharpAngles: [],       // nodes with sharp angle turns
        zigzagSegments: [],    // edges with zigzag pattern
        shortStubs: [],        // very short edges (< 5m)
        longLinks: []          // overly long edges (> 200m)
      },
      problems: []             // consolidated list of all flagged issues
    };

    // Thresholds
    this.config = {
      shortStubThreshold: 5,     // meters
      longLinkThreshold: 200,    // meters
      sharpAngleThreshold: 30,   // degrees (angles < 30 degrees are sharp)
      zigzagMinSegments: 3,      // minimum segments to detect zigzag
      zigzagAngleRange: [60, 120] // degrees for zigzag alternation
    };

    this.init();
  }

  init() {
    console.log('🔬 Initializing Network Analyzer...');
    this.subscribeToState();
    console.log('✅ Network Analyzer initialized');
  }

  subscribeToState() {
    // Track the last analyzed data to prevent re-analysis loops
    this.lastAnalyzedDataHash = null;

    this.stateManager.subscribe((state) => {
      const networkData = this.stateManager.getState('data.network.tile2net');
      if (networkData && networkData.features) {
        // Create a simple hash to check if data changed
        const dataHash = networkData.features.length + '_' + (networkData.features[0]?.properties?.id || '');

        // Only analyze if data actually changed
        if (dataHash !== this.lastAnalyzedDataHash) {
          this.lastAnalyzedDataHash = dataHash;
          this.analyze(networkData);
        }
      }
    }, 'data');
  }

  /**
   * Main analysis entry point
   */
  analyze(geojson) {
    console.log('🔬 Running comprehensive network analysis...');

    // Guard: Check for valid input data
    if (!geojson || !geojson.features || !Array.isArray(geojson.features)) {
      console.warn('⚠️ Invalid or empty GeoJSON data provided to analyzer');
      this.showAnalysisError('No valid network data to analyze');
      return;
    }

    if (geojson.features.length === 0) {
      console.warn('⚠️ Empty features array - no network data to analyze');
      this.showAnalysisError('Network data is empty');
      return;
    }

    // Show loading state
    this.showAnalysisLoading(true);

    try {
      // Build graph
      this.buildGraph(geojson);

      // Guard: Check if graph was built successfully
      if (this.nodes.size === 0 || this.edges.length === 0) {
        console.warn('⚠️ Failed to build graph from data');
        this.showAnalysisError('Could not build network graph from data');
        this.showAnalysisLoading(false);
        return;
      }

      // Run all analyses with error handling
      try {
        this.findConnectedComponents();
      } catch (e) {
        console.warn('Component analysis failed:', e);
      }

      try {
        this.computeBetweennessCentrality();
      } catch (e) {
        console.warn('Centrality analysis failed:', e);
      }

      try {
        this.findBridgesAndArticulationPoints();
      } catch (e) {
        console.warn('Bridge analysis failed:', e);
      }

      try {
        this.analyzeGeometry(geojson);
      } catch (e) {
        console.warn('Geometry analysis failed:', e);
      }

      this.consolidateProblems();

      // Update state with results
      this.updateState();

      // Update UI
      this.updateAnalysisUI();

      console.log('✅ Network analysis complete');
      console.log('📊 Analysis summary:', {
        nodes: this.nodes.size,
        edges: this.edges.length,
        components: this.analysis.topology.components.length,
        bridges: this.analysis.topology.bridges.length,
        articulationPoints: this.analysis.topology.articulationPoints.length,
        problems: this.analysis.problems.length
      });

      // Hide loading indicator
      this.showAnalysisLoading(false);
    } catch (error) {
      console.error('❌ Network analysis failed:', error);
      this.showAnalysisLoading(false);
      this.showAnalysisError('Analysis failed: ' + error.message);
      // Still try to update UI with partial results
      this.updateAnalysisUI();
    }
  }

  /**
   * Show/hide loading indicator in analysis panel
   */
  showAnalysisLoading(show) {
    const dashboard = document.getElementById('metrics-dashboard');
    const problemsPanel = document.getElementById('problems-panel');

    if (show) {
      if (dashboard) {
        const loading = dashboard.querySelector('.metrics-loading');
        if (loading) loading.style.display = 'flex';
      }
      if (problemsPanel) {
        const loading = problemsPanel.querySelector('.problems-loading');
        if (loading) loading.style.display = 'flex';
      }
    } else {
      if (dashboard) {
        const loading = dashboard.querySelector('.metrics-loading');
        if (loading) loading.style.display = 'none';
      }
      if (problemsPanel) {
        const loading = problemsPanel.querySelector('.problems-loading');
        if (loading) loading.style.display = 'none';
      }
    }
  }

  /**
   * Show error message in analysis panel
   */
  showAnalysisError(message) {
    const dashboard = document.getElementById('metrics-dashboard');
    if (dashboard) {
      dashboard.innerHTML = `
        <div class="metrics-header">
          <h3>Network Analysis</h3>
        </div>
        <div class="analysis-error">
          <span class="error-icon">⚠️</span>
          <span class="error-message">${message}</span>
        </div>
      `;
    }
  }

  /**
   * Build graph from GeoJSON
   */
  buildGraph(geojson) {
    this.nodes.clear();
    this.edges = [];
    this.adjacency.clear();

    let edgeId = 0;

    geojson.features.forEach((feature, idx) => {
      if (feature.geometry.type !== 'LineString') return;

      const coords = feature.geometry.coordinates;
      if (coords.length < 2) return;

      const startKey = `${coords[0][0].toFixed(6)},${coords[0][1].toFixed(6)}`;
      const endKey = `${coords[coords.length-1][0].toFixed(6)},${coords[coords.length-1][1].toFixed(6)}`;

      // Create nodes
      if (!this.nodes.has(startKey)) {
        this.nodes.set(startKey, {
          id: startKey,
          coords: coords[0],
          degree: 0,
          edges: []
        });
        this.adjacency.set(startKey, []);
      }

      if (!this.nodes.has(endKey)) {
        this.nodes.set(endKey, {
          id: endKey,
          coords: coords[coords.length-1],
          degree: 0,
          edges: []
        });
        this.adjacency.set(endKey, []);
      }

      // Create edge
      const edge = {
        id: feature.properties?.id || `edge_${edgeId++}`,
        featureIndex: idx,
        start: startKey,
        end: endKey,
        coordinates: coords,
        length: this.calculateLength(coords),
        quality: feature.properties?.quality || 0.5
      };

      this.edges.push(edge);

      // Update adjacency
      this.adjacency.get(startKey).push(endKey);
      this.adjacency.get(endKey).push(startKey);

      // Update node degree
      this.nodes.get(startKey).degree++;
      this.nodes.get(startKey).edges.push(edge.id);
      this.nodes.get(endKey).degree++;
      this.nodes.get(endKey).edges.push(edge.id);
    });
  }

  /**
   * Find connected components using BFS
   */
  findConnectedComponents() {
    this.analysis.topology.components = [];
    this.analysis.topology.isolatedComponents = [];

    const visited = new Set();

    this.nodes.forEach((node, nodeId) => {
      if (!visited.has(nodeId)) {
        const component = this.bfs(nodeId, visited);
        this.analysis.topology.components.push({
          id: this.analysis.topology.components.length,
          nodes: component,
          size: component.length
        });
      }
    });

    // Sort by size descending
    this.analysis.topology.components.sort((a, b) => b.size - a.size);

    // Mark isolated components (not the largest one)
    if (this.analysis.topology.components.length > 1) {
      const mainComponent = this.analysis.topology.components[0];
      this.analysis.topology.isolatedComponents = this.analysis.topology.components.slice(1);

      console.log(`🔗 Found ${this.analysis.topology.components.length} components, ${this.analysis.topology.isolatedComponents.length} isolated`);
    }
  }

  bfs(startNode, visited) {
    const queue = [startNode];
    const component = [];

    while (queue.length > 0) {
      const nodeId = queue.shift();
      if (visited.has(nodeId)) continue;

      visited.add(nodeId);
      component.push(nodeId);

      const neighbors = this.adjacency.get(nodeId) || [];
      neighbors.forEach(neighbor => {
        if (!visited.has(neighbor)) {
          queue.push(neighbor);
        }
      });
    }

    return component;
  }

  /**
   * Compute betweenness centrality using Brandes algorithm
   * This is critical for identifying important corridors
   */
  computeBetweennessCentrality() {
    const nodeCentrality = new Map();
    const edgeCentrality = new Map();

    // Initialize
    this.nodes.forEach((_, nodeId) => nodeCentrality.set(nodeId, 0));
    this.edges.forEach(edge => edgeCentrality.set(edge.id, 0));

    // Sample nodes for large graphs (full computation is O(V*E))
    const nodeArray = Array.from(this.nodes.keys());
    const sampleSize = Math.min(nodeArray.length, 30); // Reduced for faster performance
    const sampledNodes = this.sampleArray(nodeArray, sampleSize);

    // Brandes algorithm for each source
    sampledNodes.forEach(source => {
      const { sigma, predecessors, distances } = this.bfsSingleSource(source);

      // Backward pass to accumulate dependencies
      const delta = new Map();
      this.nodes.forEach((_, v) => delta.set(v, 0));

      // Get nodes in order of decreasing distance
      const nodesByDist = Array.from(distances.entries())
        .filter(([_, d]) => d !== Infinity)
        .sort((a, b) => b[1] - a[1])
        .map(([v, _]) => v);

      nodesByDist.forEach(w => {
        if (w === source) return;

        const preds = predecessors.get(w) || [];
        preds.forEach(v => {
          const c = (sigma.get(v) / sigma.get(w)) * (1 + delta.get(w));
          delta.set(v, delta.get(v) + c);

          // Edge betweenness
          const edge = this.findEdgeBetween(v, w);
          if (edge) {
            edgeCentrality.set(edge.id, (edgeCentrality.get(edge.id) || 0) + c);
          }
        });

        if (w !== source) {
          nodeCentrality.set(w, nodeCentrality.get(w) + delta.get(w));
        }
      });
    });

    // Normalize by sample ratio
    const scaleFactor = nodeArray.length / sampleSize;

    nodeCentrality.forEach((val, key) => {
      nodeCentrality.set(key, val * scaleFactor);
    });

    edgeCentrality.forEach((val, key) => {
      edgeCentrality.set(key, val * scaleFactor);
    });

    // Store results
    this.analysis.centrality.nodeBetweenness = nodeCentrality;
    this.analysis.centrality.edgeBetweenness = edgeCentrality;
    this.analysis.centrality.maxNodeCentrality = Math.max(...nodeCentrality.values());
    this.analysis.centrality.maxEdgeCentrality = Math.max(...edgeCentrality.values());

    console.log(`📈 Centrality computed: max node=${this.analysis.centrality.maxNodeCentrality.toFixed(2)}, max edge=${this.analysis.centrality.maxEdgeCentrality.toFixed(2)}`);
  }

  bfsSingleSource(source) {
    const sigma = new Map();   // Number of shortest paths
    const distances = new Map(); // Distance from source
    const predecessors = new Map(); // Predecessors on shortest paths

    this.nodes.forEach((_, v) => {
      sigma.set(v, 0);
      distances.set(v, Infinity);
      predecessors.set(v, []);
    });

    sigma.set(source, 1);
    distances.set(source, 0);

    const queue = [source];

    while (queue.length > 0) {
      const v = queue.shift();
      const neighbors = this.adjacency.get(v) || [];

      neighbors.forEach(w => {
        // First visit
        if (distances.get(w) === Infinity) {
          distances.set(w, distances.get(v) + 1);
          queue.push(w);
        }

        // Shortest path found
        if (distances.get(w) === distances.get(v) + 1) {
          sigma.set(w, sigma.get(w) + sigma.get(v));
          predecessors.get(w).push(v);
        }
      });
    }

    return { sigma, predecessors, distances };
  }

  findEdgeBetween(node1, node2) {
    return this.edges.find(e =>
      (e.start === node1 && e.end === node2) ||
      (e.start === node2 && e.end === node1)
    );
  }

  sampleArray(arr, n) {
    if (arr.length <= n) return arr;
    const shuffled = [...arr].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, n);
  }

  /**
   * Find bridges and articulation points using Tarjan's algorithm
   */
  findBridgesAndArticulationPoints() {
    this.analysis.topology.bridges = [];
    this.analysis.topology.articulationPoints = [];

    const visited = new Set();
    const disc = new Map();     // Discovery time
    const low = new Map();      // Lowest reachable
    const parent = new Map();   // Parent in DFS tree
    const isAP = new Set();     // Articulation points

    let time = 0;

    const dfs = (u) => {
      let children = 0;
      visited.add(u);
      disc.set(u, time);
      low.set(u, time);
      time++;

      const neighbors = this.adjacency.get(u) || [];

      neighbors.forEach(v => {
        if (!visited.has(v)) {
          children++;
          parent.set(v, u);
          dfs(v);

          low.set(u, Math.min(low.get(u), low.get(v)));

          // Check if u is an articulation point
          if (parent.get(u) === undefined && children > 1) {
            isAP.add(u);
          }
          if (parent.get(u) !== undefined && low.get(v) >= disc.get(u)) {
            isAP.add(u);
          }

          // Check if u-v is a bridge
          if (low.get(v) > disc.get(u)) {
            const edge = this.findEdgeBetween(u, v);
            if (edge) {
              this.analysis.topology.bridges.push(edge.id);
            }
          }
        } else if (v !== parent.get(u)) {
          low.set(u, Math.min(low.get(u), disc.get(v)));
        }
      });
    };

    // Run DFS from each unvisited node
    this.nodes.forEach((_, nodeId) => {
      if (!visited.has(nodeId)) {
        dfs(nodeId);
      }
    });

    this.analysis.topology.articulationPoints = Array.from(isAP);

    console.log(`🌉 Found ${this.analysis.topology.bridges.length} bridges, ${this.analysis.topology.articulationPoints.length} articulation points`);
  }

  /**
   * Analyze geometry quality
   */
  analyzeGeometry(geojson) {
    this.analysis.geometry.sharpAngles = [];
    this.analysis.geometry.zigzagSegments = [];
    this.analysis.geometry.shortStubs = [];
    this.analysis.geometry.longLinks = [];
    this.analysis.geometry.smoothnessScores = [];

    // Track smoothness scores for overall calculation
    let totalSmoothnessScore = 0;
    let edgeCount = 0;

    // Check each edge
    this.edges.forEach(edge => {
      // Short stubs
      if (edge.length < this.config.shortStubThreshold) {
        this.analysis.geometry.shortStubs.push({
          edgeId: edge.id,
          length: edge.length,
          coords: edge.coordinates
        });
      }

      // Long links
      if (edge.length > this.config.longLinkThreshold) {
        this.analysis.geometry.longLinks.push({
          edgeId: edge.id,
          length: edge.length,
          coords: edge.coordinates
        });
      }

      // Zigzag detection
      if (this.isZigzag(edge.coordinates)) {
        this.analysis.geometry.zigzagSegments.push({
          edgeId: edge.id,
          coords: edge.coordinates
        });
      }

      // Calculate smoothness score for this edge (0-100, higher = smoother)
      const smoothness = this.calculateEdgeSmoothness(edge.coordinates);
      edge.smoothness = smoothness;
      this.analysis.geometry.smoothnessScores.push({
        edgeId: edge.id,
        smoothness: smoothness
      });
      totalSmoothnessScore += smoothness;
      edgeCount++;
    });

    // Calculate overall network smoothness score
    this.analysis.geometry.overallSmoothness = edgeCount > 0
      ? totalSmoothnessScore / edgeCount
      : 100;

    // Check nodes for sharp angles
    this.nodes.forEach((node, nodeId) => {
      if (node.degree >= 2) {
        const angles = this.getNodeAngles(nodeId);
        const sharpAngle = angles.find(a => a < this.config.sharpAngleThreshold);
        if (sharpAngle !== undefined) {
          this.analysis.geometry.sharpAngles.push({
            nodeId: nodeId,
            coords: node.coords,
            angle: sharpAngle
          });
        }
      }
    });

    console.log(`📐 Geometry issues: ${this.analysis.geometry.shortStubs.length} short stubs, ${this.analysis.geometry.longLinks.length} long links, ${this.analysis.geometry.sharpAngles.length} sharp angles, ${this.analysis.geometry.zigzagSegments.length} zigzag segments`);
    console.log(`📊 Network smoothness score: ${this.analysis.geometry.overallSmoothness.toFixed(1)}/100`);
  }

  /**
   * Calculate smoothness score for an edge (0-100, higher = smoother)
   * Based on angle deviations from straight line
   */
  calculateEdgeSmoothness(coords) {
    if (coords.length < 3) return 100; // Straight line is perfectly smooth

    let totalDeviation = 0;
    let segmentCount = 0;

    for (let i = 1; i < coords.length - 1; i++) {
      const angle = this.calculateAngle(coords[i-1], coords[i], coords[i+1]);
      // Angle of 180 = perfectly straight, deviation = 180 - angle
      const deviation = Math.abs(180 - angle);
      totalDeviation += deviation;
      segmentCount++;
    }

    if (segmentCount === 0) return 100;

    // Average deviation (0-180)
    const avgDeviation = totalDeviation / segmentCount;

    // Convert to 0-100 score (0 deviation = 100, 90 deviation = 50, 180 deviation = 0)
    const smoothness = Math.max(0, 100 - (avgDeviation * 100 / 90));

    return smoothness;
  }

  /**
   * Get smoothness score for an edge
   */
  getEdgeSmoothness(edgeId) {
    const edge = this.edges.find(e => e.id === edgeId);
    return edge ? edge.smoothness || 100 : 100;
  }

  /**
   * Get overall network smoothness
   */
  getOverallSmoothness() {
    return this.analysis.geometry.overallSmoothness || 100;
  }

  isZigzag(coords) {
    if (coords.length < this.config.zigzagMinSegments + 1) return false;

    const angles = [];
    for (let i = 1; i < coords.length - 1; i++) {
      const angle = this.calculateAngle(coords[i-1], coords[i], coords[i+1]);
      angles.push(angle);
    }

    // Check for alternating angle pattern
    let zigzagCount = 0;
    for (let i = 0; i < angles.length - 1; i++) {
      const angle1 = angles[i];
      const angle2 = angles[i + 1];

      // Check if angles alternate between zigzag range
      const inRange1 = angle1 >= this.config.zigzagAngleRange[0] && angle1 <= this.config.zigzagAngleRange[1];
      const inRange2 = angle2 >= this.config.zigzagAngleRange[0] && angle2 <= this.config.zigzagAngleRange[1];

      if (inRange1 && inRange2) {
        zigzagCount++;
      }
    }

    return zigzagCount >= 2;
  }

  getNodeAngles(nodeId) {
    const node = this.nodes.get(nodeId);
    if (!node || node.edges.length < 2) return [];

    // Get direction vectors for each connected edge
    const directions = [];

    node.edges.forEach(edgeId => {
      const edge = this.edges.find(e => e.id === edgeId);
      if (!edge) return;

      let direction;
      if (edge.start === nodeId) {
        // Edge goes outward from this node
        const nextPoint = edge.coordinates[1];
        direction = this.normalizeVector([
          nextPoint[0] - node.coords[0],
          nextPoint[1] - node.coords[1]
        ]);
      } else {
        // Edge comes into this node
        const prevPoint = edge.coordinates[edge.coordinates.length - 2];
        direction = this.normalizeVector([
          node.coords[0] - prevPoint[0],
          node.coords[1] - prevPoint[1]
        ]);
      }

      if (direction) directions.push(direction);
    });

    // Calculate angles between all pairs of directions
    const angles = [];
    for (let i = 0; i < directions.length; i++) {
      for (let j = i + 1; j < directions.length; j++) {
        const angle = this.angleBetweenVectors(directions[i], directions[j]);
        angles.push(angle);
      }
    }

    return angles;
  }

  calculateAngle(p1, p2, p3) {
    const v1 = [p1[0] - p2[0], p1[1] - p2[1]];
    const v2 = [p3[0] - p2[0], p3[1] - p2[1]];

    const dot = v1[0] * v2[0] + v1[1] * v2[1];
    const mag1 = Math.sqrt(v1[0] * v1[0] + v1[1] * v1[1]);
    const mag2 = Math.sqrt(v2[0] * v2[0] + v2[1] * v2[1]);

    if (mag1 === 0 || mag2 === 0) return 180;

    const cosAngle = Math.max(-1, Math.min(1, dot / (mag1 * mag2)));
    return Math.acos(cosAngle) * (180 / Math.PI);
  }

  normalizeVector(v) {
    const mag = Math.sqrt(v[0] * v[0] + v[1] * v[1]);
    if (mag === 0) return null;
    return [v[0] / mag, v[1] / mag];
  }

  angleBetweenVectors(v1, v2) {
    const dot = v1[0] * v2[0] + v1[1] * v2[1];
    const cosAngle = Math.max(-1, Math.min(1, dot));
    return Math.acos(cosAngle) * (180 / Math.PI);
  }

  /**
   * Calculate length of a coordinate array in meters
   */
  calculateLength(coords) {
    let length = 0;
    for (let i = 1; i < coords.length; i++) {
      length += this.haversine(coords[i-1], coords[i]);
    }
    return length;
  }

  haversine(coord1, coord2) {
    const R = 6371e3; // Earth radius in meters
    const lat1 = coord1[1] * Math.PI / 180;
    const lat2 = coord2[1] * Math.PI / 180;
    const dLat = (coord2[1] - coord1[1]) * Math.PI / 180;
    const dLon = (coord2[0] - coord1[0]) * Math.PI / 180;

    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1) * Math.cos(lat2) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c;
  }

  /**
   * Consolidate all detected problems into a unified list
   * Only flags significant issues - not every boundary node or minor variation
   */
  consolidateProblems() {
    this.analysis.problems = [];

    // Calculate network bounds to identify boundary nodes (which are normal, not problems)
    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    this.nodes.forEach(node => {
      if (node.coords[0] < minLng) minLng = node.coords[0];
      if (node.coords[0] > maxLng) maxLng = node.coords[0];
      if (node.coords[1] < minLat) minLat = node.coords[1];
      if (node.coords[1] > maxLat) maxLat = node.coords[1];
    });
    const lngRange = maxLng - minLng;
    const latRange = maxLat - minLat;
    const boundaryThreshold = 0.02; // 2% from edge is considered boundary

    // Helper to check if node is on network boundary
    const isOnBoundary = (coords) => {
      const lngRatio = (coords[0] - minLng) / lngRange;
      const latRatio = (coords[1] - minLat) / latRange;
      return lngRatio < boundaryThreshold || lngRatio > (1 - boundaryThreshold) ||
             latRatio < boundaryThreshold || latRatio > (1 - boundaryThreshold);
    };

    // Dead ends: Only flag degree-1 nodes that are NOT on the boundary
    // (Boundary nodes with degree 1 are normal - they're just at the edge of the mapped area)
    let internalDeadEnds = 0;
    this.nodes.forEach((node, nodeId) => {
      if (node.degree === 1 && !isOnBoundary(node.coords)) {
        internalDeadEnds++;
        // Only add a limited number to avoid clutter
        if (internalDeadEnds <= 20) {
          this.analysis.problems.push({
            type: 'dead-end',
            severity: 'warning',
            nodeId: nodeId,
            coords: node.coords,
            message: 'Dead-end detected - may need connection to nearby path'
          });
        }
      }
    });

    // Isolated components - only add ONE marker per component at its centroid
    this.analysis.topology.isolatedComponents.forEach(comp => {
      // Calculate centroid of the component
      let sumLng = 0, sumLat = 0, count = 0;
      comp.nodes.forEach(nodeId => {
        const node = this.nodes.get(nodeId);
        if (node) {
          sumLng += node.coords[0];
          sumLat += node.coords[1];
          count++;
        }
      });
      if (count > 0) {
        this.analysis.problems.push({
          type: 'isolated-component',
          severity: 'error',
          componentId: comp.id,
          size: comp.size,
          coords: [sumLng / count, sumLat / count],
          message: `Isolated subgraph with ${comp.size} nodes - disconnected from main network`
        });
      }
    });

    // Bridges: Only flag a subset - too many bridges in grid networks
    const maxBridges = 15;
    const bridgesToShow = this.analysis.topology.bridges.slice(0, maxBridges);
    bridgesToShow.forEach(edgeId => {
      const edge = this.edges.find(e => e.id === edgeId);
      if (edge) {
        const midpoint = edge.coordinates[Math.floor(edge.coordinates.length / 2)];
        this.analysis.problems.push({
          type: 'bridge',
          severity: 'info',
          edgeId: edgeId,
          coords: midpoint,
          message: 'Bridge edge - removing would disconnect part of network'
        });
      }
    });

    // Articulation points: Only show a subset
    const maxAP = 10;
    const apsToShow = this.analysis.topology.articulationPoints.slice(0, maxAP);
    apsToShow.forEach(nodeId => {
      const node = this.nodes.get(nodeId);
      if (node) {
        this.analysis.problems.push({
          type: 'articulation-point',
          severity: 'info',
          nodeId: nodeId,
          coords: node.coords,
          message: 'Articulation point - removing would disconnect part of network'
        });
      }
    });

    // Short stubs - already filtered by threshold
    this.analysis.geometry.shortStubs.forEach(stub => {
      const midpoint = stub.coords[Math.floor(stub.coords.length / 2)];
      this.analysis.problems.push({
        type: 'short-stub',
        severity: 'warning',
        edgeId: stub.edgeId,
        coords: midpoint,
        length: stub.length,
        message: `Very short segment (${stub.length.toFixed(1)}m) - may be noise or error`
      });
    });

    // Long links - already filtered by threshold
    this.analysis.geometry.longLinks.forEach(link => {
      const midpoint = link.coords[Math.floor(link.coords.length / 2)];
      this.analysis.problems.push({
        type: 'long-link',
        severity: 'warning',
        edgeId: link.edgeId,
        coords: midpoint,
        length: link.length,
        message: `Very long segment (${link.length.toFixed(0)}m) - may need intermediate nodes`
      });
    });

    // Sharp angles - only really sharp ones are problems
    this.analysis.geometry.sharpAngles.forEach(angle => {
      this.analysis.problems.push({
        type: 'sharp-angle',
        severity: 'warning',
        nodeId: angle.nodeId,
        coords: angle.coords,
        angle: angle.angle,
        message: `Sharp angle (${angle.angle.toFixed(1)}°) - unusual for pedestrian paths`
      });
    });

    // Zigzag segments
    this.analysis.geometry.zigzagSegments.forEach(zigzag => {
      const midpoint = zigzag.coords[Math.floor(zigzag.coords.length / 2)];
      this.analysis.problems.push({
        type: 'zigzag',
        severity: 'warning',
        edgeId: zigzag.edgeId,
        coords: midpoint,
        message: 'Zigzag pattern detected - may indicate noisy data or digitization error'
      });
    });

    console.log(`🚩 Total problems flagged: ${this.analysis.problems.length}`);
  }

  /**
   * Update state manager with analysis results
   */
  updateState() {
    this.stateManager.batchUpdate({
      'data.analysis.centrality': {
        maxNode: this.analysis.centrality.maxNodeCentrality,
        maxEdge: this.analysis.centrality.maxEdgeCentrality
      },
      'data.analysis.topology': {
        componentCount: this.analysis.topology.components.length,
        isolatedCount: this.analysis.topology.isolatedComponents.length,
        bridgeCount: this.analysis.topology.bridges.length,
        articulationPointCount: this.analysis.topology.articulationPoints.length
      },
      'data.analysis.geometry': {
        shortStubs: this.analysis.geometry.shortStubs.length,
        longLinks: this.analysis.geometry.longLinks.length,
        sharpAngles: this.analysis.geometry.sharpAngles.length,
        zigzags: this.analysis.geometry.zigzagSegments.length
      },
      'data.analysis.problems': this.analysis.problems
    });
  }

  /**
   * Update UI with analysis results
   */
  updateAnalysisUI() {
    this.updateMetricsDashboard();
    this.updateProblemsPanel();
    this.updateStatsBar();
  }

  /**
   * Update the stats bar at the bottom of Idea B
   */
  updateStatsBar() {
    // Calculate total length
    const totalLength = this.edges.reduce((sum, edge) => sum + (edge.length || 0), 0);

    // Calculate connectivity score (0-100)
    const mainComponentSize = this.analysis.topology.components.length > 0
      ? this.analysis.topology.components[0].size
      : this.nodes.size;
    const connectivity = this.nodes.size > 0
      ? ((mainComponentSize / this.nodes.size) * 100).toFixed(1)
      : '--';

    // Update DOM elements
    const lengthEl = document.getElementById('stat-length');
    if (lengthEl) {
      lengthEl.textContent = totalLength > 1000
        ? `${(totalLength / 1000).toFixed(1)} km`
        : `${totalLength.toFixed(0)} m`;
    }

    const connectivityEl = document.getElementById('stat-connectivity');
    if (connectivityEl) {
      connectivityEl.textContent = connectivity + '%';
    }

    const segmentsEl = document.getElementById('stat-segments');
    if (segmentsEl) {
      segmentsEl.textContent = this.edges.length;
    }
  }

  updateMetricsDashboard() {
    const dashboard = document.getElementById('metrics-dashboard');
    if (!dashboard) return;

    const severityCounts = {
      error: this.analysis.problems.filter(p => p.severity === 'error').length,
      warning: this.analysis.problems.filter(p => p.severity === 'warning').length,
      info: this.analysis.problems.filter(p => p.severity === 'info').length
    };

    // Format centrality value - handle edge cases
    const maxCentrality = this.analysis.centrality.maxNodeCentrality;
    let centralityDisplay;
    if (maxCentrality === 0 || maxCentrality === -Infinity || isNaN(maxCentrality)) {
      centralityDisplay = '0';
    } else if (maxCentrality > 1000) {
      centralityDisplay = (maxCentrality / 1000).toFixed(1) + 'k';
    } else {
      centralityDisplay = maxCentrality.toFixed(1);
    }

    // Calculate network health score (0-100)
    const totalNodes = this.nodes.size;
    const mainComponentSize = this.analysis.topology.components.length > 0
      ? this.analysis.topology.components[0].size : totalNodes;
    const connectivityScore = totalNodes > 0 ? ((mainComponentSize / totalNodes) * 100).toFixed(0) : '--';

    dashboard.innerHTML = `
      <div class="metrics-header">
        <h3>Network Analysis</h3>
        <p class="metrics-subtitle">Click metrics to highlight on map</p>
      </div>

      <div class="metrics-grid">
        <!-- Centrality -->
        <div class="metric-card clickable" data-metric="centrality">
          <div class="metric-icon centrality-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>
              <path d="M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
            </svg>
          </div>
          <div class="metric-content">
            <span class="metric-label">Betweenness Centrality</span>
            <span class="metric-value">${centralityDisplay}</span>
            <span class="metric-sub">max node score</span>
          </div>
        </div>

        <!-- Components -->
        <div class="metric-card clickable ${this.analysis.topology.isolatedComponents.length > 0 ? 'has-issues' : ''}" data-metric="components">
          <div class="metric-icon components-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="5" cy="6" r="3"/>
              <circle cx="19" cy="6" r="3"/>
              <circle cx="12" cy="18" r="3"/>
              <path d="M5 9v6M19 9v6M8 15h8"/>
            </svg>
          </div>
          <div class="metric-content">
            <span class="metric-label">Connected Components</span>
            <span class="metric-value">${this.analysis.topology.components.length}</span>
            <span class="metric-sub ${this.analysis.topology.isolatedComponents.length > 0 ? 'warning' : ''}">${this.analysis.topology.isolatedComponents.length} isolated</span>
          </div>
        </div>

        <!-- Bridges -->
        <div class="metric-card clickable" data-metric="bridges">
          <div class="metric-icon bridges-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M2 16h20M4 12h16M6 8h12"/>
              <path d="M4 16v2M20 16v2"/>
            </svg>
          </div>
          <div class="metric-content">
            <span class="metric-label">Critical Edges</span>
            <span class="metric-value">${this.analysis.topology.bridges.length}</span>
            <span class="metric-sub">bridge segments</span>
          </div>
        </div>

        <!-- Problems Summary -->
        <div class="metric-card clickable ${severityCounts.error > 0 ? 'has-errors' : severityCounts.warning > 0 ? 'has-warnings' : ''}" data-metric="problems">
          <div class="metric-icon problems-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          </div>
          <div class="metric-content">
            <span class="metric-label">Issues Found</span>
            <span class="metric-value">${this.analysis.problems.length}</span>
            <span class="metric-sub">${severityCounts.error} errors, ${severityCounts.warning} warnings</span>
          </div>
        </div>
      </div>

      <!-- Network Summary -->
      <div class="network-summary">
        <div class="summary-item">
          <span class="summary-label">Nodes</span>
          <span class="summary-value">${this.nodes.size}</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">Edges</span>
          <span class="summary-value">${this.edges.length}</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">Connectivity</span>
          <span class="summary-value">${connectivityScore}%</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">Smoothness</span>
          <span class="summary-value ${this.analysis.geometry.overallSmoothness < 70 ? 'warning' : ''}">${(this.analysis.geometry.overallSmoothness || 100).toFixed(0)}%</span>
        </div>
      </div>
    `;

    // Add click handlers for highlighting
    dashboard.querySelectorAll('.metric-card.clickable').forEach(card => {
      card.addEventListener('click', () => {
        const metric = card.dataset.metric;
        this.highlightMetric(metric);
      });
    });
  }

  updateProblemsPanel() {
    const panel = document.getElementById('problems-panel');
    if (!panel) return;

    // Group problems by type
    const grouped = {};
    this.analysis.problems.forEach(p => {
      if (!grouped[p.type]) grouped[p.type] = [];
      grouped[p.type].push(p);
    });

    const typeLabels = {
      'dead-end': 'Dead Ends',
      'isolated-component': 'Isolated Subgraphs',
      'bridge': 'Bridge Edges',
      'articulation-point': 'Articulation Points',
      'short-stub': 'Short Stubs',
      'long-link': 'Long Links',
      'sharp-angle': 'Sharp Angles',
      'zigzag': 'Zigzag Patterns'
    };

    const typeIcons = {
      'dead-end': '🔴',
      'isolated-component': '🟡',
      'bridge': '🌉',
      'articulation-point': '📍',
      'short-stub': '📏',
      'long-link': '📐',
      'sharp-angle': '📐',
      'zigzag': '〰️'
    };

    panel.innerHTML = `
      <div class="problems-header">
        <h3>Flagged Issues</h3>
        <span class="problems-count">${this.analysis.problems.length} total</span>
      </div>

      <div class="problems-list">
        ${Object.entries(grouped).map(([type, problems]) => `
          <div class="problem-group">
            <div class="problem-group-header" data-type="${type}">
              <span class="problem-icon">${typeIcons[type] || '⚠️'}</span>
              <span class="problem-type">${typeLabels[type] || type}</span>
              <span class="problem-count">${problems.length}</span>
              <svg class="expand-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M6 9l6 6 6-6"/>
              </svg>
            </div>
            <div class="problem-items" style="display: none;">
              ${problems.slice(0, 10).map(p => `
                <div class="problem-item ${p.severity}" data-coords="${p.coords?.join(',') || ''}" data-type="${p.type}">
                  <span class="problem-severity-dot"></span>
                  <span class="problem-message">${p.message}</span>
                  <button class="view-btn" title="View on map">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <circle cx="11" cy="11" r="8"/>
                      <path d="M21 21l-4.35-4.35"/>
                    </svg>
                  </button>
                </div>
              `).join('')}
              ${problems.length > 10 ? `<div class="more-items">...and ${problems.length - 10} more</div>` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    `;

    // Add expand/collapse handlers
    panel.querySelectorAll('.problem-group-header').forEach(header => {
      header.addEventListener('click', () => {
        const items = header.nextElementSibling;
        const isExpanded = items.style.display !== 'none';
        items.style.display = isExpanded ? 'none' : 'block';
        header.classList.toggle('expanded', !isExpanded);
      });
    });

    // Add view handlers
    panel.querySelectorAll('.problem-item').forEach(item => {
      item.addEventListener('click', () => {
        const coords = item.dataset.coords?.split(',').map(Number);
        if (coords && coords.length === 2) {
          this.flyToLocation(coords);
          this.showImageryViewer(coords, item.dataset.type);
        }
      });
    });
  }

  /**
   * Highlight elements related to a metric on the map
   */
  highlightMetric(metric) {
    const event = new CustomEvent('highlightMetric', {
      detail: { metric, analysis: this.analysis }
    });
    document.dispatchEvent(event);

    console.log(`🔦 Highlighting metric: ${metric}`);
  }

  /**
   * Fly to a location on the map
   */
  flyToLocation(coords) {
    const event = new CustomEvent('flyToLocation', {
      detail: { lng: coords[0], lat: coords[1], zoom: 18 }
    });
    document.dispatchEvent(event);
  }

  /**
   * Show imagery viewer for validation
   */
  showImageryViewer(coords, problemType) {
    const event = new CustomEvent('showImageryViewer', {
      detail: { coords, problemType }
    });
    document.dispatchEvent(event);
  }

  // Public API methods

  getNodeCentrality(nodeId) {
    return this.analysis.centrality.nodeBetweenness.get(nodeId) || 0;
  }

  getEdgeCentrality(edgeId) {
    return this.analysis.centrality.edgeBetweenness.get(edgeId) || 0;
  }

  getNormalizedNodeCentrality(nodeId) {
    const val = this.getNodeCentrality(nodeId);
    const max = this.analysis.centrality.maxNodeCentrality;
    return max > 0 ? val / max : 0;
  }

  getNormalizedEdgeCentrality(edgeId) {
    const val = this.getEdgeCentrality(edgeId);
    const max = this.analysis.centrality.maxEdgeCentrality;
    return max > 0 ? val / max : 0;
  }

  isBridge(edgeId) {
    return this.analysis.topology.bridges.includes(edgeId);
  }

  isArticulationPoint(nodeId) {
    return this.analysis.topology.articulationPoints.includes(nodeId);
  }

  getProblems() {
    return this.analysis.problems;
  }

  getProblemsByType(type) {
    return this.analysis.problems.filter(p => p.type === type);
  }

  getIsolatedComponents() {
    return this.analysis.topology.isolatedComponents;
  }
}

// Make available globally
if (typeof window !== 'undefined') {
  window.NetworkAnalyzer = NetworkAnalyzer;
}
