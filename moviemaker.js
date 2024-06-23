// VU movie maker

// Copyright (c) Johan Zetterberg
// Modernized by Claude

// The software is provided "as is" without any warranty. Use at your own risk!
// Under no circumstance should the authors be held responsible for any damages that this software might cause.
const fs = require("fs").promises;
const fsSync = require("fs");
const path = require("path");
const http = require("http");
const { createCanvas, loadImage } = require("canvas");
const Voronoi = require("voronoi");

const TEST = process.argv[4] === "-t"; // Outputs only one image if set to true

const SHOW_KINGDOM_BORDERS = true;
const SHOW_KINGDOM_BANNERS = true;
const KINGDOM_BANNER_ALPHA = 0.25;
const SHOW_RULER_BORDERS = true;

const WORLD_NAME = process.argv[2] || "Fantasia";
const ERA = process.argv[3] || "last";

let WORLD_ID;

const CANVAS_SIZE = 1000;

const ARMY_WIDTH = 3;
const ARMY_HEIGHT = 3;

const IMG_FOLDER = "./frames/";

// Mapping of ownerId to color. A random color will be generated if the ruler id does not exist in this list
const RULER_COLORS = {};

// Mapping of kd to color. A random color will be generated if the kingdom id does not exist in this list
const KINGDOM_COLORS = {
  5783: "#46d2c4",
  5889: "#740100",
  5987: "#bb46d2",
  5204: "#55b6d2",
  6002: "#89996b",
  6001: "#b58570",
  5913: "#014701",
  5999: "#81b83a",
  5992: "#d6a636",
  6000: "#8a6a52",
  5950: "#b106a7",
  5410: "#f65616",
  5927: "#88ced5",
};

async function main() {
  WORLD_ID = getWorldId(WORLD_NAME.toLowerCase());

  if (isNaN(WORLD_ID))
    throw new Error(
      `The first parameter needs to be the name of the world or the world id! WORLD_NAME=${WORLD_NAME} WORLD_ID=${WORLD_ID}`
    );

  const csvUrl = `http://visual-utopia.com/history/${WORLD_ID}_${ERA}.csv`;

  try {
    await clearFolder(IMG_FOLDER);
    const text = await getTextFromUrl(csvUrl);
    const rows = text.trim().split("\n");
    const metaData = rows.shift(); // First row contains metadata

    const world = {
      id: parseInt(findText(metaData, /world=(\d+)/)),
      era: parseInt(findText(metaData, /era=(\d+)/)),
      map: parseInt(findText(metaData, /map=(\d+)/)),
      size: parseInt(findText(metaData, /size=(\d+)/)),
    };

    const mapBackground = await makeMapBackground(world);
    const frames = makeFrames(rows, world);

    let kingdomBanners;
    if (SHOW_KINGDOM_BANNERS) {
      const kingdoms = Object.keys(KINGDOM_COLORS);
      console.time("Get kingdom banners");
      kingdomBanners = await getKingdomBanners(kingdoms);
      console.timeEnd("Get kingdom banners");
    }

    for (let i = 0; i < frames.length; i++) {
      await paintFrame(frames[i], i, mapBackground, kingdomBanners);
    }
  } catch (err) {
    console.error("An error occurred:", err);
  }
}

function getWorldId(worldName) {
  const worldMap = {
    fantasia: 1,
    mantrax: 2,
    zetamania: 3,
    starta: 4,
    nirvana: 5,
    valhalla: 6,
    armageddon: 7,
    talents: 8,
    midgard: 9,
    latha: 10,
    fensteria: 11,
    mogrox: 12,
    "good vs evil": 13,
  };

  return worldMap[worldName] || parseInt(worldName);
}

