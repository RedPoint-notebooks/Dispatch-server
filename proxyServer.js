require("dotenv").config();
const db = require("./db");
const httpProxy = require("http-proxy");
const fs = require("fs");
const https = require("https");
const http = require("http");
const uuidv4 = require("uuid/v4");
const Docker = require("dockerode");
let docker = new Docker({ socketPath: "/var/run/docker.sock" });

let containerId;
let IPAddress;
let sessions = {};

const ROOT = "www.redpointnotebook.com";
const ROOT2 = "redpointnotebook.com";
const PORT = 8000;

const proxy = httpProxy.createProxyServer({
  // secure: true,
  ws: true,
  followRedirects: true
});

const saveNotebook = (req, res) => {
  let body = "";
  req.on("data", chunk => {
    body += chunk;
  });
  req.on("end", () => {
    const notebookData = JSON.parse(body);
    db("SAVE", notebookData, notebookData.id).then(data => {
      console.log(data);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.end("Save success!");
    }).catch(err => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.end(null);
    })
  });
};

const loadNotebook = (req, res) => {
  console.log("INSIDE LOAD NOTEBOOK");
  console.log("req.url", req.url);
  console.log("req.headers.host", req.headers.host);
  console.log("Sessions : ", sessions);
  console.log("===================================");
  const notebookId = sessions[req.headers.host].notebookId;
  if (notebookId) {
    db("LOAD", null, notebookId).then(data => {
      console.log("Loaded notebook : ", data);
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.end(JSON.stringify(data));
    });
  } else {
    res.end(JSON.stringify(null));
  }
};

const tearDown = (req, res) => {
  console.log("From delete: ", sessions, req.headers);
  const containerId = sessions[req.headers.host].containerId;

  docker.getContainer(containerId).remove({ force: true });
  delete sessions[req.headers.host];
  res.writeHead(202);
  return res.end("DELETED");
}

const startNewSession = (req, res) => {
  console.log("host is ROOT");
  // console.log("req.headers.host => ", req.headers.host);

  const matchData = req.url.match(/\/notebooks\/(.*)/);

  let notebookId;
  if (matchData) {
    notebookId = matchData[1];
  }

  console.log("Notebook ID : ", notebookId);

  let sessionId = uuidv4().slice(0, 6);

  const html = fs.readFileSync(__dirname + "/redirect.html", {
    encoding: "utf-8"
  });

  const sessionURL = `www.${sessionId}.${ROOT2}`;
  const interpolatedHtml = html.replace("${}", `http://${sessionURL}`);

  res.end(interpolatedHtml);

  const options = {
    Image: "csgdocker/redpoint:latest",
    // PortBindings: {
    //   "8000/tcp": [{ HostPort: "8000" }]
    // }
    ExposedPorts: { "8000/tcp": {} }
  };

  docker.createContainer(options, (err, container) => {
    containerId = container.id;
    console.log("Id of this container is " + containerId);

    container.start((err, data) => {
      if (err) console.log(err);
      container.inspect(container.id).then(data => {
        IPAddress = data.NetworkSettings.IPAddress;
        console.log("IP address of this container is: " + IPAddress);

        const containerURL = `http://${IPAddress}:${PORT}`;
        sessions[sessionURL] = {
          // www.asd443.redpoint.com
          ip: containerURL, // http://172.11.78:8000
          containerId,
          notebookId
        };

        console.log("Sessions object: " + JSON.stringify(sessions));
      });
    });
  });

}
const proxyServer = http.createServer((req, res) => {
  // console.log("Request headers host: " + req.headers.host);

  const host = req.headers.host;

  console.log("Req Url : ", req.url);

  if (host === ROOT) {
    if (req.method === "POST" && req.url === "/update") {
      // load notebook from session state if stashed notebookId
      saveNotebook(req, res);
    } else if (req.method === "DELETE") {
      // server.js issues delete request to tear down a container session
      tearDown(req, res);
    } else if (req.method === "GET") {
      // console.log("Request headers host: " + req.headers.host);
      startNewSession(req, res);
    }
  } else if (host !== ROOT) {
    console.log("HOST :", host);
    if (!sessions[host]) {
      res.writeHead(404);
      return res.end();
    } else if (req.url === '/loadNotebook' && req.method === 'GET') {
      loadNotebook(req, res, sessions);
    } else {
      proxy.web(req, res, { target: sessions[req.headers.host].ip }, e => {
        // console.log("inside proxy!");
      });
    }
  }
});

proxyServer.listen(80, () => {
  console.log("Listening on port 80...");
});

proxyServer.on("upgrade", (req, socket, head) => {
  proxy.ws(req, socket, head, { target: sessions[req.headers.host].ip });
});

