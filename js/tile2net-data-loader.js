/**
 * Tile2Net Data Loader
 * Loads and processes actual tile2net segmentation outputs
 *
 * =============================================================================
 * HOW TO USE WITH REAL TILE2NET DATA:
 * =============================================================================
 *
 * 1. SEGMENTATION MASKS (PNG format):
 *    - Place your Tile2Net segmentation output images in: data/tiles/predictions/
 *    - Format: PNG images where pixels are colored by class:
 *      - Black (0,0,0): Background
 *      - Green (0,255,0): Road
 *      - Blue (0,0,255): Sidewalk
 *      - Red (255,0,0): Crosswalk
 *    - Naming convention: tile_{row}_{col}.png (e.g., tile_0_0.png, tile_0_1.png)
 *
 * 2. GROUND TRUTH MASKS (PNG format):
 *    - Place ground truth images in: data/tiles/ground_truth/
 *    - Same color encoding as predictions
 *    - Same naming convention
 *
 * 3. TILE INDEX FILE (Optional but recommended):
 *    - Create: data/tiles/tile_index.json
 *    - Format:
 *      {
 *        "tiles": [
 *          {
 *            "id": "tile_0_0",
 *            "row": 0,
 *            "col": 0,
 *            "bounds": [[lat_min, lng_min], [lat_max, lng_max]],
 *            "segmentationPath": "data/tiles/predictions/tile_0_0.png",
 *            "groundTruthPath": "data/tiles/ground_truth/tile_0_0.png"
 *          }
 *        ]
 *      }
 *
 * 4. NETWORK OUTPUT (GeoJSON):
 *    - Place Tile2Net network output at: data/tile2net_output/network.geojson
 *    - This is the final pedestrian network extracted by Tile2Net
 *
 * If real data files are not found, the system automatically generates
 * synthetic demonstration data.
 * =============================================================================
 *
 * Tile2net class encodings:
 * - 0: Background (black)
 * - 1: Road (green)
 * - 2: Sidewalk (blue)
 * - 3: Crosswalk (red)
 */

class Tile2NetDataLoader {
  constructor(stateManager) {
    this.stateManager = stateManager;

    // Tile2net class labels
    this.classLabels = {
      0: 'background',
      1: 'road',
      2: 'sidewalk',
      3: 'crosswalk'
    };

    // Colors for segmentation classes (RGBA)
    this.classColors = {
      background: [0, 0, 0, 0],          // Transparent
      road: [76, 175, 80, 180],          // Green
      sidewalk: [33, 150, 243, 180],     // Blue
      crosswalk: [244, 67, 54, 180]      // Red
    };

    // Ground truth colors (slightly different for comparison)
    this.groundTruthColors = {
      background: [0, 0, 0, 0],
      road: [129, 199, 132, 180],        // Light green
      sidewalk: [100, 181, 246, 180],    // Light blue
      crosswalk: [239, 154, 154, 180]    // Light red
    };

    // Loaded data
    this.tiles = [];
    this.segmentationMasks = new Map();
    this.groundTruthMasks = new Map();
    this.polygons = null;
    this.network = null;

    // Data source tracking
    this.usingSyntheticData = false;
    this.loadedRealTiles = 0;
    this.totalTiles = 0;

    // Computed data
    this.errorRegions = [];
    this.confidenceMap = [];
    this.statistics = {};
  }

  /**
   * Load project configuration
   * @param {string} configPath - Path to tile2net project info JSON
   */
  async loadProject(configPath) {
    console.log('📂 Loading Tile2Net project from:', configPath);

    try {
      const response = await fetch(configPath);
      if (!response.ok) {
        throw new Error(`Failed to load config: ${response.status}`);
      }

      this.projectConfig = await response.json();
      console.log('✅ Project config loaded:', this.projectConfig);

      return this.projectConfig;
    } catch (error) {
      console.error('❌ Failed to load project config:', error);
      throw error;
    }
  }

  /**
   * Load tile grid from tile2net output
   * @param {string} tilesPath - Path to tiles index JSON
   */
  async loadTileGrid(tilesPath) {
    console.log('🗺️ Loading tile grid...');

    try {
      const response = await fetch(tilesPath);
      if (!response.ok) {
        // Create synthetic tile grid if not available
        console.warn('Tile grid not found, creating synthetic grid');
        return this.createSyntheticTileGrid();
      }

      const tilesData = await response.json();
      this.tiles = tilesData.tiles || [];

      console.log(`✅ Loaded ${this.tiles.length} tiles`);
      return this.tiles;
    } catch (error) {
      console.warn('Could not load tile grid, creating synthetic:', error);
      return this.createSyntheticTileGrid();
    }
  }