async function clearFolder(directory) {
  console.log(`Clearing folder: ${directory} ...`);
  try {
    await fs.mkdir(directory, { recursive: true });
    const files = await fs.readdir(directory);
    await Promise.all(
      files.map((file) => fs.unlink(path.join(directory, file)))
    );
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
}

async function makeMapBackground(world) {
  const mapImg = getMapImage(world.map);
  const imageType = path.extname(mapImg).substring(1);
  const mapImageUrl = `http://static.visual-utopia.com/images/${mapImg}`;

  await fs.mkdir("./maps", { recursive: true });

  let imageData;
  try {
    imageData = await fs.readFile(`./maps/${mapImg}`);
  } catch (err) {
    if (err.code === "ENOENT") {
      imageData = await getImageDataFromUrl(mapImageUrl);
      await fs.writeFile(`./maps/${mapImg}`, imageData);
      console.log(`Map saved: ${mapImg}`);
    } else {
      throw err;
    }
  }

  const mapTile = await loadImage(imageData);

  const mapSize = world.size * 2;
  const mapScale = CANVAS_SIZE / mapSize;
  const tileSize = Math.floor(2500 * mapScale);
  const tileRepeat = Math.floor(mapSize / 2500);

  console.log(`mapSize=${mapSize} mapScale=${mapScale} tileSize=${tileSize}`);

  const mapBackground = createCanvas(CANVAS_SIZE, CANVAS_SIZE);
  const ctx = mapBackground.getContext("2d");

  let xStart = 0;
  let yStart = 0;

  if (mapSize % 2500 !== 0) {
    xStart = (-(mapSize % 2500) / 2) * mapScale;
    yStart = (-(mapSize % 2500) / 2) * mapScale;
  }

  for (let x = xStart; x < CANVAS_SIZE; x += tileSize) {
    for (let y = yStart; y < CANVAS_SIZE; y += tileSize) {
      console.log(`x=${x} y=${y}`);
      ctx.drawImage(mapTile, x, y, tileSize, tileSize);
    }
  }

  return mapBackground;
}

function getMapImage(mapId) {
  const mapImages = {
    1: "vuQ.jpg",
    2: "karta3.jpg",
    3: "desert.jpg",
    4: "karta6.jpg",
    5: "mogrox.jpg",
    6: "manxmap_HQ.jpg",
    7: "shatteredworlds_HQ.jpg",
    8: "bigsnowmap_HQ.jpg",
    9: "arkan_HQ.png",
    10: "rivers_HQ.jpg",
    13: "island.jpg",
  };

  if (!mapImages[mapId]) {
    throw new Error(`Unknown world.map=${mapId}`);
  }

  return mapImages[mapId];
}

function getImageDataFromUrl(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (response) => {
        if (response.statusCode !== 200) {
          const error = new Error(
            `Unable to get image from url=${url} (response.statusCode=${response.statusCode})`
          );
          error.statusCode = response.statusCode;
          return;
        }

        const data = [];
        response.on("data", (chunk) => {
          data.push(chunk);
        });

        response.on("end", () => {
          console.log(`Image downloaded: ${url}`);
          resolve(Buffer.concat(data));
        });
      })
      .on("error", reject);
  });
}

function getTextFromUrl(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(
            new Error(
              `Unable to get text from url=${url} (response.statusCode=${response.statusCode})`
            )
          );
          return;
        }

        let data = "";
        response.on("data", (chunk) => {
          data += chunk;
        });

        response.on("end", () => {
          console.log(`File downloaded: ${url}`);
          resolve(data);
        });
      })
      .on("error", reject);
  });
}

