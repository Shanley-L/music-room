import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import prisma from '../lib/prisma.js';
import { blacklistToken } from '../lib/redis.js';
import { JWT_SECRET, JWT_REFRESH_SECRET } from '../middleware/auth.js';
import { sendVerificationEmail, sendPasswordResetEmail } from '../lib/mailer.js';

const ACCESS_TOKEN_EXPIRES = '1h';
const REFRESH_TOKEN_EXPIRES_DAYS = 7;

function generateTokens(user) {
  const payload = {
    sub: user.id,
    email: user.email,
    name: user.name,
    jti: crypto.randomUUID(),
  };

  const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRES });
  const refreshToken = jwt.sign(payload, JWT_REFRESH_SECRET, {
    expiresIn: `${REFRESH_TOKEN_EXPIRES_DAYS}d`,
  });

  return { accessToken, refreshToken };
}

function sanitizeUser(user) {
  const { password, verificationCode, resetPasswordCode, resetPasswordExpires, ...safe } = user;
  return safe;
}

export async function register({ email, password, name }) {
  const existing = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  });

  if (existing) {
    return { error: 'Un compte existe déjà avec cette adresse email', status: 400 };
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();

  const user = await prisma.user.create({
    data: {
      email: email.toLowerCase(),
      password: hashedPassword,
      name,
      verificationCode,
      isEmailVerified: false,
    },
  });

  const { accessToken, refreshToken } = generateTokens(user);

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRES_DAYS);

  await prisma.refreshToken.create({
    data: {
      token: refreshToken,
      userId: user.id,
      expiresAt,
    },
  });

  // Asynchronously send validation email via SMTP / Mailpit
  sendVerificationEmail(user.email, verificationCode, user.name);

  return {
    user: sanitizeUser(user),
    accessToken,
    refreshToken,
  };
}

export async function login({ email, password }) {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  });

  if (!user || !user.password) {
    return { error: 'Identifiants invalides', status: 401 };
  }

  const isValid = await bcrypt.compare(password, user.password);
  if (!isValid) {
    return { error: 'Identifiants invalides', status: 401 };
  }

  if (!user.isEmailVerified) {
    return {
      error: 'Veuillez valider votre adresse email avant de vous connecter.',
      status: 403,
      emailVerificationRequired: true,
      email: user.email,
    };
  }

  const { accessToken, refreshToken } = generateTokens(user);

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRES_DAYS);

  await prisma.refreshToken.create({
    data: {
      token: refreshToken,
      userId: user.id,
      expiresAt,
    },
  });

  return {
    user: sanitizeUser(user),
    accessToken,
    refreshToken,
  };
}

export async function refreshAccessToken(refreshTokenString) {
  try {
    const decoded = jwt.verify(refreshTokenString, JWT_REFRESH_SECRET);

    const storedToken = await prisma.refreshToken.findUnique({
      where: { token: refreshTokenString },
      include: { user: true },
    });

    if (!storedToken || storedToken.revoked || storedToken.expiresAt < new Date()) {
      return { error: 'Refresh token invalide ou révoqué', status: 401 };
    }

    // Revoke current refresh token (rotation)
    await prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { revoked: true },
    });

    const user = storedToken.user;
    const { accessToken, refreshToken: newRefreshToken } = generateTokens(user);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRES_DAYS);

    await prisma.refreshToken.create({
      data: {
        token: newRefreshToken,
        userId: user.id,
        expiresAt,
      },
    });

    return {
      accessToken,
      refreshToken: newRefreshToken,
    };
  } catch (err) {
    return { error: 'Refresh token invalide ou expiré', status: 401 };
  }
}

export async function logout(accessToken, refreshTokenString) {
  if (accessToken) {
    await blacklistToken(accessToken, 3600);
  }

  if (refreshTokenString) {
    await prisma.refreshToken.updateMany({
      where: { token: refreshTokenString },
      data: { revoked: true },
    });
  }

  return { success: true };
}

export async function verifyEmail(email, code) {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  });

  if (!user) {
    return { error: 'Utilisateur introuvable', status: 404 };
  }

  if (user.verificationCode !== code) {
    return { error: 'Code de validation invalide', status: 400 };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      isEmailVerified: true,
      verificationCode: null,
    },
  });

  return { success: true, message: 'Email validé avec succès' };
}

export async function oauthLogin({ provider, providerId, email, name, avatarUrl }) {
  if (!providerId) {
    return { error: 'Paramètres OAuth manquants', status: 400 };
  }

  let user = await prisma.user.findFirst({
    where: { googleId: providerId },
  });

  if (!user && email) {
    user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (user) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          googleId: providerId,
          avatarUrl: user.avatarUrl || avatarUrl,
        },
      });
    }
  }

  if (!user) {
    const userEmail = email ? email.toLowerCase() : `google_${providerId}@musicroom.local`;
    user = await prisma.user.create({
      data: {
        email: userEmail,
        name: name || 'Google User',
        avatarUrl,
        googleId: providerId,
        isEmailVerified: true,
      },
    });
  }

  const { accessToken, refreshToken } = generateTokens(user);

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRES_DAYS);

  await prisma.refreshToken.create({
    data: {
      token: refreshToken,
      userId: user.id,
      expiresAt,
    },
  });

  return {
    user: sanitizeUser(user),
    accessToken,
    refreshToken,
  };
}

export async function linkOAuthAccount(userId, { provider, providerId }) {
  const existingWithProvider = await prisma.user.findFirst({
    where: { googleId: providerId },
  });

  if (existingWithProvider && existingWithProvider.id !== userId) {
    return { error: 'Ce compte Google est déjà associé à un autre utilisateur', status: 400 };
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { googleId: providerId },
  });

  return { user: sanitizeUser(updated) };
}

export async function forgotPassword(email) {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  });

  if (!user) {
    // Avoid user enumeration
    return { success: true, message: 'Si le compte existe, un code de réinitialisation a été généré.' };
  }

  const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
  const expires = new Date(Date.now() + 3600 * 1000); // 1 hour

  await prisma.user.update({
    where: { id: user.id },
    data: {
      resetPasswordCode: resetCode,
      resetPasswordExpires: expires,
    },
  });

  // Asynchronously send reset email via SMTP / Mailpit
  sendPasswordResetEmail(user.email, resetCode);

  return {
    success: true,
    message: 'Un email contenant le code de réinitialisation vous a été envoyé.',
  };
}

export async function resetPassword(email, resetCode, newPassword) {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  });

  if (!user || user.resetPasswordCode !== resetCode) {
    return { error: 'Code de réinitialisation invalide', status: 400 };
  }

  if (!user.resetPasswordExpires || user.resetPasswordExpires < new Date()) {
    return { error: 'Le code de réinitialisation a expiré', status: 400 };
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      password: hashedPassword,
      resetPasswordCode: null,
      resetPasswordExpires: null,
    },
  });

  return { success: true, message: 'Mot de passe mis à jour avec succès' };
}
