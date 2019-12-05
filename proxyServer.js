require("dotenv").config();
const httpProxy = require("http-proxy");
const https = require("https");
const http = require("http");
const helpers = require("./helpers");
const ROOT = process.env.ROOT;
const SSLKEY = process.env.SSLKEY;
const SSLCERT = process.env.SSLCERT;
const fs = require("fs");

let sessions = {};

const proxy = httpProxy.createProxyServer({
  // secure: true,
  ws: true,
  followRedirects: true
});

// ~~~~~~~~~~~~~~~
// Redirect all traffic from http to https
const httpServer = http.createServer((req, res) => {
  helpers.log("Redirecting to HTTPS");
  res.writehead(301, { Location: `https://${req.headers.host}${req.url}` });
  res.end();
});

httpServer.listen(80, () => {
  helpers.log("HTTP Redirect server listening on port 80...");
});
// ~~~~~~~~~~~~~~~

// SSLKEY = /etc/letsencrypt/live/redpointnotebooks.com/privkey.pem
// SSLCERT = /etc/letsencrypt/live/redpointnotebooks.com/fullchain.pem

const https_options = {
  key: fs.readFileSync(SSLKEY),
  cert: fs.readFileSync(SSLCERT)
};

const proxyServer = https.createServer(https_options, (req, res) => {
  const host = req.headers.host;
  // www.redpointnotebooks.com or
  // www.123abc.redpointnotebooks.com

  if (host === ROOT) {
    helpers.log(
      "Inside host === ROOT",
      "Host : ",
      host,
      "req.method : ",
      req.method
    );

    if (req.method === "GET") {
      helpers.startNewSession(req, res, sessions);
    } else if (req.method === "POST") {
      if (req.url.match(/\/webhooks\/(.*)/)) {
        helpers.saveWebhook(req, res);
      } else if (req.url === "/email") {
        helpers.sendEmail(req, res);
      }
    }
  } else if (host !== ROOT) {
    // host === subdomained url
    helpers.log("Inside host !== ROOT", "HOST :", host);

    if (req.method === "DELETE") {
      console.log("Delete Request received");
      // server.js issues delete request to tear down a container session
      helpers.tearDown(req, res, sessions);
    } else if (
      req.method === "POST" &&
      (req.url === "/save" || req.url === "/clone")
    ) {
      // save or clone notebook
      helpers.saveOrCloneNotebook(req, res, sessions);
    } else if (!sessions[host]) {
      // subdomain is not in the sessions object
      console.log("Could not find session");
      res.writeHead(404);
      return res.end();
    } else if (req.url === "/loadNotebook" && req.method === "GET") {
      // load notebook from session state if stashed notebookId
      helpers.loadNotebook(req, res, sessions);
    } else {
      console.log("Proxying request through websocket");
      sessions[host].lastVisited = Date.now();
      proxy.web(req, res, { target: sessions[req.headers.host].ip }, e => {});
    }
  }
});

helpers.teardownZombieContainers(sessions);

proxyServer.on("upgrade", (req, socket, head) => {
  let containerIP;
  if (sessions[req.headers.host].ip) {
    (containerIP = "sessions[req.headers.host].ip : "),
      sessions[req.headers.host].ip;
  }

  helpers.log("Inside on('upgrade')", containerIP);

  proxy.ws(req, socket, head, { target: sessions[req.headers.host].ip });
});

proxyServer.listen(443, () => {
  helpers.log("Listening on port 443...");
});