function makeFrames(rows, world) {
  console.time(`Parsing ${rows.length} rows of csv data`);

  const mapSize = world.size * 2;
  const mapScale = CANVAS_SIZE / mapSize;

  const frames = [{ cities: [], armies: [] }];
  let frame = 0;

  const firstRow = rows[0].split(",");
  const lastRow = rows[rows.length - 1].split(",");
  const dayStart = parseInt(firstRow[0]);
  const dayEnd = TEST ? dayStart : parseInt(lastRow[0]);

  console.log(`dayStart=${dayStart} dayEnd=${dayEnd}`);

  let currentDay = dayStart;

  const colonySize = [10, 10, 20, 30, 40, 50, 60, 70, 75, 75];

  for (const row of rows) {
    const [day, X, Y, kingdomId, worldId, size, type, ownerId] = row
      .split(",")
      .map((val, index) => (index != 6 && index < 8 ? parseInt(val) : val));
    if (day !== currentDay) {
      if (TEST) break;
      frame = frames.push({ cities: [], armies: [] }) - 1;
      if (day - currentDay !== 1)
        console.warn(`Warning: day=${day} currentDay=${currentDay}`);
      currentDay = day;
    }
    if (type == "city") {
      frames[frame].cities.push({
        x: Math.round((X + world.size) * mapScale),
        y: Math.round((Y + world.size) * mapScale),
        radius: colonySize[size] * mapScale,
        kd: kingdomId,
        ownerId: ownerId,
        color: getColor(kingdomId, ownerId),
      });
    } else if (type == "army") {
      frames[frame].armies.push({
        x: (X + world.size) * mapScale,
        y: (Y + world.size) * mapScale,
        color: getColor(kingdomId, ownerId),
      });
    }
    console.log(frames);
  }

  console.timeEnd(`Parsing ${rows.length} rows of csv data`);

  if (frames.length !== dayEnd - dayStart + 1) {
    throw new Error(
      `frames.length=${frames.length} dayStart=${dayStart} dayEnd=${dayEnd}`
    );
  }

  return frames;
}

