// Local HTTPS front for lighthouse/app-host-check.mjs: https://<any zicabella host>:8443 → http://127.0.0.1:3001,
// forwarding the original Host and adding the proxy headers DigitalOcean/Cloudflare add in production.
const https = require('https');
const http = require('http');
const fs = require('fs');
const dir = process.env.CERT_DIR;
const server = https.createServer({ key: fs.readFileSync(dir + '/key.pem'), cert: fs.readFileSync(dir + '/cert.pem') }, (req, res) => {
  const hostNoPort = (req.headers.host || 'zicabella.com').split(':')[0];
  const headers = { ...req.headers, host: hostNoPort, 'x-forwarded-host': hostNoPort, 'x-forwarded-proto': 'https', 'x-forwarded-for': '49.36.1.1' };
  const up = http.request({ host: '127.0.0.1', port: 3001, method: req.method, path: req.url, headers }, (ur) => {
    res.writeHead(ur.statusCode, ur.headers);
    ur.pipe(res);
  });
  up.on('error', (e) => { res.writeHead(502); res.end(String(e)); });
  req.pipe(up);
});
server.listen(8443, '127.0.0.1', () => console.log('tls proxy on 8443'));
