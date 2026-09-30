import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath,URL} from 'node:url';
export default defineConfig({plugins:[react()],resolve:{alias:{'@kamraw/domain':fileURLToPath(new URL('../../packages/domain/src/index.ts',import.meta.url))}},server:{host:'127.0.0.1',port:5173},build:{sourcemap:false}});
