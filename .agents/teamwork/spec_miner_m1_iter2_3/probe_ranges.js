const cp = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');

const variants = [
  'bytes=0-abc',
  'bytes=10-xyz',
  'bytes=0-NaN',
  'bytes=0-Infinity',
  'bytes=0--5',
  'bytes=0-10-20',
  'bytes=-abc',
  'bytes=abc-',
  'bytes=abc-def',
  'bytes=foobar',
  'bytes=-',
  'bytes=--',
  'bytes=NaN-10',
  'bytes=Infinity-10',
  'bytes=0-1.5',
  'bytes=1.5-10',
  'bytes=0-0x10',
  'bytes=null-null',
  'bytes=undefined-undefined',
  'bytes=0-undefined',
  'bytes=true-false',
  'bytes=0-999999999',
  'bytes=999999999-1000',
  'bytes=100-50',
  'bytes=-0',
  'bytes=-10',
  'bytes=10-',
  'bytes=0-0'
];

async function probe() {
  for (const v of variants) {
    const script = `
      const { server } = require(${JSON.stringify(path.join(ROOT, 'server.js'))});
      server.listen(0, async () => {
        const port = server.address().port;
        try {
          const res = await fetch('http://localhost:' + port + '/assets/audio/airflow.mp3', {
            headers: { 'Range': ${JSON.stringify(v)} }
          });
          const text = await res.text();
          console.log(${JSON.stringify(v)} + ' => STATUS ' + res.status + ' | Content-Range: ' + res.headers.get('content-range'));
        } catch (e) {
          console.log(${JSON.stringify(v)} + ' => CLIENT ERROR: ' + e.message);
        } finally {
          server.close();
        }
      });
    `;
    const res = cp.spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', cwd: ROOT });
    if (res.status !== 0) {
      const errLine = res.stderr.split('\n').find(l => l.includes('ERR_') || l.includes('Error')) || res.stderr.trim().split('\n')[0];
      console.log(`${v} => CRASH (exit code ${res.status}): ${errLine.trim()}`);
    } else {
      console.log(res.stdout.trim());
    }
  }
}

probe();
