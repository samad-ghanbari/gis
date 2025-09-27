const express = require("express");
const { Pool } = require("pg");
const tilebelt = require("@mapbox/tilebelt");
const rawGeojsonvt = require("geojson-vt");
const geojsonvt = rawGeojsonvt.default || rawGeojsonvt;
const vtpbf = require("vt-pbf");
const cors = require("cors"); // ← Import cors
const path = require("path");
const reshaper = require("arabic-persian-reshaper");

const app = express();
app.use(cors()); // ← Enable CORS for all origins
const pool = new Pool({
  user: "admin",
  host: "10.10.10.96",
  database: "gis",
  password: "admin",
  port: 5432,
});

app.use("/", express.static(path.join(__dirname, "public")));

app.get("/", async (req, res) => {
  res.sendFile(path.join(__dirname, "index2.html"));
});

app.get("/fonts/:fontstack/:range.pbf", (req, res) => {
  const { fontstack, range } = req.params;

  // Sanitize inputs for security (avoid directory traversal)
  const safeFontstack = fontstack.replace(/[^a-zA-Z0-9_\-, ]/g, "");
  const safeRange = range.replace(/[^0-9\-]/g, "");
  console.log(fontstack);
  // Construct file path
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

app.get("/tiles/:z/:x/:y.pbf", async (req, res) => {
  const { z, x, y } = req.params; // z x y are string unary operator + like +z converts it to a number
  //console.log("zxy are: ", z, x, y);

  const bbox = tilebelt.tileToBBOX([+x, +y, +z]);
  //console.log("bbpx is: ", bbox); //epsg4326

  // EPSG3857 web-mercator x,y : m
  // EPSG4326 Geographic (unprojected) lat/long : degree

  // BBOX = [minX, minY, maxX, maxY]
  // query result is 3857

  const limit = z > 12 ? 20000 : z > 10 ? 50000 : z > 5 ? 30000 : 10000;

  //console.log(z, limit);

  const layers = {
    // Roads, highways, paths
    osm_lines: `
    SELECT ST_AsGeoJSON(ST_Transform(way, 4326)) AS geometry, highway, name
    FROM planet_osm_line
    WHERE way && ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 3857)
      AND highway IS NOT NULL
    LIMIT ${limit};
  `,

    osm_landcover: `
  SELECT ST_AsGeoJSON(ST_Transform(way, 4326)) AS geometry, "natural" AS subclass
  FROM planet_osm_polygon
  WHERE way && ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 3857)
    AND "natural" = 'glacier'
  LIMIT ${limit};
`,
    osm_landuse: `
  SELECT ST_AsGeoJSON(ST_Transform(way, 4326)) AS geometry, landuse AS class
  FROM planet_osm_polygon
  WHERE way && ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 3857)
    AND landuse IN ('residential', 'suburb', 'neighbourhood')
  LIMIT ${limit};
`,

    // Buildings
    osm_buildings: `
    SELECT ST_AsGeoJSON(ST_Transform(way, 4326)) AS geometry, building, name
    FROM planet_osm_polygon
    WHERE way && ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 3857)
      AND building IS NOT NULL
    LIMIT ${limit};
  `,

    // Water bodies (polygon)
    osm_water: `
    SELECT ST_AsGeoJSON(ST_Transform(way, 4326)) AS geometry, water, name
    FROM planet_osm_polygon
    WHERE way && ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 3857)
      AND water IS NOT NULL
    LIMIT ${limit};
  `,

    // Parks and green areas
    osm_parks: `
    SELECT ST_AsGeoJSON(ST_Transform(way, 4326)) AS geometry, leisure, name
    FROM planet_osm_polygon
    WHERE way && ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 3857)
      AND (leisure = 'park' OR landuse IN ('grass', 'forest'))
    LIMIT ${limit};
  `,

    // Railways
    osm_railways: `
    SELECT ST_AsGeoJSON(ST_Transform(way, 4326)) AS geometry, railway, name
    FROM planet_osm_line
    WHERE way && ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 3857)
      AND railway IS NOT NULL
    LIMIT ${limit};
  `,

    // Points of Interest (POIs)
    //     SELECT ST_AsGeoJSON(ST_Transform(way, 4326)) AS geometry, name, amenity, shop, tourism
    // FROM planet_osm_polygon
    // WHERE way && ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 3857)
    //   AND (amenity IS NOT NULL OR shop IS NOT NULL OR tourism IS NOT NULL)
    // LIMIT ${limit};

    osm_pois: `
        SELECT ST_AsGeoJSON(ST_Transform(way, 4326)) AS geometry, name 
         FROM planet_osm_polygon
         WHERE way && ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 3857)
        LIMIT ${limit};
  `,

    osm_waterway: `
  SELECT ST_AsGeoJSON(ST_Transform(way, 4326)) AS geometry,
         waterway AS class,
         intermittent
  FROM planet_osm_line
  WHERE way && ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 3857)
    AND waterway IS NOT NULL
  LIMIT ${limit};
`,

    // Place labels (cities, towns)
    // SELECT ST_AsGeoJSON(ST_Transform(way, 4326)) AS geometry, name, place
    // FROM planet_osm_point
    // WHERE way && ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 3857)
    //   AND place IS NOT NULL
    // LIMIT ${limit};

    //         SELECT ST_AsGeoJSON(ST_Transform(way, 4326)) AS geometry, name, place
    // FROM planet_osm_polygon
    // WHERE way && ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 3857)
    //   AND place IS NOT NULL
    // LIMIT ${limit};

    osm_places: `
    SELECT ST_AsGeoJSON(ST_Transform(way, 4326)) AS geometry, name 
    FROM planet_osm_polygon
    WHERE name is not NULL and way && ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 3857)
    LIMIT ${limit};
   ;
  `,
  };

  try {
    const tileLayers = {};

    for (const [layerName, sql] of Object.entries(layers)) {
      const result = await pool.query(sql, bbox);
      const features = result.rows.map((row) => {
        const { geometry, name, ...rest } = row;
        const shapedName = name
          ? reshaper.PersianShaper.convertArabic(name)
          : null;

        return {
          type: "Feature",
          geometry: JSON.parse(geometry),
          properties: {
            ...rest,
            name: shapedName,
          },
        };
      });

      const tileIndex = geojsonvt({ type: "FeatureCollection", features });

      const tile = tileIndex.getTile(+z, +x, +y);
      //console.log("tile: ", tile);
      if (tile) {
        tileLayers[layerName] = tile;
      }
    }

    const buff = vtpbf.fromGeojsonVt(tileLayers);
    res.setHeader("Content-Type", "application/x-protobuf");
    // res.setHeader("Content-Encoding", "gzip");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${z}-${x}-${y}.pbf"`
    );

    res.send(buff);
  } catch (err) {
    console.error("Tile generation error:", err.stack || err.message || err);
    res.status(500).send("Error generating tile");
  }
});

app.listen(3000, () => console.log("Vector tile server running on port 3000"));
