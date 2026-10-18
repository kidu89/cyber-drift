const https = require('https');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://teleoperator.mindblown.ai/';

const ASSETS_TO_DOWNLOAD = [
    'assets/waymo/waymo.glb.gz',
    'assets/waymo/waymo_albedo.webp',
    'assets/waymo/waymo_orm.webp',
    'assets/waymo/waymo_emit.webp',
    'assets/cybercab/cybercab.glb.gz',
    'assets/cybercab/cybercab_cover.webp',
    'assets/corvette/corvette.glb.gz',
    'assets/cybertruck/cybertruck.glb.gz',
    'assets/roadster/roadster.glb.gz',
    'assets/car/scene_subd.glb.gz',
    'assets/car/ao_subd.bin.gz',
    'assets/car/scene_plain.glb.gz',
    'assets/car/ao_plain.bin.gz',
    'assets/missions/missions.glb.gz',
    'assets/missions/missions.json',
    'assets/real/sky_field.bin.gz',
    'assets/real/yards.bin.gz',
    'assets/real/marin/docks.bin.gz',
    'assets/osm/downtown.json',
    'assets/lm/revolution.bin.gz'
];

function downloadFile(relPath) {
    return new Promise((resolve, reject) => {
        const destPath = path.join(__dirname, relPath);
        fs.mkdirSync(path.dirname(destPath), { recursive: true });

        const url = BASE_URL + relPath;
        const fileStream = fs.createWriteStream(destPath);

        https.get(url, (res) => {
            if (res.statusCode !== 200) {
                fileStream.close();
                fs.unlink(destPath, () => {});
                return reject(new Error(`Failed ${url}: HTTP ${res.statusCode}`));
            }

            res.pipe(fileStream);

            fileStream.on('finish', () => {
                fileStream.close();
                console.log(`[OK] Downloaded: ${relPath} (${fs.statSync(destPath).size} bytes)`);
                resolve();
            });
        }).on('error', (err) => {
            fileStream.close();
            fs.unlink(destPath, () => {});
            reject(err);
        });
    });
}

async function run() {
    console.log(`Starting download of ${ASSETS_TO_DOWNLOAD.length} missing core assets...`);
    for (const file of ASSETS_TO_DOWNLOAD) {
        try {
            await downloadFile(file);
        } catch (e) {
            console.error(`[FAIL] ${file}: ${e.message}`);
        }
    }
    console.log('Download batch completed.');
}

run();
