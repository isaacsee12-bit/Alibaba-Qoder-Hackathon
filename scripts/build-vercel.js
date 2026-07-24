const fs = require('fs');
const path = require('path');

const source = path.join(__dirname, '..', 'Qoder Hackathon', 'food-expiry-manager', 'frontend');
const destination = path.join(__dirname, '..', 'public');

fs.rmSync(destination, { recursive: true, force: true });
fs.cpSync(source, destination, { recursive: true });
console.log(`Copied frontend from ${source} to ${destination}`);
