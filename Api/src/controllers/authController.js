import * as authService from '../services/authService.js';

export async function register(req, res) {
  const { email, password, name } = req.body;

  if (!email || !password || !name) {
    return res.status(400).json({ error: 'email, password et name sont obligatoires' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères' });
  }

  const result = await authService.register({ email, password, name });
  if (result.error) {
    return res.status(result.status).json({ error: result.error });
  }

  return res.status(201).json(result);
}

export async function login(req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'email et password sont obligatoires' });
  }

  const result = await authService.login({ email, password });
  if (result.error) {
    return res.status(result.status).json({
      error: result.error,
      emailVerificationRequired: result.emailVerificationRequired || false,
      email: result.email || undefined,
    });
  }

  return res.json(result);
}

export async function refreshToken(req, res) {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({ error: 'refreshToken est obligatoire' });
  }

  const result = await authService.refreshAccessToken(refreshToken);
  if (result.error) {
    return res.status(result.status).json({ error: result.error });
  }

  return res.json(result);
}

export async function logout(req, res) {
  const authHeader = req.headers.authorization;
  const accessToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
  const { refreshToken } = req.body;

  await authService.logout(accessToken, refreshToken);
  return res.json({ success: true, message: 'Déconnecté avec succès' });
}

export async function verifyEmail(req, res) {
  const { email, code } = req.body;

  if (!email || !code) {
    return res.status(400).json({ error: 'email et code sont obligatoires' });
  }

  const result = await authService.verifyEmail(email, code);
  if (result.error) {
    return res.status(result.status).json({ error: result.error });
  }

  return res.json(result);
}

export async function googleAuth(req, res) {
  const { token, idToken } = req.body;

  if (!token && !idToken) {
    return res.status(400).json({ error: 'Token Google manquant' });
  }

  try {
    let googleUser = null;

    if (token) {
      // Verify via Google UserInfo endpoint
      const response = await fetch('https://www.googleapis.com/userinfo/v2/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        googleUser = await response.json();
      }
    }

    if (!googleUser && idToken) {
      // Verify id_token via Google tokeninfo
      const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`);
      if (response.ok) {
        googleUser = await response.json();
      }
    }

    if (!googleUser || (!googleUser.id && !googleUser.sub)) {
      return res.status(401).json({ error: 'Token Google invalide ou expiré' });
    }

    const providerId = googleUser.id || googleUser.sub;
    const email = googleUser.email;
    const name = googleUser.name || 'Utilisateur Google';
    const avatarUrl = googleUser.picture || null;

    const result = await authService.oauthLogin({
      provider: 'google',
      providerId,
      email,
      name,
      avatarUrl,
    });

    if (result.error) {
      return res.status(result.status).json({ error: result.error });
    }

    return res.json(result);
  } catch (err) {
    console.error('[Google OAuth Error]', err);
    return res.status(500).json({ error: 'Erreur lors de la vérification Google' });
  }
}

export async function oauthLogin(req, res) {
  const { provider, providerId, email, name, avatarUrl } = req.body;

  if (!provider || !providerId) {
    return res.status(400).json({ error: 'provider (google) et providerId sont obligatoires' });
  }

  const result = await authService.oauthLogin({ provider, providerId, email, name, avatarUrl });
  if (result.error) {
    return res.status(result.status).json({ error: result.error });
  }

  return res.json(result);
}

export async function linkOAuth(req, res) {
  const { provider, providerId } = req.body;

  if (!provider || !providerId) {
    return res.status(400).json({ error: 'provider et providerId sont obligatoires' });
  }

  const result = await authService.linkOAuthAccount(req.user.id, { provider, providerId });
  if (result.error) {
    return res.status(result.status).json({ error: result.error });
  }

  return res.json(result);
}

export async function forgotPassword(req, res) {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'email est obligatoire' });
  }

  const result = await authService.forgotPassword(email);
  return res.json(result);
}

export async function resetPassword(req, res) {
  const { email, resetCode, newPassword } = req.body;

  if (!email || !resetCode || !newPassword) {
    return res.status(400).json({ error: 'email, resetCode et newPassword sont obligatoires' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'Le nouveau mot de passe doit contenir au moins 6 caractères' });
  }

  const result = await authService.resetPassword(email, resetCode, newPassword);
  if (result.error) {
    return res.status(result.status).json({ error: result.error });
  }

  return res.json(result);
}
