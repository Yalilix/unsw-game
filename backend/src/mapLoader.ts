const tmx = require("tmx-parser");
import path from "path";
import fs from "fs";

export interface TileData {
  id: number;
  gid: number;
}

export interface MapData {
  ground2D: (TileData | undefined)[][];
  decal2D: (TileData | undefined)[][];
}

export default async function loadMap(): Promise<MapData> {
  const srcPath = path.resolve(__dirname, "map.tmx");
  const fallbackPath = path.resolve(__dirname, "../src/map.tmx");
  const mapPath = fs.existsSync(srcPath) ? srcPath : fallbackPath;

  const map = await new Promise<any>((resolve, reject) => {
    tmx.parseFile(mapPath, function (err: Error, loadedMap: any) {
      if (err) return reject(err);
      resolve(loadedMap);
    });
  });

  // The first two layers are ground and decals, same as original project
  const groundTiles = map.layers[0]?.tiles || [];
  const decalTiles = map.layers[1]?.tiles || [];
  const ground2D: (TileData | undefined)[][] = [];
  const decal2D: (TileData | undefined)[][] = [];
  for (let row = 0; row < map.height; row++) {
    const groundRow: (TileData | undefined)[] = [];
    const decalRow: (TileData | undefined)[] = [];
    for (let col = 0; col < map.width; col++) {
      const groundTile = groundTiles[row * map.width + col];
      if (groundTile) {
        groundRow.push({ id: groundTile.id, gid: groundTile.gid });
      } else {
        groundRow.push(undefined);
      }

      const decalTile = decalTiles[row * map.width + col];
      if (decalTile) {
        decalRow.push({ id: decalTile.id, gid: decalTile.gid });
      } else {
        decalRow.push(undefined);
      }
    }
    ground2D.push(groundRow);
    decal2D.push(decalRow);
  }

  return { ground2D, decal2D };
}