  /**
   * Load tiles from configured directory structure
   * Uses paths from config.json segmentation section
   * @param {Object} config - Configuration object with segmentation paths
   */
  async loadTilesFromConfig(config) {
    console.log('📂 Loading tiles from config...');

    const segConfig = config.segmentation;
    if (!segConfig) {
      console.warn('No segmentation config found, using synthetic data');
      return this.createSyntheticTileGrid();
    }

    // Try to load tile index file first
    if (segConfig.tileIndexFile) {
      try {
        const response = await fetch(segConfig.tileIndexFile);
        if (response.ok) {
          const indexData = await response.json();
          this.tiles = indexData.tiles || [];
          this.totalTiles = this.tiles.length;
          console.log(`✅ Loaded ${this.tiles.length} tiles from index file`);
          return this.tiles;
        }
      } catch (e) {
        console.warn('Could not load tile index file:', e);
      }
    }

    // If no index file, try to construct tiles from directory
    // This requires knowing the grid dimensions from config
    if (segConfig.gridSize) {
      return this.createTileGridFromConfig(segConfig);
    }

    // Fallback to synthetic
    console.warn('No tile data found, using synthetic demonstration data');
    return this.createSyntheticTileGrid();
  }

  /**
   * Create tile grid from config with specified grid size
   * @param {Object} segConfig - Segmentation configuration
   */
  createTileGridFromConfig(segConfig) {
    const gridSize = segConfig.gridSize || { rows: 5, cols: 5 };
    const center = this.stateManager.getState('viewport.center') || [40.7484, -73.9857];
    const tileSize = segConfig.tileSize || 256;
    const tileSpan = 0.003; // ~300m per tile

    this.tiles = [];

    for (let row = 0; row < gridSize.rows; row++) {
      for (let col = 0; col < gridSize.cols; col++) {
        const rowOffset = row - Math.floor(gridSize.rows / 2);
        const colOffset = col - Math.floor(gridSize.cols / 2);

        const tileCenterLat = center[0] + rowOffset * tileSpan;
        const tileCenterLng = center[1] + colOffset * tileSpan;
        const halfSpan = tileSpan / 2;

        const tileId = `tile_${row}_${col}`;

        this.tiles.push({
          id: tileId,
          row: row,
          col: col,
          bounds: [
            [tileCenterLat - halfSpan, tileCenterLng - halfSpan],
            [tileCenterLat + halfSpan, tileCenterLng + halfSpan]
          ],
          center: [tileCenterLat, tileCenterLng],
          segmentationPath: `${segConfig.predictionsDirectory}/${tileId}.${segConfig.tileFormat || 'png'}`,
          groundTruthPath: `${segConfig.groundTruthDirectory}/${tileId}.${segConfig.tileFormat || 'png'}`
        });
      }
    }

    this.totalTiles = this.tiles.length;
    console.log(`✅ Created tile grid from config: ${this.tiles.length} tiles`);
    return this.tiles;
  }

  /**
   * Get data source status (for UI display)
   */
  getDataSourceStatus() {
    return {
      usingSyntheticData: this.usingSyntheticData,
      loadedRealTiles: this.loadedRealTiles,
      totalTiles: this.totalTiles,
      syntheticReason: this.usingSyntheticData ?
        'Real segmentation masks not found. Place PNG files in data/tiles/predictions/' : null
    };
  }

  /**
   * Create synthetic tile grid for demonstration
   * Uses the current viewport extent - creates tiles covering visible area
   */
  createSyntheticTileGrid() {
    const center = this.stateManager.getState('viewport.center');
    const zoom = this.stateManager.getState('viewport.zoom');

    // Create a 5x5 grid of tiles around center to cover more area
    const gridSize = 5;
    // Each tile covers approximately 0.003 degrees (~300m at this latitude)
    const tileSpan = 0.003;

    this.tiles = [];

    for (let row = 0; row < gridSize; row++) {
      for (let col = 0; col < gridSize; col++) {
        // Calculate tile center offset from viewport center
        const rowOffset = row - Math.floor(gridSize / 2);
        const colOffset = col - Math.floor(gridSize / 2);

        const tileCenterLat = center[0] + rowOffset * tileSpan;
        const tileCenterLng = center[1] + colOffset * tileSpan;

        const halfSpan = tileSpan / 2;

        this.tiles.push({
          id: `tile_${row}_${col}`,
          row: row,
          col: col,
          bounds: [
            [tileCenterLat - halfSpan, tileCenterLng - halfSpan], // SW corner [lat, lng]
            [tileCenterLat + halfSpan, tileCenterLng + halfSpan]  // NE corner [lat, lng]
          ],
          center: [tileCenterLat, tileCenterLng],
          imagePath: null,
          segmentationPath: null,
          groundTruthPath: null
        });
      }
    }

    console.log(`✅ Created synthetic grid with ${this.tiles.length} tiles covering viewport`);
    console.log(`   Grid: ${gridSize}x${gridSize}, Tile span: ${tileSpan} degrees`);
    return this.tiles;
  }

