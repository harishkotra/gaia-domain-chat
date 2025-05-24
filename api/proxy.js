module.exports = async (req, res) => {
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
        'Access-Control-Max-Age': '86400',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization', // Essential for POST requests
    };

    // Handle OPTIONS preflight requests
    if (req.method === 'OPTIONS') {
        res.writeHead(204, corsHeaders);
        res.end();
        return;
    }

    try {
        const pathSegments = req.url.split('/').filter(segment => segment);

        // Find the index of 'proxy' in pathSegments to get the dynamic part
        const proxyIndex = pathSegments.indexOf('proxy');
        if (proxyIndex === -1 || proxyIndex + 1 >= pathSegments.length) {
            return res.status(400).json({ error: 'Invalid path: missing target Gaia subdomain.' });
        }

        const gaiaSubdomain = pathSegments[proxyIndex + 1];
        const gaiaDomain = `${gaiaSubdomain}.gaia.domains`;

        // The rest of the path is for the OpenAI API endpoint (e.g., /v1/chat/completions)
        const gaiaApiPath = '/' + pathSegments.slice(proxyIndex + 2).join('/'); // Slice from after proxy and subdomain
        
        if (!gaiaApiPath.startsWith('/v1/chat/completions')) {
            return res.status(400).json({ error: 'Invalid Gaia API path. Only /v1/chat/completions is supported.' });
        }

        const gaiaTargetUrl = `https://${gaiaDomain}${gaiaApiPath}`;

        // Get the API key from Vercel Environment Variables
        const GAIA_API_KEY = process.env.GAIA_API_KEY;

        if (!GAIA_API_KEY) {
            return res.status(500).json({ error: 'API Key is not configured in Vercel environment variables.' });
        }

        // Prepare request headers for the Gaia API
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${GAIA_API_KEY}`,
        };

        let requestBody = null;
        if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
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

        // Set CORS headers for the response back to your frontend
        Object.entries(corsHeaders).forEach(([key, value]) => {
            res.setHeader(key, value);
        });

        // Forward the status and data from Gaia's response
        res.status(gaiaResponse.status);
        const gaiaResponseBody = await gaiaResponse.json();
        res.json(gaiaResponseBody);

    } catch (error) {
        console.error('Proxy Error:', error);
        res.status(500).json({ error: `Proxy Error: ${error.message}` });
    }
};