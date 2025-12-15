# Tile2Net Segmentation Data Directory

This directory is for loading **real Tile2Net segmentation outputs** into the Pedestrian Network Inspector.

## Directory Structure

```
data/tiles/
├── tile_index.json          # Index file listing all tiles and their bounds
├── predictions/             # Tile2Net model predictions (PNG images)
│   ├── tile_0_0.png
│   ├── tile_0_1.png
│   └── ...
├── ground_truth/            # Ground truth masks for comparison (PNG images)
│   ├── tile_0_0.png
│   ├── tile_0_1.png
│   └── ...
└── README.md               # This file
```

## Image Format

### Color Encoding
Segmentation masks should be PNG images with the following color encoding:

| Class      | RGB Color       | Description              |
|------------|-----------------|--------------------------|
| Background | (0, 0, 0)       | Black - non-pedestrian   |
| Road       | (0, 255, 0)     | Green - roads/streets    |
| Sidewalk   | (0, 0, 255)     | Blue - sidewalks         |
| Crosswalk  | (255, 0, 0)     | Red - crosswalks         |

### Image Size
- Recommended: 256x256 pixels per tile
- The system supports any square tile size

## How to Add Your Data

1. **Generate Tile2Net predictions**
   Run Tile2Net on your aerial imagery to generate segmentation masks.

2. **Convert to PNG format**
   If Tile2Net outputs .npy files, convert them to PNG with the color encoding above:
   ```python
   import numpy as np
   from PIL import Image

   # Load mask
   mask = np.load('segmentation.npy')

   # Create RGB image
   rgb = np.zeros((mask.shape[0], mask.shape[1], 3), dtype=np.uint8)
   rgb[mask == 1] = [0, 255, 0]    # Road - Green
   rgb[mask == 2] = [0, 0, 255]    # Sidewalk - Blue
   rgb[mask == 3] = [255, 0, 0]    # Crosswalk - Red

   # Save
   Image.fromarray(rgb).save('tile_0_0.png')
   ```

3. **Update tile_index.json**
   Edit `tile_index.json` to include your tiles with correct geographic bounds.

4. **Add ground truth (optional)**
   Place ground truth masks in the `ground_truth/` directory for error analysis.

## When Real Data is Not Found

If no PNG files are found in the predictions directory, the system automatically generates **synthetic demonstration data** that simulates typical urban street patterns. This allows you to explore all features of the visualization tool.

A notification will appear when synthetic data is being used.
