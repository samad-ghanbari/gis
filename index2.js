const express = require("express");
const { Pool } = require("pg");
const tilebelt = require("@mapbox/tilebelt");
const rawGeojsonvt = require("geojson-vt");
const geojsonvt = rawGeojsonvt.default || rawGeojsonvt;
const vtpbf = require("vt-pbf");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const reshaper = require("arabic-persian-reshaper");

const app = express();
app.use(cors()); // Enable CORS for all origins

const pool = new Pool({
  user: "admin",
  host: "10.10.10.96",
  database: "gis",
  password: "admin",
  port: 5432,
});

app.use("/", express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index2.html"));
});

// Serve font files securely
app.get("/fonts/:fontstack/:range.pbf", (req, res) => {
  const { fontstack, range } = req.params;

  // Sanitize inputs to prevent directory traversal
  const safeFontstack = fontstack.replace(/[^a-zA-Z0-9_\-, ]/g, "");
  const safeRange = range.replace(/[^0-9\-]/g, "");

  const fontPath = path.join(
    __dirname,
    "fonts",
    safeFontstack,
    `${safeRange}.pbf`
  );

  fs.readFile(fontPath, (err, data) => {
    if (err) {
      console.error(`Font glyph not found: ${fontPath}`);
      return res.status(404).send("Font glyph not found");
    }
    res.setHeader("Content-Type", "application/x-protobuf");
    res.send(data);
  });
});

app.get("/tiles/:z/:x/:y.pbf", async (req, res) => {
  try {
    const { z, x, y } = req.params;

    // Validate and parse zoom, x, y
    const zoom = parseInt(z, 10);
    const tileX = parseInt(x, 10);
    const tileY = parseInt(y, 10);
    if (
      Number.isNaN(zoom) ||
      Number.isNaN(tileX) ||
      Number.isNaN(tileY) ||
      zoom < 0 ||
      tileX < 0 ||
      tileY < 0
    ) {
      return res.status(400).send("Invalid tile coordinates");
    }

    const bbox = tilebelt.tileToBBOX([tileX, tileY, zoom]); // [minX, minY, maxX, maxY]

    // Adjust limit according to zoom level for performance
    const limit =
      zoom > 12 ? 20000 : zoom > 10 ? 50000 : zoom > 5 ? 30000 : 10000;

    const layers = {
      osm_lines: `
        SELECT ST_AsGeoJSON(ST_Transform(way, 4326)) AS geometry, highway, name
        FROM planet_osm_line
        WHERE way && ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 3857)
          AND highway IS NOT NULL
        LIMIT ${limit};
      `,
      osm_buildings: `
        SELECT ST_AsGeoJSON(ST_Transform(way, 4326)) AS geometry, building, name
        FROM planet_osm_polygon
        WHERE way && ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 3857)
          AND building IS NOT NULL
        LIMIT ${limit};
      `,
      osm_water: `
        SELECT ST_AsGeoJSON(ST_Transform(way, 4326)) AS geometry, water, name
        FROM planet_osm_polygon
        WHERE way && ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 3857)
          AND water IS NOT NULL
        LIMIT ${limit};
      `,
      osm_parks: `
        SELECT ST_AsGeoJSON(ST_Transform(way, 4326)) AS geometry, leisure, name
        FROM planet_osm_polygon
        WHERE way && ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 3857)
          AND (leisure = 'park' OR landuse IN ('grass', 'forest'))
        LIMIT ${limit};
      `,
      osm_railways: `
        SELECT ST_AsGeoJSON(ST_Transform(way, 4326)) AS geometry, railway, name
        FROM planet_osm_line
        WHERE way && ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 3857)
          AND railway IS NOT NULL
        LIMIT ${limit};
      `,
      osm_pois: `
        SELECT ST_AsGeoJSON(ST_Transform(way, 4326)) AS geometry, name 
        FROM planet_osm_polygon
        WHERE way && ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 3857)
        LIMIT ${limit};
      `,
      osm_places: `
        SELECT ST_AsGeoJSON(ST_Transform(way, 4326)) AS geometry, name 
        FROM planet_osm_polygon
        WHERE name IS NOT NULL 
          AND way && ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 3857)
        LIMIT ${limit};
      `,
    };

    const tileLayers = {};

    // Loop over layers and query features
    for (const [layerName, sql] of Object.entries(layers)) {
      const result = await pool.query(sql, bbox);

      const features = result.rows.map(({ geometry, name, ...props }) => {
        // Use reshaper on name and prepend RLM for RTL
        const shapedName = name
          ? "\u200F" + reshaper.PersianShaper.convertArabic(name)
          : null;

        return {
          type: "Feature",
          geometry: JSON.parse(geometry),
          properties: {
            ...props,
            name: shapedName,
          },
        };
      });

      const tileIndex = geojsonvt({ type: "FeatureCollection", features });

      const tile = tileIndex.getTile(zoom, tileX, tileY);
      if (tile) {
        tileLayers[layerName] = tile;
      }
    }

    if (Object.keys(tileLayers).length === 0) {
      // No features for this tile
      return res.status(204).send();
    }

    const buff = vtpbf.fromGeojsonVt(tileLayers);

    res.setHeader("Content-Type", "application/x-protobuf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${zoom}-${tileX}-${tileY}.pbf"`
    );

    res.send(buff);
  } catch (err) {
    console.error("Tile generation error:", err.stack || err.message || err);
    res.status(500).send("Error generating tile");
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Vector tile server running on port ${PORT}`);
});