async function paintFrame(frame, frameNr, mapBackground, kingdomBanners) {
  console.time(`paintFrame ${frameNr}`);

  const mapCanvas = createCanvas(CANVAS_SIZE, CANVAS_SIZE);
  const ctx = mapCanvas.getContext("2d");

  ctx.drawImage(mapBackground, 0, 0, CANVAS_SIZE, CANVAS_SIZE);

  const voronoi = new Voronoi();
  const bbox = { xl: 0, xr: CANVAS_SIZE, yt: 0, yb: CANVAS_SIZE };

  const diagram = voronoi.compute(frame.cities, bbox);

  if (SHOW_KINGDOM_BANNERS) {
    ctx.globalAlpha = KINGDOM_BANNER_ALPHA;

    for (const cell of diagram.cells) {
      if (cell.halfedges.length === 0) {
        console.warn("halfedges.length=0");
        continue;
      }

      ctx.beginPath();
      const startPoint = cell.halfedges[0].getStartpoint();
      ctx.moveTo(startPoint.x, startPoint.y);

      for (const halfedge of cell.halfedges) {
        const endPoint = halfedge.getEndpoint();
        ctx.lineTo(endPoint.x, endPoint.y);
      }

      if (cell.site.kd !== 0) {
        ctx.fillStyle = kingdomBanners[cell.site.kd];
        ctx.fill();
      }
    }
  }

  if (SHOW_KINGDOM_BORDERS) {
    ctx.globalAlpha = 0.7;
    ctx.setLineDash([4, 2]);
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgb(0, 0, 0)";

    for (const edge of diagram.edges) {
      if (edge.lSite && edge.rSite && edge.lSite.kd !== edge.rSite.kd) {
        ctx.beginPath();
        ctx.moveTo(edge.va.x, edge.va.y);
        ctx.lineTo(edge.vb.x, edge.vb.y);
        ctx.stroke();
      }
    }
  }

  if (SHOW_RULER_BORDERS) {
    ctx.globalAlpha = 1;
    ctx.setLineDash([2, 1]);
    ctx.lineWidth = 1;

    for (const edge of diagram.edges) {
      if (
        edge.lSite &&
        edge.rSite &&
        edge.lSite.ownerId !== edge.rSite.ownerId
      ) {
        ctx.beginPath();
        ctx.moveTo(edge.va.x, edge.va.y);
        ctx.lineTo(edge.vb.x, edge.vb.y);
        ctx.strokeStyle = edge.lSite.color;
        ctx.stroke();
      }
    }
  }

  // Cities
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  ctx.lineWidth = 3;
  ctx.strokeStyle = "black";

  for (const city of frame.cities) {
    ctx.beginPath();
    ctx.arc(city.x, city.y, city.radius, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.fillStyle = city.color;
    ctx.fill();
  }

  // Armies
  ctx.lineWidth = 1;

  for (const army of frame.armies) {
    ctx.beginPath();
    ctx.rect(
      army.x - ARMY_WIDTH / 2,
      army.y - ARMY_HEIGHT / 2,
      ARMY_WIDTH,
      ARMY_HEIGHT
    );
    ctx.fillStyle = army.color;
    ctx.stroke();
    ctx.fill();
  }

  await saveImage(mapCanvas, `${IMG_FOLDER}${zeroPad(frameNr)}.png`);

  console.timeEnd(`paintFrame ${frameNr}`);
}

function getColor(kingdomId, ownerId) {
  if (kingdomId === 0) {
    if (!RULER_COLORS.hasOwnProperty(ownerId)) {
      RULER_COLORS[ownerId] = randomColor();
    }
    return RULER_COLORS[ownerId];
  } else {
    if (!KINGDOM_COLORS.hasOwnProperty(kingdomId)) {
      KINGDOM_COLORS[kingdomId] = randomColor();
    }

    if (ownerId === 0) return KINGDOM_COLORS[kingdomId];

    if (!RULER_COLORS.hasOwnProperty(ownerId)) {
      RULER_COLORS[ownerId] = KINGDOM_COLORS[kingdomId];
    }
    return RULER_COLORS[ownerId];
  }
}

function randomColor() {
  return (
    "#" +
    Math.floor(Math.random() * 16777215)
      .toString(16)
      .padStart(6, "0")
  );
}

async function getKingdomBanners(kingdoms) {
  const kingdomBanners = {};
  const kingdomBannerUrl = "http://visual-utopia.com/KDbanners/";
  const canvasWidth = 120;
  const canvasHeight = 100;

  await fs.mkdir("./kdbanners", { recursive: true });

  const loadBanner = async (kingdomId) => {
    const imgName = `kingdom${kingdomId}.jpg`;
    try {
      const imgBuffer = await fs.readFile(`./kdbanners/${imgName}`);
      return makeBannerCanvas(kingdomId, imgBuffer);
    } catch (err) {
      if (err.code === "ENOENT") {
        try {
          const imageData = await getImageDataFromUrl(
            `${kingdomBannerUrl}${imgName}`
          );
          await fs.writeFile(`./kdbanners/${imgName}`, imageData);
          return makeBannerCanvas(kingdomId, imageData);
        } catch (downloadErr) {
          if (downloadErr.code === 404) {
            // Kingdom has no kingdom banner
            return randomColor();
          }
          throw downloadErr;
        }
      }
      throw err;
    }
  };

  const makeBannerCanvas = async (kingdomId, imageData) => {
    const canvas = createCanvas(canvasWidth, canvasHeight);
    const ctx = canvas.getContext("2d");
    ctx.globalAlpha = KINGDOM_BANNER_ALPHA;

    const kingdomBanner = await loadImage(imageData);
    ctx.drawImage(kingdomBanner, 0, 0, canvasWidth, canvasHeight);

    return ctx.createPattern(canvas, "repeat");
  };

  await Promise.all(
    kingdoms.map(async (kingdomId) => {
      kingdomBanners[kingdomId] = await loadBanner(kingdomId);
    })
  );

  return kingdomBanners;
}

async function saveImage(canvas, filePath) {
  return new Promise((resolve, reject) => {
    const out = fsSync.createWriteStream(filePath);
    const stream = canvas.createPNGStream();
    stream.pipe(out);
    out.on("finish", () => {
      console.log(`Saved ${filePath}`);
      resolve();
    });
    out.on("error", reject);
  });
}

function findText(myString, myRegexp) {
  const match = myRegexp.exec(myString);
  return match[1];
}

function zeroPad(nr) {
  return nr.toString().padStart(4, "0");
}

main().catch(console.error);
async function saveImage(canvas, filePath) {
  return new Promise((resolve, reject) => {
    const out = fsSync.createWriteStream(filePath);
    const stream = canvas.createPNGStream();
    stream.pipe(out);
    out.on("finish", () => {
      console.log(`Saved ${filePath}`);
      resolve();
    });
    out.on("error", reject);
  });
}

module.exports = {
  main,
};
