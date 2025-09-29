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
app.use(cors());

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

app.get("/fonts/:fontstack/:range.pbf", (req, res) => {
  const { fontstack, range } = req.params;
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
      console.error("Font PBF not found:", fontPath);
      return res.status(404).send("Font glyph not found");
    }
    res.setHeader("Content-Type", "application/x-protobuf");
    res.send(data);
  });
});

// Helper function to query PostGIS and convert to GeoJSON features
async function fetchFeatures(sql, params) {
  const result = await pool.query(sql, params);
  return result.rows.map((row) => {
    const { geometry, ...props } = row;
    const shapedName = props.name
      ? reshaper.PersianShaper.convertArabic(props.name)
      : null;
    if (shapedName !== null) props.name = shapedName;

    return {
      type: "Feature",
      geometry: JSON.parse(geometry),
      properties: props,
    };
  });
}

app.get("/:layer/:z/:x/:y.pbf", async (req, res) => {
  const { layer, z, x, y } = req.params;
  const zNum = +z,
    xNum = +x,
    yNum = +y;

  const bbox = tilebelt.tileToBBOX([xNum, yNum, zNum]); // [minX, minY, maxX, maxY] in WGS84

  // Define SQL queries for each layer based on your database schema
  const layerQueries = {
    openmaptiles: {
      // Example for 'park' and 'landuse' in openmaptiles source
      park: `
          SELECT ST_AsGeoJSON(ST_Transform(way, 4326)) AS geometry, leisure, name, 'park' AS layer
          FROM planet_osm_polygon
          WHERE leisure='park' AND way && ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 3857)
      `,
      landuse: `
          SELECT ST_AsGeoJSON(ST_Transform(way, 4326)) AS geometry, COALESCE(landuse, "amenity") AS class
          FROM planet_osm_polygon
          WHERE ( LOWER(landuse) IN ('residential', 'cemetery') OR "amenity" IN ('hospital' , 'school' ))
            AND way && ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 3857)
  `,
      landcover: `
          SELECT ST_AsGeoJSON(ST_Transform(way, 4326)) AS geometry, COALESCE("natural", "landuse") AS "class"
          FROM planet_osm_polygon
          WHERE
            (
              "natural" = 'wood' OR
              "landuse" = 'forest' OR
              "landuse" = 'grass'
            ) 
            AND way && ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 3857)
  `,
      waterway: `
            SELECT ST_AsGeoJSON(ST_Transform(way, 4326)) AS geometry, name, waterway as class
            FROM planet_osm_line
            WHERE waterway = 'river'
            AND way && ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 3857)
      `,
      transportation: `
      
      `,
    },
  };

  try {
    let tileLayers = {};

    if (layer === "openmaptiles") {
      // For openmaptiles, fetch multiple sublayers
      for (const [subLayerName, sql] of Object.entries(
        layerQueries.openmaptiles
      )) {
        const features = await fetchFeatures(sql, bbox);

        if (features.length) {
          const tileIndex = geojsonvt({ type: "FeatureCollection", features });
          const tile = tileIndex.getTile(zNum, xNum, yNum);
          if (tile) tileLayers[subLayerName] = tile;
        }
      }
    } else if (layer === "contour_10m" || layer === "contour_40ft") {
      // For contour layers
      const sql = layerQueries[layer];
      const features = await fetchFeatures(sql, bbox);
      if (features.length) {
        const tileIndex = geojsonvt({ type: "FeatureCollection", features });
        const tile = tileIndex.getTile(zNum, xNum, yNum);
        if (tile) tileLayers[layer] = tile;
      }
    } else {
      return res.status(404).send("Layer not found");
    }

    if (Object.keys(tileLayers).length === 0) {
      return res.status(204).send("No tile data");
    }

    const buff = vtpbf.fromGeojsonVt(tileLayers);
    res.setHeader("Content-Type", "application/x-protobuf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${layer}-${z}-${x}-${y}.pbf"`
    );

    res.send(buff);
  } catch (err) {
    console.error("Tile generation error:", err.stack || err.message || err);
    res.status(500).send("Error generating tile");
  }
});

app.listen(3000, () => console.log("Vector tile server running on port 3000"));
