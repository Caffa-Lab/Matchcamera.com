# Data build

`public/data/products.json` is generated from the master workbook in `data-source/`.

The current repository already contains the generated JSON. When the master spreadsheet is changed, regenerate the JSON with the same field mapping used by Matchcamera (`manufacturer`, `mount`, `sensorFormat`, `cropFactor`, `lensFormat`, `compatibleSensorFormat`, etc.).
