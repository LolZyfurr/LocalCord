const http = require('http');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');

const requirements = 'app.html';
const goalFolder = 'assets';
const PORT = 3000;
const missingOrigin = 'https://discord.com/';

// Mapping file extensions to appropriate MIME types
const mimeTypes = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf'
};

async function downloadAssetOnDemand(requestPath) {
    if (requestPath.includes('/api/') || requestPath.includes('/gateway')) {
        return false;
    }

    const localFilePath = path.join(__dirname, requestPath);
    const targetDir = path.dirname(localFilePath);

    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }

    if (fs.existsSync(localFilePath)) {
        return true;
    }

    const fullUrl = new URL(requestPath, missingOrigin).href;
    console.log(`Downloading on demand: ${fullUrl}`);

    try {
        const response = await fetch(fullUrl);
        if (!response.ok) {
            console.error(`Failed to download ${fullUrl}: ${response.statusText}`);
            return false;
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        await fsPromises.writeFile(localFilePath, buffer);
        return true;
    } catch (error) {
        console.error(`Error downloading ${fullUrl}:`, error);
        return false;
    }
}

const server = http.createServer(async (req, res) => {
    let requestPath = req.url.split('?')[0];

    const isHtmlRequest = requestPath === '/' || requestPath === '/index.html' || requestPath === `/${requirements}`;

    if (isHtmlRequest) {
        requestPath = `/${requirements}`;
    }

    const localFilePath = path.join(__dirname, requestPath);

    if (!isHtmlRequest && !fs.existsSync(localFilePath) && (requestPath.includes(`/${goalFolder}/`) || requestPath.endsWith('.js') || requestPath.endsWith('.css'))) {
        await downloadAssetOnDemand(requestPath);
    }

    fs.readFile(localFilePath, async (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end(`404 Not Found: ${requestPath}`);
            } else {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('500 Internal Server Error');
            }
        } else {
            const extname = path.extname(localFilePath).toLowerCase();
            let contentType = mimeTypes[extname] || 'application/octet-stream';

            // If serving the main HTML file, inject the dynamic prompt and storage wrapper
            if (isHtmlRequest) {
                contentType = 'text/html';
                let htmlStr = content.toString('utf-8');

                const tokenPromptScript = `
                    <script>
                        (function() {
                            // Custom storage layer / wrapper to safely handle session/token data
                            const storageKey = 'token';
                            let token = null;

                            try {
                                token = localStorage.getItem(storageKey);
                                if (token) {
                                    try { token = JSON.parse(token); } catch(e) {}
                                }
                            } catch (e) {
                                console.warn("Local storage unavailable, using fallback memory store.");
                            }

                            // Freeze execution and prompt user dynamically if no token is found
                            while (!token || typeof token !== 'string' || token.trim() === "") {
                                token = prompt("Enter your Discord Token to launch:");
                                if (token === null) {
                                    alert("A token is required to run this application.");
                                    continue;
                                }
                                token = token.trim();
                            }

                            // Store token back into localStorage (or a custom wrapper object)
                            try {
                                localStorage.setItem(storageKey, JSON.stringify(token));
                            } catch (e) {
                                window.__fallbackTokenStore = token;
                            }

                            // Optional proxy override for storage access if other app scripts query custom paths
                            const originalGetItem = Storage.prototype.getItem;
                            Storage.prototype.getItem = function(key) {
                                if (key === storageKey) {
                                    let val = originalGetItem.call(this, key);
                                    if (!val && window.__fallbackTokenStore) return JSON.stringify(window.__fallbackTokenStore);
                                    return val;
                                }
                                return originalGetItem.call(this, key);
                            };
                        })();
                    </script>
                `;

                // Inject at the very beginning of the <head> tag to block script execution until token is supplied
                if (htmlStr.includes('<head>')) {
                    htmlStr = htmlStr.replace('<head>', `<head>${tokenPromptScript}`);
                } else if (htmlStr.includes('<html>')) {
                    htmlStr = htmlStr.replace('<html>', `<html><head>${tokenPromptScript}</head>`);
                } else {
                    htmlStr = tokenPromptScript + htmlStr;
                }

                res.writeHead(200, { 'Content-Type': contentType });
                return res.end(htmlStr, 'utf-8');
            }

            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}/`);
    console.log(`Serving ${requirements}, fetching missing assets from ${missingOrigin} on demand into '${goalFolder}'.`);
});