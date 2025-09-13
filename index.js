const express = require("express");
const { Pool } = require("pg");
const tilebelt = require("@mapbox/tilebelt");
const geojsonvt = require("geojson-vt").default || require("geojson-vt");
const vtpbf = require("vt-pbf");
const cors = require("cors"); // ← Import cors

const app = express();
app.use(cors()); // ← Enable CORS for all origins
const pool = new Pool({
  user: "admin",
  host: "10.10.10.96",
  database: "gis",
  password: "admin",
  port: 5432,
});

app.get("/tiles/:z/:x/:y.pbf", async (req, res) => {
  const { z, x, y } = req.params;
  const bbox = tilebelt.tileToBBOX([+x, +y, +z]);

  // BBOX = [minX, minY, maxX, maxY]
  //WHERE way && ST_MakeEnvelope($1, $2, $3, $4, 3857)
  const sql = `
    SELECT public.ST_AsGeoJSON(way) AS geometry, name
    FROM planet_osm_line
    
    LIMIT 1000
  `;

  // console.log("Query BBOX:", bbox);
  //console.log("BbOx: ", bbox[0], bbox[1], bbox[2], bbox[3]);

  try {
    const result = await pool.query(sql, []);

    //console.log("Rows returned:", result.rows.length);

    const features = result.rows.map((row) => ({
      type: "Feature",
      geometry: JSON.parse(row.geometry),
      properties: { name: row.name },
    }));

    const tileIndex = geojsonvt({ type: "FeatureCollection", features });
    const tile = tileIndex.getTile(+z, +x, +y);

    if (!tile) return res.status(204).send(); // empty tile

    const buff = vtpbf.fromGeojsonVt({ layer0: tile });

    res.setHeader("Content-Type", "application/x-protobuf");
    res.setHeader("Content-Encoding", "gzip"); // optional
    res.send(buff);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error generating tile");
  }
});

app.listen(3000, () => console.log("Vector tile server running on port 3000"));
