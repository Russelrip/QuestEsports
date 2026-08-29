import { spawn } from "node:child_process";

const run = (command, args, env) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      shell: process.platform === "win32",
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} ${args.join(" ")} exited with ${code}.`))
    );
  });

const env = {
  ...process.env,
  INTERNAL_API_URL: "http://127.0.0.1:5011",
  NEXT_PUBLIC_API_URL: "http://127.0.0.1:5011",
  NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3000",
  PLAYWRIGHT_MOCK_API_PORT: "5011",
  CI: "true",
  ALLOW_INSECURE_LOOPBACK_URLS: "true",
};

await run("npm", ["run", "build"], env);
await run("npx", ["playwright", "test"], env);
