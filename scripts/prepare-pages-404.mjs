import { copyFile } from 'node:fs/promises';

// GitHub Pages serves 404.html for an unknown direct URL. Use a prerendered
// Angular 404 page so the bootstrapped router and HTML describe the same route.
await copyFile('dist/portfolio/browser/404/index.html', 'dist/portfolio/browser/404.html');
