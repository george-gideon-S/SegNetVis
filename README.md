# SegNetVis: Pedestrian Network Inspector

## Project Goal

**Design and build visualization systems to help domain experts understand, debug, and analyze ML pipelines that generate urban infrastructure maps from aerial imagery.**

Machine learning models like [Tile2Net](https://github.com/VIDA-NYU/tile2net) can automatically extract pedestrian networks (sidewalks, crosswalks, roads) from satellite imagery. However, understanding *why* these models fail and *where* they need improvement requires more than aggregate accuracy metrics. SegNetVis provides an interactive visual analytics environment where urban planners, ML researchers, and infrastructure analysts can deeply investigate model outputs, trace errors from pixels to network topology, and systematically validate extracted infrastructure.

![Segmentation Detective](https://github.com/george-gideon-S/SegNetVis/blob/main/data/sample/output_screenshots/output_screenshot2.png)
![Network Quality Inspector](https://github.com/george-gideon-S/SegNetVis/blob/main/data/sample/output_screenshots/output_screenshot1.png)

## The Problem: Pixel-Topology Gap

Standard ML evaluation metrics (IoU, Precision, Recall) measure pixel-level accuracy but fail to capture what matters for real-world applications: **network usability**. A model can achieve high IoU while producing fragmented, disconnected networks that are useless for routing or accessibility analysis.

**Our Manhattan demonstration reveals this gap:**

- **85.2% Mean IoU** — appears acceptable by standard metrics
- **40.6% Network Connectivity** — critically fragmented in practice
- **22 Isolated Subgraphs** — network unusable for pedestrian routing
- **140 Quality Issues** — detected automatically by graph analysis

This disconnect—where "good" pixel metrics coexist with broken networks—is precisely what SegNetVis makes visible and debuggable.

## Overview

SegNetVis provides a synchronized dual-panel interface that links pixel-level segmentation analysis with graph-level network topology assessment. Domain experts can:

- **Debug ML model outputs** by visualizing exactly where and why predictions differ from ground truth
- **Trace errors across representations** — see how a false negative pixel region causes a network connectivity break
- **Analyze network quality** using graph algorithms (centrality, bridge detection, component analysis)
- **Validate findings interactively** through human-in-the-loop workflows
- **Compare against reference data** (OpenStreetMap, City GIS datasets)

---

## Features

### Segmentation Detective

The Segmentation Detective panel enables pixel-level analysis of semantic segmentation outputs. It helps domain experts understand where the ML model succeeds and fails at classifying aerial imagery into infrastructure categories.

**Display Modes:**

- **Original**: Raw aerial imagery without overlays
- **Prediction**: Model's segmentation output overlaid on the map
- **Ground Truth**: Reference labels for comparison
- **Errors**: Classification of each pixel as True Positive, False Positive, or False Negative
- **Confidence**: Model confidence heatmap (where available)

**Analysis Tools:**

- **Dynamic Metrics**: Accuracy, Precision, Recall, F1 Score, and IoU recalculate in real-time as you pan and zoom, enabling local quality assessment rather than just global statistics
- **Confusion Matrix**: Full 4×4 matrix showing classification patterns between Background, Road, Sidewalk, and Crosswalk classes
- **Per-Class Metrics**: Detailed breakdown of Precision/Recall/F1/IoU for each infrastructure class
- **Class Isolation**: Toggle individual classes (Road, Sidewalk, Crosswalk) to focus analysis on specific infrastructure types
- **Advanced Filters**: Filter by error type (TP/FP/FN) and confidence range to isolate specific failure patterns
- **Magnification Lens**: Circular inspection tool that shows a selected mode inside the lens while dimming the surrounding area—useful for detailed boundary inspection without losing context
- **Opacity Control**: Adjust overlay transparency to balance visibility of predictions against the underlying imagery

### Network Quality Inspector

The Network Quality Inspector panel provides graph-level topology analysis of the extracted pedestrian network. It reveals structural issues that pixel metrics miss—connectivity breaks, isolated components, and critical vulnerabilities.

**Graph Analysis Algorithms:**

- **Betweenness Centrality** (Brandes' algorithm): Identifies the most important edges and nodes for network connectivity—high-centrality elements are critical paths that many routes depend on
- **Bridge Detection** (Tarjan's algorithm): Finds edges whose removal would disconnect the network—these represent single points of failure
- **Articulation Points**: Identifies vertices that are critical for connectivity—intersections where failure would partition the network
- **Connected Components**: Counts isolated subgraphs to quantify network fragmentation

**Issue Detection Categories:**

- **Dead Ends**: Internal network terminations that may indicate missing connections
- **Isolated Subgraphs**: Disconnected components that cannot be reached from the main network
- **Bridge Edges**: Critical links vulnerable to single-point failures
- **Articulation Points**: Critical intersections for network connectivity
- **Sharp Angles**: Geometry anomalies exceeding configurable thresholds (default 30°)

**Visualization Modes:**

- **Quality Mode**: Color edges by overall quality score (Critical → Poor → Fair → Good → Excellent)
- **Centrality Mode**: Color edges and nodes by betweenness centrality to highlight important paths
- **Problems Mode**: Highlight detected issues with severity-coded markers

**Comparison & Validation:**

- **OSM Overlay**: Compare extracted network against OpenStreetMap reference data
- **City Data**: Overlay official city GIS layers (sidewalks in purple, buildings in orange)
- **Flicker Mode**: Rapidly alternate between views at configurable speed for change detection
- **3D View**: Toggle perspective view for spatial context
- **Human-in-the-Loop Validation**: For each flagged issue, mark as "Issue" (confirmed problem) or "Dismissed" (false alarm) to systematically review and correct automated findings

## Quick Start

1. **Clone the repository**

   ```bash
   git clone https://github.com/george-gideon-S/SegNetVis.git
   cd SegNetVis
   ```
2. **Add your Mapbox token**

   Open `js/modern-app.js` and replace the placeholder token:

   ```javascript
   mapboxgl.accessToken = 'YOUR_MAPBOX_TOKEN';
   ```
3. **Serve the application**

   Use any static file server:

   ```bash
   # Python 3
   python -m http.server 8000

   # Node.js
   npx serve .
   ```
4. **Open in browser**

   Navigate to `http://localhost:8000`

## Data Format

### Network Data (GeoJSON)

Place your Tile2Net output in `data/sample/pedestrian-network.geojson`:

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": {
        "type": "LineString",
        "coordinates": [[-73.9857, 40.7484], [-73.9850, 40.7490]]
      },
      "properties": {
        "class": "sidewalk",
        "quality": 0.85
      }
    }
  ]
}
```

### Segmentation Tiles (Optional)

For real Tile2Net segmentation masks, add PNG tiles to `data/tiles/predictions/`:

- Color encoding: Road (green), Sidewalk (blue), Crosswalk (red)
- Update `data/tiles/tile_index.json` with tile bounds

See `data/tiles/README.md` for detailed format specifications.

## Project Structure

```
pedestrian-network-inspector/
├── index.html                 # Main application
├── css/
│   ├── modern-design-system.css  # Design tokens & utilities
│   ├── modern-main.css           # Component styles
│   └── magnification-lens.css    # Lens component styles
├── js/
│   ├── modern-app.js             # Application entry point
│   ├── state-manager.js          # Reactive state management
│   ├── network-analyzer.js       # Graph analysis algorithms
│   ├── tile2net-data-loader.js   # Data loading & processing
│   ├── modern-deck-*.js          # Deck.gl visualization panels
│   ├── viewport-segmentation-overlay.js  # Segmentation rendering
│   └── ...
└── data/
    ├── config.json               # Data source configuration
    ├── sample/                   # Sample GeoJSON data
    └── tiles/                    # Tile2Net segmentation masks
```

## Technology Stack

- **Mapbox GL JS** (v2.15.0) - Base map rendering
- **Deck.gl** (v8.9.0) - GPU-accelerated data visualization
- **D3.js** (v7) - Graph algorithms and data processing
- **Vanilla JavaScript** - No framework dependencies

## Keyboard Shortcuts

| Key     | Action                    |
| ------- | ------------------------- |
| `L`   | Toggle magnification lens |
| `F`   | Toggle flicker comparison |
| `H`   | Show help/shortcuts       |
| `M`   | Show confusion matrix     |
| `Esc` | Close modals              |

## Configuration

Edit `data/config.json` to customize data paths:

```json
{
  "extent": {
    "center": [40.7484, -73.9857],
    "zoom": 16
  },
  "network": "data/sample/pedestrian-network.geojson",
  "osmNetwork": "data/sample/osm-network.geojson"
}
```

## Authors

- **George Gideon Sale** - Tandon School of Engineering, New York University (gs4602@nyu.edu)
- **Aayush Pranav Chandrashekar** - Tandon School of Engineering, New York University (ac11929@nyu.edu)

## Acknowledgments

- [Tile2Net](https://github.com/VIDA-NYU/tile2net) - The ML pipeline this tool is designed to complement
- [OpenStreetMap](https://www.openstreetmap.org/) - Ground truth network data
- [Mapbox](https://www.mapbox.com/) - Map rendering
- [Deck.gl](https://deck.gl/) - GPU-accelerated visualization

## License

This project is developed as part of a graduate course at NYU Tandon School of Engineering.
