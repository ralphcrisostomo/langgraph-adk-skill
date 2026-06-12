import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Regression: as a linked global bin the CLI runs in arbitrary directories. Bun
// resolves JSX config from the launch cwd's tsconfig, so running inside a Vue/Nuxt
// project (jsxImportSource: "vue") must NOT make Bun transpile our own .tsx against
// vue/jsx-dev-runtime. Each .tsx pins react with an `@jsxImportSource react` pragma.
test('runs from a cwd whose tsconfig declares jsxImportSource: vue', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vuecwd-'));
  try {
    writeFileSync(
      join(dir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { jsx: 'react-jsx', jsxImportSource: 'vue' } }),
    );
    const entry = resolve(import.meta.dir, '..', 'src', 'index.ts');
    const proc = Bun.spawnSync(['bun', entry, '--list'], { cwd: dir });
    const stderr = proc.stderr.toString();
    const stdout = proc.stdout.toString();
    expect(stderr).not.toContain('vue/jsx-dev-runtime');
    expect(proc.exitCode).toBe(0);
    expect(stdout).toContain('chat');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
