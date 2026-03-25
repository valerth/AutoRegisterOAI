// 注意：此代码需在可信环境执行，浏览器扩展直接调用可能受 CORS 限制
// 实际部署建议配合后端代理

const TOKEN_URL = 'https://auth.openai.com/oauth/token';
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';

async function exchangeToken(code, redirectUri, codeVerifier) {
  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code: code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier
    })
  });
  
  if (!resp.ok) {
    throw new Error(`Token exchange failed: ${resp.status}`);
  }
  
  const tokenResp = await resp.json();
  
  // 解析 ID Token
  const claims = parseJwtClaimsNoVerify(tokenResp.id_token || '');
  const email = claims.email || '';
  const authClaims = claims['https://api.openai.com/auth'] || {};
  const accountId = authClaims.chatgpt_account_id || '';
  
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = parseInt(tokenResp.expires_in) || 0;
  
  return {
    id_token: tokenResp.id_token?.trim() || '',
    access_token: tokenResp.access_token?.trim() || '',
    refresh_token: tokenResp.refresh_token?.trim() || '',
    account_id: accountId,
    last_refresh: toRFC3339(now),
    email: email,
    type: 'codex',
    expired: toRFC3339(now + Math.max(expiresIn, 0))
  };
}

function parseJwtClaimsNoVerify(token) {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(atob(payload).split('').map(c => 
      '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
    ).join(''));
    return JSON.parse(json);
  } catch {
    return {};
  }
}

function toRFC3339(timestamp) {
  return new Date(timestamp * 1000).toISOString();
}

// 导出
if (typeof module !== 'undefined') {
  module.exports = { exchangeToken, parseJwtClaimsNoVerify };
}