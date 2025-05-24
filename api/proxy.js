// api/proxy.js (This code will run on Vercel's serverless environment)

module.exports = async (req, res) => {
    // IMPORTANT: In production, change '*' to your actual frontend Vercel URL
    // e.g., 'https://your-vercel-app-name.vercel.app'
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*', 
        'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
        'Access-Control-Max-Age': '86400',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization', // Essential for POST requests
    };

    // Handle OPTIONS preflight requests
    if (req.method === 'OPTIONS') {
        res.writeHead(204, corsHeaders); // 204 No Content for preflight success
        res.end();
        return;
    }

    try {
        const pathSegments = req.url.split('/').filter(segment => segment);
        
        // Expected path: /api/proxy/[subdomain]/v1/chat/completions
        // So, after filtering, segments could be: ['api', 'proxy', 'llama3b', 'v1', 'chat', 'completions']
        // We want 'llama3b' which is at index 2 if starting from root, or index 1 after '/api/proxy' is stripped

        // Let's explicitly look for 'proxy' and then the subdomain
        let gaiaSubdomain = null;
        let gaiaApiPathStart = -1;

        for (let i = 0; i < pathSegments.length; i++) {
            if (pathSegments[i] === 'proxy') {
                if (i + 1 < pathSegments.length) {
                    gaiaSubdomain = pathSegments[i + 1];
                    gaiaApiPathStart = i + 2; // Where /v1/chat/completions starts
                    break;
                }
            }
        }

        if (!gaiaSubdomain) {
            console.error("Proxy Error: Missing Gaia subdomain in path. Path segments:", pathSegments);
            res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders });
            res.end(JSON.stringify({ error: 'Invalid path: missing target Gaia subdomain. Expected /api/proxy/[subdomain]/v1/chat/completions' }));
            return;
        }
        
        const gaiaDomain = `${gaiaSubdomain}.gaia.domains`;
        const gaiaApiPath = '/' + pathSegments.slice(gaiaApiPathStart).join('/');

        if (!gaiaApiPath.startsWith('/v1/chat/completions')) {
            console.error("Proxy Error: Invalid Gaia API path. Path segments:", pathSegments);
            res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders });
            res.end(JSON.stringify({ error: 'Invalid Gaia API path. Only /v1/chat/completions is supported.' }));
            return;
        }

        const gaiaTargetUrl = `https://${gaiaDomain}${gaiaApiPath}`;

        // Get the API key from Vercel Environment Variables
        const GAIA_API_KEY = process.env.GAIA_API_KEY;

        if (!GAIA_API_KEY) {
            console.error("Proxy Error: API Key not configured.");
            res.writeHead(500, { 'Content-Type': 'application/json', ...corsHeaders });
            res.end(JSON.stringify({ error: 'API Key is not configured in Vercel environment variables.' }));
            return;
        }

        // Prepare request headers for the Gaia API
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${GAIA_API_KEY}`,
            // Vercel automatically forwards standard headers.
            // If you need custom headers from client to Gaia, you'd iterate req.headers.
        };

        let requestBody = null;
        if (req.method === 'POST') {
            requestBody = await new Promise((resolve, reject) => {
                let data = '';
                req.on('data', chunk => {
                    data += chunk;
                });
                req.on('end', () => {
                    resolve(data);
                });
                req.on('error', err => {
                    reject(err);
                });
            });
        }

        // Make the actual request to the Gaia LLM API
        const gaiaResponse = await fetch(gaiaTargetUrl, {
            method: req.method,
            headers: headers,
            body: requestBody,
        });

        // Forward headers from Gaia's response to your frontend, including CORS
        const responseHeaders = {};
        gaiaResponse.headers.forEach((value, key) => {
            // Avoid forwarding headers that might cause issues, like content-encoding if Vercel handles compression
            if (!['content-encoding', 'transfer-encoding'].includes(key.toLowerCase())) {
                responseHeaders[key] = value;
            }
        });
        Object.entries(corsHeaders).forEach(([key, value]) => {
            responseHeaders[key] = value;
        });

        res.writeHead(gaiaResponse.status, responseHeaders);
        
        // Stream the response body directly
        if (gaiaResponse.body) {
            const reader = gaiaResponse.body.getReader();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                res.write(value);
            }
        }
        res.end();

    } catch (error) {
        console.error('Unhandled Proxy Error:', error); // Log the full error
        res.writeHead(500, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({ error: `Proxy Error: ${error.message}` }));
    }
};