/**
 * `pwd` — print the current working directory.
 *
 * Output is `env.get('PWD') + '\n'`. If `PWD` is unset or empty (which
 * should not happen in normal operation, since spec002c's initial env sets
 * it), V1 falls back to `/` rather than printing `undefined`. This is a
 * defensive deviation from the literal spec text; the test suite pins the
 * fallback explicitly so the intent is documented.
 *
 * @module shell/commands/pwd
 */

/**
 * @type {import('./index.js').CommandObject}
 */
export const pwd = {
  name: 'pwd',
  usage: 'pwd',
  description: 'Gibt das aktuelle Arbeitsverzeichnis aus.',
  
  run({ argv, name, env }) {
    if (argv.length > 0) {
      return { stdout: '', stderr: `${name}: too many arguments\n`, exitCode: 1 };
    }
    // Defensive fallback: PWD unset/empty → '/'. Never let 'undefined'
    // or an empty line reach the user.
    const current = env.get('PWD') || '/';
    return { stdout: current + '\n', stderr: '', exitCode: 0 };
  },
};