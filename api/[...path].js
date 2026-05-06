export const config = {
  api: {
    bodyParser: false,
  },
};

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  const urlParts = req.url.split('?');
  const pathPart = urlParts[0].replace('/api/', '');
  const queryString = urlParts[1] ? `?${urlParts[1]}` : '';
  const targetUrl = `http://asl-translator-env.eba-minxz3t8.us-east-2.elasticbeanstalk.com/${pathPart}${queryString}`;

  try {
    const headers = {};
    if (req.headers['content-type']) {
      headers['content-type'] = req.headers['content-type'];
    }

    let body = undefined;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      body = await getRawBody(req);
    }

    const response = await fetch(targetUrl, {
      method: req.method,
      headers,
      body,
    });

    const responseText = await response.text();

    res.status(response.status);
    const ct = response.headers.get('content-type');
    if (ct) res.setHeader('content-type', ct);
    res.send(responseText);

  } catch (error) {
    console.error('Proxy error:', error);
    res.status(500).json({ error: error.message });
  }
}
