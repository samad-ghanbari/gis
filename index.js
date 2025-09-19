const express = require("express");
const { Pool } = require("pg");
const tilebelt = require("@mapbox/tilebelt");
const rawGeojsonvt = require("geojson-vt");
const geojsonvt = rawGeojsonvt.default || rawGeojsonvt;
const vtpbf = require("vt-pbf");
const cors = require("cors"); // ← Import cors
const path = require("path");

const app = express();
app.use(cors()); // ← Enable CORS for all origins
const pool = new Pool({
  user: "admin",
  host: "10.10.10.56",
  database: "gis",
  password: "admin",
  port: 5432,
});

app.get("/", async (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
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

  //   const sql = `
  //   SELECT public.ST_AsGeoJSON(ST_Transform(way, 4326)) AS geometry, name
  //   FROM planet_osm_line
  //   WHERE way && ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 3857)
  //   LIMIT 1000
  // `;

  //console.log(z);
  const limit = z > 12 ? 20000 : z > 10 ? 50000 : 10000;

  const layers = {
    osm_lines: `
    SELECT ST_AsGeoJSON(ST_Transform(way, 4326)) AS geometry, name
    FROM planet_osm_line
    WHERE way && ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 3857)
    AND highway IS NOT NULL
    LIMIT ${limit};
  `,
    osm_buildings: `
    SELECT ST_AsGeoJSON(ST_Transform(way, 4326)) AS geometry, name
    FROM planet_osm_polygon
    WHERE way && ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 3857)
    AND building IS NOT NULL
    LIMIT ${limit};
  `,
    osm_water: `
    SELECT ST_AsGeoJSON(ST_Transform(way, 4326)) AS geometry, waterway
    FROM planet_osm_line
    WHERE way && ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 3857)
    AND waterway IS NOT NULL
    LIMIT ${limit};
  `,
  };

  try {
    //const values = bbox;
    // const result = await pool.query(sql, values); // , bbox

    // //geojson
    // //features is an array of objects [{}, {}, {}]
    // const features = result.rows.map((row) => ({
    //   type: "Feature",
    //   geometry: JSON.parse(row.geometry),
    //   properties: { name: row.name },
    // }));

    // // converts large GeoJSON data into vector map tiles on the fly
    // const tileIndex = geojsonvt({ type: "FeatureCollection", features });
    // const tile = tileIndex.getTile(+z, +x, +y);

    // if (!tile) return res.status(204).send();

    // const buff = vtpbf.fromGeojsonVt({ osm: tile });
    // //console.log(buff);

    // res.setHeader("Content-Type", "application/x-protobuf");
    // res.send(buff);

    const tileLayers = {};

    for (const [layerName, sql] of Object.entries(layers)) {
      const result = await pool.query(sql, bbox);
      const features = result.rows.map((row) => {
        const { geometry, ...props } = row;
        return {
          type: "Feature",
          geometry: JSON.parse(geometry),
          properties: props,
        };
      });
      const tileIndex = geojsonvt({ type: "FeatureCollection", features });
      const tile = tileIndex.getTile(+z, +x, +y);
      //console.log("zoom level: ", z);
      if (tile) {
        tileLayers[layerName] = tile;
      }
    }

    const buff = vtpbf.fromGeojsonVt(tileLayers);
    res.setHeader("Content-Type", "application/x-protobuf");
    // res.setHeader("Content-Encoding", "gzip");
    // res.setHeader(
    //   "Content-Disposition",
    //   `inline; filename="${z}-${x}-${y}.pbf"`
    // );

    res.send(buff);
  } catch (err) {
    console.error("Tile generation error:", err.stack || err.message || err);
    res.status(500).send("Error generating tile");
  }
});

app.listen(3000, () => console.log("Vector tile server running on port 3000"));
