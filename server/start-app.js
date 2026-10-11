import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const mode = process.argv[2] === "dev" ? "dev" : "start";
const port = String(process.argv[3] || process.env.PORT || "3001");
const apiPort = String(process.env.API_PORT || "3002");
const nextCli = path.join(root, "node_modules", "next", "dist", "bin", "next");
const sharedEnv = { ...process.env, PORT: port, API_PORT: apiPort };
const apiProcess = spawn(process.execPath, [path.join(here, "start.js")], {
  cwd: root,
  env: sharedEnv,
  stdio: "inherit",
});

let shuttingDown = false;
let nextProcess;
function stopChildren(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  nextProcess?.kill();
  apiProcess.kill();
  process.exitCode = code;
}

apiProcess.once("error", (error) => {
  console.error("Could not start the API service:", error.message);
  stopChildren(1);
});
apiProcess.once("exit", (code) => {
  if (!shuttingDown) stopChildren(code || 0);
});
process.once("SIGINT", () => stopChildren(0));
process.once("SIGTERM", () => stopChildren(0));

function checkApiReady() {
  return new Promise((resolve, reject) => {
    const request = http.get(
      `http://127.0.0.1:${apiPort}/api/health`,
      (response) => {
        response.resume();
        if (response.statusCode === 200) resolve(true);
        else reject(new Error(`API health returned ${response.statusCode}`));
      },
    );
    request.setTimeout(800, () => request.destroy(new Error("API health timed out")));
    request.once("error", reject);
  });
}

async function startNextWhenApiIsReady() {
  const deadline = Date.now() + 12000;
  while (!shuttingDown && Date.now() < deadline) {
    try {
      await checkApiReady();
      nextProcess = spawn(
        process.execPath,
        [nextCli, mode, "-p", port, "-H", "0.0.0.0"],
        { cwd: root, env: sharedEnv, stdio: "inherit" },
      );
      nextProcess.once("error", (error) => {
        console.error("Could not start the Next.js app:", error.message);
        stopChildren(1);
      });
      nextProcess.once("exit", (code) => stopChildren(code || 0));
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  if (!shuttingDown) {
    console.error("The API service did not become ready in time.");
    stopChildren(1);
  }
}

void startNextWhenApiIsReady();
