import { homedir } from "node:os";
import { createCli } from "./app.js";
import { createOpenSpecCliRunner } from "../openspec/cli-runner.js";

const cli = createCli({
  homeDir: homedir(),
  cwd: process.cwd(),
  platform: process.platform,
  runOpenSpec: createOpenSpecCliRunner(),
  interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
});
const result = await cli.run(process.argv.slice(2));
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exitCode = result.exitCode;
