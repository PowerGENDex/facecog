import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) => filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			// Fully static build (GitHub Pages). 404.html doubles as the SPA fallback.
			adapter: adapter({ fallback: '404.html' }),
			// Set BASE_PATH when hosting under a sub-path, e.g. BASE_PATH=/facecog/demo
			paths: { base: (process.env.BASE_PATH ?? '') as '' | `/${string}` }
		})
	],
	build: {
		// face-api bundles TensorFlow.js, so its chunk is inherently large.
		chunkSizeWarningLimit: 1600
	}
});
