const { execSync } = require('child_process');
const path = require('path');

process.env.CI = 'false';
process.env.DISABLE_ESLINT_PLUGIN = 'true';
process.env.GENERATE_SOURCEMAP = 'false';

const cwd = path.resolve(__dirname, '..');

try {
  execSync('npx --yes react-scripts build', {
    cwd,
    env: process.env,
    stdio: 'inherit'
  });
  process.exit(0);
} catch (err) {
  const code = Number(err.status) || 1;
  process.exit(code);
}
