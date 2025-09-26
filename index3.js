const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const reshaper = require("arabic-persian-reshaper");

const app = express();
app.use(cors()); // Enable CORS for all origins

app.use("/", express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "test2.html"));
});

// Route to serve tile images
app.get("/tiles/:z/:x/:y.png", (req, res) => {
  const { z, x, y } = req.params;
  const tilePath = path.join(__dirname, "tiles", z, x, `${y}.png`);

  fs.access(tilePath, fs.constants.R_OK, (err) => {
    if (err) {
      // Tile not found
      res.status(404).send("Tile not found");
    } else {
      res.sendFile(tilePath);
    }
  });
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Vector tile server running on port ${PORT}`);
});