  /**
   * Load segmentation mask for a tile
   * For web visualization, we load PNG images instead of .npy files
   * @param {string} tileId - Tile identifier
   * @param {string} maskPath - Path to mask image
   */
  async loadSegmentationMask(tileId, maskPath) {
    console.log(`🎨 Loading segmentation mask for ${tileId}...`);

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';

      img.onload = () => {
        // Convert image to pixel data
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const pixels = this.decodeSegmentationMask(imageData);

        // Generate confidence values based on color purity
        const confidences = this.computeConfidenceFromImage(imageData);

        this.segmentationMasks.set(tileId, {
          width: img.width,
          height: img.height,
          pixels: pixels,
          confidences: confidences,
          path: maskPath,
          synthetic: false
        });

        // Track real tile loading
        this.loadedRealTiles++;

        console.log(`✅ Loaded REAL segmentation mask for ${tileId}: ${img.width}x${img.height}`);
        resolve(this.segmentationMasks.get(tileId));
      };

      img.onerror = () => {
        console.warn(`⚠️ Could not load mask for ${tileId}, generating synthetic`);
        const syntheticMask = this.generateSyntheticMask(tileId);
        this.segmentationMasks.set(tileId, syntheticMask);

        // Track that we're using synthetic data
        this.usingSyntheticData = true;

        // Dispatch event to notify app of synthetic data usage
        document.dispatchEvent(new CustomEvent('syntheticDataUsed', {
          detail: { tileId, reason: 'Mask file not found' }
        }));

        resolve(syntheticMask);
      };

      img.src = maskPath;
    });
  }

  /**
   * Compute confidence values from image color purity
   * Higher color saturation = higher confidence
   * @param {ImageData} imageData - Raw image data
   */
  computeConfidenceFromImage(imageData) {
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;

    const confidences = new Float32Array(width * height);

    for (let i = 0; i < width * height; i++) {
      const r = data[i * 4];
      const g = data[i * 4 + 1];
      const b = data[i * 4 + 2];

      // Calculate color purity as confidence proxy
      // Pure colors (255,0,0), (0,255,0), (0,0,255) = high confidence
      // Mixed colors = lower confidence
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const range = max - min;

      if (max < 50) {
        // Background - high confidence
        confidences[i] = 0.95;
      } else if (range > 150) {
        // Very pure color - high confidence
        confidences[i] = 0.85 + (range / 255) * 0.15;
      } else if (range > 100) {
        // Fairly pure color - medium-high confidence
        confidences[i] = 0.70 + (range / 255) * 0.15;
      } else {
        // Mixed color - lower confidence
        confidences[i] = 0.40 + (range / 255) * 0.30;
      }
    }

    return confidences;
  }

  /**
   * Decode segmentation mask from image data
   * Tile2net typically encodes classes as specific colors
   */
  decodeSegmentationMask(imageData) {
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;

    const pixels = new Uint8Array(width * height);

    for (let i = 0; i < width * height; i++) {
      const r = data[i * 4];
      const g = data[i * 4 + 1];
      const b = data[i * 4 + 2];

      // Decode based on tile2net color scheme:
      // Background: Black (0,0,0)
      // Road: Green
      // Sidewalk: Blue
      // Crosswalk: Red

      if (r < 50 && g < 50 && b < 50) {
        pixels[i] = 0; // Background
      } else if (g > r && g > b) {
        pixels[i] = 1; // Road (green dominant)
      } else if (b > r && b > g) {
        pixels[i] = 2; // Sidewalk (blue dominant)
      } else if (r > g && r > b) {
        pixels[i] = 3; // Crosswalk (red dominant)
      } else {
        pixels[i] = 0; // Default to background
      }
    }

    return pixels;
  }

  /**
   * Generate synthetic segmentation mask for demonstration
   * Creates realistic-looking urban street grid patterns
   */
  generateSyntheticMask(tileId, width = 256, height = 256) {
    const pixels = new Uint8Array(width * height);
    const confidences = new Float32Array(width * height);

    // Parse tile position from id
    const parts = tileId.split('_');
    const row = parseInt(parts[1]) || 0;
    const col = parseInt(parts[2]) || 0;

    // Seed for consistent random patterns per tile
    const seed = row * 17 + col * 31;

    // Street grid parameters - simulate NYC-style block pattern
    const roadWidth = 28;
    const sidewalkWidth = 12;

    // Horizontal street position (varies by row to create grid)
    const hStreetY = height * 0.35 + (row % 2) * height * 0.3;

    // Vertical street position (varies by col to create grid)
    const vStreetX = width * 0.4 + (col % 2) * width * 0.25;

    // Intersection at center of some tiles
    const hasIntersection = (row + col) % 2 === 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;

        // Distance to horizontal street centerline
        const distToHStreet = Math.abs(y - hStreetY);

        // Distance to vertical street centerline
        const distToVStreet = Math.abs(x - vStreetX);

        // Check if on road
        const onHRoad = distToHStreet < roadWidth / 2;
        const onVRoad = distToVStreet < roadWidth / 2;
        const onRoad = onHRoad || onVRoad;

        // Check if on sidewalk (adjacent to road)
        const nearHRoad = distToHStreet < roadWidth / 2 + sidewalkWidth && distToHStreet >= roadWidth / 2;
        const nearVRoad = distToVStreet < roadWidth / 2 + sidewalkWidth && distToVStreet >= roadWidth / 2;
        const onSidewalk = (nearHRoad && !onVRoad) || (nearVRoad && !onHRoad);

        // Crosswalk at intersections
        const atIntersection = onHRoad && onVRoad;
        const crosswalkZone = hasIntersection && atIntersection &&
          ((Math.abs(x - vStreetX) < 15 && distToHStreet < roadWidth/2 + 5) ||
           (Math.abs(y - hStreetY) < 15 && distToVStreet < roadWidth/2 + 5));

        // Assign class
        if (crosswalkZone) {
          pixels[idx] = 3; // Crosswalk
          confidences[idx] = 0.70 + Math.random() * 0.20;
        } else if (onRoad) {
          pixels[idx] = 1; // Road
          confidences[idx] = 0.85 + Math.random() * 0.10;
        } else if (onSidewalk) {
          pixels[idx] = 2; // Sidewalk
          confidences[idx] = 0.75 + Math.random() * 0.15;
        } else {
          // Background
          pixels[idx] = 0;
          confidences[idx] = 0.95 + Math.random() * 0.05;
        }
      }
    }

    return {
      width: width,
      height: height,
      pixels: pixels,
      confidences: confidences,
      synthetic: true
    };
  }

  /**
   * Load ground truth mask for comparison
   * @param {string} tileId - Tile identifier
   * @param {string} gtPath - Path to ground truth image
   */
  async loadGroundTruthMask(tileId, gtPath) {
    // Similar to segmentation mask loading
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';

      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const pixels = this.decodeSegmentationMask(imageData);

        this.groundTruthMasks.set(tileId, {
          width: img.width,
          height: img.height,
          pixels: pixels,
          path: gtPath
        });

        resolve(this.groundTruthMasks.get(tileId));
      };

      img.onerror = () => {
        // Generate synthetic ground truth with intentional differences
        const syntheticGT = this.generateSyntheticGroundTruth(tileId);
        this.groundTruthMasks.set(tileId, syntheticGT);
        resolve(syntheticGT);
      };

      img.src = gtPath;
    });
  }

  /**
   * Generate synthetic ground truth with intentional differences from prediction
   * This allows demonstrating error detection with visible FP/FN regions
   */
  generateSyntheticGroundTruth(tileId) {
    const prediction = this.segmentationMasks.get(tileId);

    if (!prediction) {
      return this.generateSyntheticMask(tileId);
    }

    const { width, height, pixels: predPixels } = prediction;
    const gtPixels = new Uint8Array(width * height);

    // Parse tile position for varied error patterns
    const parts = tileId.split('_');
    const row = parseInt(parts[1]) || 0;
    const col = parseInt(parts[2]) || 0;

    // Create intentional error regions that vary by tile
    for (let i = 0; i < width * height; i++) {
      const x = i % width;
      const y = Math.floor(i / width);

      // False Positive zones: model predicts class, but GT says background
      // Creates rectangular regions where sidewalk/road predictions are wrong
      const fpZone1 = x > width * 0.65 && x < width * 0.85 &&
                      y > height * 0.25 && y < height * 0.45;
      const fpZone2 = (row + col) % 3 === 0 &&
                      x > width * 0.1 && x < width * 0.25 &&
                      y > height * 0.7 && y < height * 0.9;

      // False Negative zones: model predicts background, but GT has a class
      // Simulates missed detections
      const fnZone1 = x > width * 0.15 && x < width * 0.35 &&
                      y > height * 0.55 && y < height * 0.75;
      const fnZone2 = (row + col) % 2 === 1 &&
                      x > width * 0.75 && x < width * 0.95 &&
                      y > height * 0.6 && y < height * 0.8;

      const pred = predPixels[i];

      if ((fpZone1 || fpZone2) && pred !== 0) {
        // False positive: prediction says class, but GT says background
        gtPixels[i] = 0;
      } else if (fnZone1 && pred === 0) {
        // False negative: prediction says background, GT says sidewalk
        gtPixels[i] = 2;
      } else if (fnZone2 && pred === 0) {
        // False negative: prediction says background, GT says road
        gtPixels[i] = 1;
      } else {
        // Correct prediction
        gtPixels[i] = pred;
      }
    }

    return {
      width: width,
      height: height,
      pixels: gtPixels,
      synthetic: true
    };
  }

  /**
   * Compute errors by comparing prediction to ground truth
   * @param {string} tileId - Tile identifier
   */
  computeErrors(tileId) {
    const prediction = this.segmentationMasks.get(tileId);
    const groundTruth = this.groundTruthMasks.get(tileId);

    if (!prediction || !groundTruth) {
      console.warn(`Cannot compute errors for ${tileId}: missing data`);
      return null;
    }

    const { width, height, pixels: predPixels, confidences } = prediction;
    const { pixels: gtPixels } = groundTruth;

    const errors = {
      tileId: tileId,
      width: width,
      height: height,
      falsePositives: [],  // Predicted class but GT says background/different
      falseNegatives: [],  // Predicted background but GT says class
      truePositives: [],   // Correctly predicted class
      trueNegatives: [],   // Correctly predicted background
      confusionMatrix: this.createConfusionMatrix()
    };

    const errorPixels = new Uint8Array(width * height);
    // Error types: 0=correct, 1=false positive, 2=false negative, 3=misclassification

    for (let i = 0; i < width * height; i++) {
      const pred = predPixels[i];
      const gt = gtPixels[i];
      const conf = confidences ? confidences[i] : 0.5;

      const x = i % width;
      const y = Math.floor(i / width);

      // Update confusion matrix
      errors.confusionMatrix[gt][pred]++;

      if (pred === gt) {
        // Correct prediction
        if (pred === 0) {
          errors.trueNegatives.push({ x, y, confidence: conf });
        } else {
          errors.truePositives.push({ x, y, class: pred, confidence: conf });
        }
        errorPixels[i] = 0;
      } else if (pred !== 0 && gt === 0) {
        // False positive: predicted something but GT is background
        errors.falsePositives.push({
          x, y,
          predictedClass: pred,
          confidence: conf
        });
        errorPixels[i] = 1;
      } else if (pred === 0 && gt !== 0) {
        // False negative: predicted background but GT has something
        errors.falseNegatives.push({
          x, y,
          actualClass: gt,
          confidence: conf
        });
        errorPixels[i] = 2;
      } else {
        // Misclassification: predicted wrong class
        errors.falsePositives.push({
          x, y,
          predictedClass: pred,
          actualClass: gt,
          confidence: conf,
          misclassification: true
        });
        errorPixels[i] = 3;
      }
    }

    errors.errorPixels = errorPixels;

    // Compute statistics
    errors.statistics = this.computeErrorStatistics(errors);

    return errors;
  }

  /**
   * Create empty confusion matrix for 4 classes
   */
  createConfusionMatrix() {
    return [
      [0, 0, 0, 0], // Background -> [bg, road, sidewalk, crosswalk]
      [0, 0, 0, 0], // Road -> ...
      [0, 0, 0, 0], // Sidewalk -> ...
      [0, 0, 0, 0]  // Crosswalk -> ...
    ];
  }

  /**
   * Compute error statistics from error data
   */
  computeErrorStatistics(errors) {
    const totalPixels = errors.width * errors.height;
    const tp = errors.truePositives.length;
    const tn = errors.trueNegatives.length;
    const fp = errors.falsePositives.length;
    const fn = errors.falseNegatives.length;

    const accuracy = (tp + tn) / totalPixels;
    const precision = tp / (tp + fp) || 0;
    const recall = tp / (tp + fn) || 0;
    const f1 = 2 * (precision * recall) / (precision + recall) || 0;

    // Per-class IoU
    const iou = {};
    for (let classId = 1; classId <= 3; classId++) {
      const className = this.classLabels[classId];
      const classTP = errors.confusionMatrix[classId][classId];
      const classFP = errors.confusionMatrix.reduce((sum, row) => sum + row[classId], 0) - classTP;
      const classFN = errors.confusionMatrix[classId].reduce((a, b) => a + b, 0) - classTP;

      iou[className] = classTP / (classTP + classFP + classFN) || 0;
    }

    return {
      totalPixels,
      truePositives: tp,
      trueNegatives: tn,
      falsePositives: fp,
      falseNegatives: fn,
      accuracy,
      precision,
      recall,
      f1Score: f1,
      iou,
      meanIoU: (iou.road + iou.sidewalk + iou.crosswalk) / 3
    };
  }

  /**
   * Convert pixel errors to GeoJSON features for visualization
   * @param {string} tileId - Tile identifier
   * @param {Object} errors - Computed errors
   */
  errorsToGeoJSON(tileId, errors) {
    const tile = this.tiles.find(t => t.id === tileId);
    if (!tile) return null;

    const features = [];
    const bounds = tile.bounds;
    const latRange = bounds[1][0] - bounds[0][0];
    const lngRange = bounds[1][1] - bounds[0][1];

    // Cluster nearby error pixels into regions
    const fpRegions = this.clusterErrors(errors.falsePositives, errors.width, errors.height);
    const fnRegions = this.clusterErrors(errors.falseNegatives, errors.width, errors.height);

    // Convert false positive clusters to GeoJSON
    fpRegions.forEach((region, idx) => {
      const centerX = region.centerX / errors.width;
      const centerY = region.centerY / errors.height;
      const radius = Math.sqrt(region.pixels.length) / errors.width * 0.5;

      features.push({
        type: 'Feature',
        properties: {
          id: `fp_${tileId}_${idx}`,
          errorType: 'false_positive',
          pixelCount: region.pixels.length,
          confidence: region.avgConfidence,
          predictedClass: this.classLabels[region.predictedClass],
          tileId: tileId
        },
        geometry: {
          type: 'Point',
          coordinates: [
            bounds[0][1] + centerX * lngRange,
            bounds[0][0] + (1 - centerY) * latRange
          ]
        }
      });
    });

    // Convert false negative clusters to GeoJSON
    fnRegions.forEach((region, idx) => {
      const centerX = region.centerX / errors.width;
      const centerY = region.centerY / errors.height;

      features.push({
        type: 'Feature',
        properties: {
          id: `fn_${tileId}_${idx}`,
          errorType: 'false_negative',
          pixelCount: region.pixels.length,
          confidence: region.avgConfidence,
          actualClass: this.classLabels[region.actualClass],
          tileId: tileId
        },
        geometry: {
          type: 'Point',
          coordinates: [
            bounds[0][1] + centerX * lngRange,
            bounds[0][0] + (1 - centerY) * latRange
          ]
        }
      });
    });

    return {
      type: 'FeatureCollection',
      features: features
    };
  }

  /**
   * Cluster nearby error pixels into regions using simple flood fill
   */
  clusterErrors(errorPixels, width, height) {
    if (!errorPixels || errorPixels.length === 0) return [];

    const regions = [];
    const visited = new Set();
    const threshold = 5; // Max distance to cluster

    // Simple clustering: group nearby pixels
    errorPixels.forEach(pixel => {
      const key = `${pixel.x},${pixel.y}`;
      if (visited.has(key)) return;

      // Find nearby unvisited pixels
      const region = {
        pixels: [pixel],
        centerX: pixel.x,
        centerY: pixel.y,
        avgConfidence: pixel.confidence || 0.5,
        predictedClass: pixel.predictedClass,
        actualClass: pixel.actualClass
      };

      visited.add(key);

      // Add nearby pixels to this region
      errorPixels.forEach(other => {
        const otherKey = `${other.x},${other.y}`;
        if (visited.has(otherKey)) return;

        const dist = Math.sqrt(
          Math.pow(pixel.x - other.x, 2) +
          Math.pow(pixel.y - other.y, 2)
        );

        if (dist < threshold) {
          region.pixels.push(other);
          visited.add(otherKey);
        }
      });

      // Update region center
      region.centerX = region.pixels.reduce((sum, p) => sum + p.x, 0) / region.pixels.length;
      region.centerY = region.pixels.reduce((sum, p) => sum + p.y, 0) / region.pixels.length;
      region.avgConfidence = region.pixels.reduce((sum, p) => sum + (p.confidence || 0.5), 0) / region.pixels.length;

      if (region.pixels.length >= 3) { // Only keep clusters with 3+ pixels
        regions.push(region);
      }
    });

    return regions;
  }

  /**
   * Load tile2net network GeoJSON output
   * @param {string} networkPath - Path to network GeoJSON
   */
  async loadNetwork(networkPath) {
    console.log('🛤️ Loading network from:', networkPath);

    try {
      const response = await fetch(networkPath);
      if (!response.ok) {
        throw new Error(`Failed to load network: ${response.status}`);
      }

      this.network = await response.json();

      // Normalize feature types
      if (this.network.features) {
        this.network.features.forEach(feature => {
          if (feature.properties.f_type) {
            feature.properties.featureType = feature.properties.f_type;
          }
        });
      }

      console.log(`✅ Network loaded: ${this.network.features?.length || 0} features`);
      return this.network;
    } catch (error) {
      console.error('❌ Failed to load network:', error);
      return null;
    }
  }

  /**
   * Load polygon GeoJSON from tile2net
   * @param {string} polygonsPath - Path to polygons GeoJSON
   */
  async loadPolygons(polygonsPath) {
    console.log('🔷 Loading polygons from:', polygonsPath);

    try {
      const response = await fetch(polygonsPath);
      if (!response.ok) {
        throw new Error(`Failed to load polygons: ${response.status}`);
      }

      this.polygons = await response.json();
      console.log(`✅ Polygons loaded: ${this.polygons.features?.length || 0} features`);
      return this.polygons;
    } catch (error) {
      console.error('❌ Failed to load polygons:', error);
      return null;
    }
  }

  /**
   * Create segmentation mask image data for rendering
   * @param {string} tileId - Tile identifier
   * @param {string} mode - 'prediction', 'groundTruth', or 'error'
   */
  createMaskImageData(tileId, mode = 'prediction') {
    let mask;
    let colorMap;

    switch (mode) {
      case 'prediction':
        mask = this.segmentationMasks.get(tileId);
        colorMap = this.classColors;
        break;
      case 'groundTruth':
        mask = this.groundTruthMasks.get(tileId);
        colorMap = this.groundTruthColors;
        break;
      case 'error':
        return this.createErrorMaskImageData(tileId);
      default:
        mask = this.segmentationMasks.get(tileId);
        colorMap = this.classColors;
    }

    if (!mask) return null;

    const { width, height, pixels } = mask;
    const imageData = new ImageData(width, height);

    for (let i = 0; i < width * height; i++) {
      const classId = pixels[i];
      const className = this.classLabels[classId];
      const color = colorMap[className] || colorMap.background;

      imageData.data[i * 4] = color[0];
      imageData.data[i * 4 + 1] = color[1];
      imageData.data[i * 4 + 2] = color[2];
      imageData.data[i * 4 + 3] = color[3];
    }

    return imageData;
  }

  /**
   * Create error visualization mask
   */
  createErrorMaskImageData(tileId) {
    const prediction = this.segmentationMasks.get(tileId);
    const groundTruth = this.groundTruthMasks.get(tileId);

    if (!prediction || !groundTruth) return null;

    const { width, height, pixels: predPixels } = prediction;
    const { pixels: gtPixels } = groundTruth;

    const imageData = new ImageData(width, height);

    // Error colors
    const colors = {
      correct: [0, 255, 0, 80],        // Green - correct
      falsePositive: [255, 0, 0, 150], // Red - false positive
      falseNegative: [255, 165, 0, 150], // Orange - false negative
      misclassification: [255, 0, 255, 150] // Magenta - wrong class
    };

    for (let i = 0; i < width * height; i++) {
      const pred = predPixels[i];
      const gt = gtPixels[i];

      let color;
      if (pred === gt) {
        color = pred === 0 ? [0, 0, 0, 0] : colors.correct;
      } else if (pred !== 0 && gt === 0) {
        color = colors.falsePositive;
      } else if (pred === 0 && gt !== 0) {
        color = colors.falseNegative;
      } else {
        color = colors.misclassification;
      }

      imageData.data[i * 4] = color[0];
      imageData.data[i * 4 + 1] = color[1];
      imageData.data[i * 4 + 2] = color[2];
      imageData.data[i * 4 + 3] = color[3];
    }

    return imageData;
  }

  /**
   * Get confidence data for heatmap visualization
   * @param {string} tileId - Tile identifier
   */
  getConfidenceData(tileId) {
    const mask = this.segmentationMasks.get(tileId);
    if (!mask || !mask.confidences) return [];

    const tile = this.tiles.find(t => t.id === tileId);
    if (!tile) return [];

    const { width, height, confidences } = mask;
    const bounds = tile.bounds;
    const latRange = bounds[1][0] - bounds[0][0];
    const lngRange = bounds[1][1] - bounds[0][1];

    const data = [];
    const sampleRate = 4; // Sample every Nth pixel for performance

    for (let y = 0; y < height; y += sampleRate) {
      for (let x = 0; x < width; x += sampleRate) {
        const idx = y * width + x;
        const conf = confidences[idx];

        // Only include low-confidence points for the heatmap
        if (conf < 0.9) {
          data.push({
            latitude: bounds[0][0] + (1 - y / height) * latRange,
            longitude: bounds[0][1] + (x / width) * lngRange,
            confidence: 1 - conf // Invert so low confidence = high weight
          });
        }
      }
    }

    return data;
  }

  /**
   * Get all data ready for visualization
   */
  async prepareVisualizationData() {
    console.log('📊 Preparing visualization data...');

    // Ensure we have tiles
    if (this.tiles.length === 0) {
      await this.createSyntheticTileGrid();
    }

    // Load/generate masks for all tiles
    for (const tile of this.tiles) {
      if (!this.segmentationMasks.has(tile.id)) {
        await this.loadSegmentationMask(tile.id, tile.segmentationPath);
      }
      if (!this.groundTruthMasks.has(tile.id)) {
        await this.loadGroundTruthMask(tile.id, tile.groundTruthPath);
      }
    }

    // Compute errors for all tiles
    const allErrors = {
      type: 'FeatureCollection',
      features: []
    };

    let totalStats = {
      totalPixels: 0,
      truePositives: 0,
      trueNegatives: 0,
      falsePositives: 0,
      falseNegatives: 0
    };

    for (const tile of this.tiles) {
      const errors = this.computeErrors(tile.id);
      if (errors) {
        const geoJson = this.errorsToGeoJSON(tile.id, errors);
        if (geoJson) {
          allErrors.features.push(...geoJson.features);
        }

        // Aggregate statistics
        totalStats.totalPixels += errors.statistics.totalPixels;
        totalStats.truePositives += errors.statistics.truePositives;
        totalStats.trueNegatives += errors.statistics.trueNegatives;
        totalStats.falsePositives += errors.statistics.falsePositives;
        totalStats.falseNegatives += errors.statistics.falseNegatives;
      }
    }

    // Compute aggregate statistics
    const accuracy = (totalStats.truePositives + totalStats.trueNegatives) / totalStats.totalPixels;
    const precision = totalStats.truePositives / (totalStats.truePositives + totalStats.falsePositives) || 0;
    const recall = totalStats.truePositives / (totalStats.truePositives + totalStats.falseNegatives) || 0;

    this.statistics = {
      ...totalStats,
      accuracy,
      precision,
      recall,
      f1Score: 2 * (precision * recall) / (precision + recall) || 0
    };

    // Collect confidence data from all tiles
    const allConfidenceData = [];
    for (const tile of this.tiles) {
      const confData = this.getConfidenceData(tile.id);
      allConfidenceData.push(...confData);
    }

    console.log('✅ Visualization data prepared');
    console.log(`   - ${allErrors.features.length} error regions`);
    console.log(`   - ${allConfidenceData.length} confidence points`);
    console.log(`   - Overall accuracy: ${(accuracy * 100).toFixed(1)}%`);

    return {
      errors: allErrors,
      confidenceData: allConfidenceData,
      statistics: this.statistics,
      tiles: this.tiles
    };
  }

  /**
   * Get statistics for display
   */
  getStatistics() {
    return this.statistics;
  }

  /**
   * Get class legend data
   */
  getClassLegend() {
    return Object.entries(this.classLabels).map(([id, name]) => ({
      id: parseInt(id),
      name: name,
      color: this.classColors[name]
    }));
  }
}

// Make available globally
if (typeof window !== 'undefined') {
  window.Tile2NetDataLoader = Tile2NetDataLoader;
}
