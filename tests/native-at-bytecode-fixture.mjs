import { compileSource } from '../tools/compile-source.mjs';
import { atSource } from './helpers/at-source.mjs';

const compilation = await compileSource(atSource(), { filename: 'native-at-package.ghost.md' });
process.stdout.write(Buffer.from(compilation.bytes).toString('base64'));
