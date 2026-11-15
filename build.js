// Bundles index.html + css + js into one self-contained file: dist/portsheet.html
// Usage: node build.js
const fs = require('fs');
const path = require('path');
const root = __dirname;
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, function (all, href) {
  return '<style>\n' + fs.readFileSync(path.join(root, href), 'utf8') + '</style>';
});
html = html.replace(/<script src="([^"]+)"><\/script>/g, function (all, src) {
  const js = fs.readFileSync(path.join(root, src), 'utf8').replace(/<\/script/gi, '<\\/script');
  return '<script>\n' + js + '</script>';
});
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'portsheet.html'), html);
console.log('dist/portsheet.html', (html.length / 1024).toFixed(0) + ' kB');
