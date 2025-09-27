import os
import math
import requests
import time

# Tehran bounding box
min_lat, max_lat = 35, 36
min_lon, max_lon = 50, 53
min_zoom, max_zoom = 15, 15

def latlon_to_tile(lat_deg, lon_deg, zoom):
    lat_rad = math.radians(lat_deg)
    n = 2 ** zoom
    x_tile = int((lon_deg + 180.0) / 360.0 * n)
    y_tile = int((1 - (math.log(math.tan(lat_rad) + 1 / math.cos(lat_rad)) / math.pi)) / 2 * n)
    return x_tile, y_tile

def download_tile(z, x, y, base_folder='tehran_tiles'):
    folder = os.path.join(base_folder, str(z), str(x))
    os.makedirs(folder, exist_ok=True)
    filename = os.path.join(folder, f"{y}.png")

    if os.path.exists(filename):
        print(f"Skipping tile {z}/{x}/{y} (already downloaded)")
        return

    url = f"https://tile.openstreetmap.org/{z}/{x}/{y}.png"
    headers = {
        "User-Agent": "Mozilla/135.0 (compatible; MyTileDownloader/2.0; +https://testtile.com/)"
    }

    try:
        response = requests.get(url, headers=headers, timeout=10)
        if response.status_code == 200:
            with open(filename, 'wb') as f:
                f.write(response.content)
            print(f"Downloaded tile {z}/{x}/{y}")
        else:
            print(f"Failed to download tile {z}/{x}/{y} - HTTP {response.status_code}")
    except Exception as e:
        print(f"Error downloading tile {z}/{x}/{y}: {e}")

def main():
    for zoom in range(min_zoom, max_zoom + 1):
        x_start, y_start = latlon_to_tile(max_lat, min_lon, zoom)  # top-left
        x_end, y_end = latlon_to_tile(min_lat, max_lon, zoom)      # bottom-right

        print(f"Zoom level {zoom} - X tiles {x_start} to {x_end}, Y tiles {y_start} to {y_end}")
               
        for x in range(x_start, x_end + 1):
            if x < 21079:
                continue
            for y in range(y_start, y_end + 1):
                download_tile(zoom, x, y)
                time.sleep(1)  # 1 second delay to be polite

if __name__ == "__main__":
    main()

