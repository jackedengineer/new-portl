import { fork } from 'node:child_process';
import { supervise, childEnvironment } from './hosting/supervisor.js';
const managed = supervise(
  (kind) => {
    const child = fork(new URL(`./${kind}.js`, import.meta.url), [], {
      env: childEnvironment(kind, process.env),
      execArgv: [],
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    return {
      on: child.on.bind(child),
      send: (message) => child.send(message, () => {}),
      kill: (signal) => child.kill(signal),
    };
  },
  (code) => {
    process.exitCode = code;
  },
);
process.once('SIGTERM', () => managed.stop());
process.once('SIGINT', () => managed.stop());
