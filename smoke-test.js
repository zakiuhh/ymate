// Quick end-to-end check: node --env-file-if-exists=.env smoke-test.js
process.env.PORT = process.env.PORT || '3456';
require('./server.js');

const base = `http://127.0.0.1:${process.env.PORT}`;
const url = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';

(async () => {
  await new Promise((r) => setTimeout(r, 1500));
  const kind = process.argv[2] || 'best';
  const { id } = await (
    await fetch(`${base}/api/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, quality: kind }),
    })
  ).json();

  const res = await fetch(`${base}/api/jobs/${id}/events`);
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    for (const line of decoder.decode(chunk).split('\n')) {
      if (!line.startsWith('data: ')) continue;
      const job = JSON.parse(line.slice(6));
      console.log(job.status, job.stage, job.percent + '%', job.filename || job.error || '');
      if (['done', 'error', 'cancelled'].includes(job.status)) {
        if (job.status === 'done') {
          const f = await fetch(`${base}/api/jobs/${id}/file`);
          const buf = Buffer.from(await f.arrayBuffer());
          console.log('served bytes:', buf.length, f.headers.get('content-disposition'));
        }
        process.exit(job.status === 'done' ? 0 : 1);
      }
    }
  }
})();
