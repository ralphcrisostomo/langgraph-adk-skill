import minimist from 'minimist';
import { runCli } from './cli';

const argv = minimist(process.argv.slice(2));

runCli(argv as Record<string, unknown>).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
