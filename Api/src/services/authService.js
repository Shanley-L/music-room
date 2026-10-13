import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import prisma from '../lib/prisma.js';
import { blacklistToken, incrementAttempts, clearAttempts } from '../lib/redis.js';
import { JWT_SECRET, JWT_REFRESH_SECRET } from '../middleware/auth.js';
import { sendVerificationEmail, sendPasswordResetEmail } from '../lib/mailer.js';

const ACCESS_TOKEN_EXPIRES = '1h';
const REFRESH_TOKEN_EXPIRES_DAYS = 7;

// One-time codes (email verification, password reset): 6 digits from a CSPRNG.
// After MAX_CODE_ATTEMPTS attempts on one code, the code is invalidated and a new
// one is required (anti brute force, on top of the per-IP authLimiter).
export const MAX_CODE_ATTEMPTS = 5;
const CODE_ATTEMPTS_TTL_SECONDS = 3600;

function generateOneTimeCode() {
  return crypto.randomInt(100000, 1000000).toString();
}

const attemptsKey = (purpose, userId) => `${purpose}:${userId}`;

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
  const verificationCode = generateOneTimeCode();

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

  if (!user.verificationCode) {
    return { error: 'Code de validation invalide', code: 'INVALID_CODE', status: 400 };
  }

  // Every attempt counts (also concurrent ones): past the cap the code is replaced
  // by a new one, sent by email, and the old one never validates again.
  const key = attemptsKey('verify-email', user.id);
  const attempts = await incrementAttempts(key, CODE_ATTEMPTS_TTL_SECONDS);
  if (attempts > MAX_CODE_ATTEMPTS || (user.verificationCode !== String(code) && attempts >= MAX_CODE_ATTEMPTS)) {
    const verificationCode = generateOneTimeCode();
    await prisma.user.update({ where: { id: user.id }, data: { verificationCode } });
    await clearAttempts(key);
    sendVerificationEmail(user.email, verificationCode, user.name);
    return {
      error: 'Trop de tentatives : un nouveau code de validation vous a été envoyé',
      code: 'CODE_ATTEMPTS_EXCEEDED',
      status: 400,
    };
  }

  if (user.verificationCode !== String(code)) {
    return { error: 'Code de validation invalide', code: 'INVALID_CODE', status: 400 };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      isEmailVerified: true,
      verificationCode: null,
    },
  });
  await clearAttempts(key);

  return { success: true, message: 'Email validé avec succès' };
}

async function issueSession(user) {
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

function isUniqueViolation(err) {
  return err?.code === 'P2002';
}

/**
 * Login / sign-up with a Google identity that was verified server-side
 * (`lib/googleVerify.js`). Never call this with client-supplied identity data.
 *
 * - known Google account (googleId) -> logs in;
 * - otherwise the Google email must be verified. An existing account with that
 *   email gets the Google account linked; if that account had not verified its
 *   email, its password is dropped and all its refresh tokens are deleted
 *   (whoever registered it never proved they own the address) and the email is
 *   marked verified. An account already linked to a different Google account is
 *   refused (409 GOOGLE_ACCOUNT_CONFLICT), verified or not;
 * - otherwise a new account is created.
 */
export async function googleLogin({ sub, email, emailVerified, name, picture }) {
  let user = await prisma.user.findUnique({ where: { googleId: sub } });

  if (!user) {
    if (!email || !emailVerified) {
      return {
        error: 'Votre adresse email Google n’est pas vérifiée',
        code: 'GOOGLE_EMAIL_UNVERIFIED',
        status: 401,
      };
    }

    const existing = await prisma.user.findUnique({ where: { email } });

    if (existing) {
      if (existing.googleId && existing.googleId !== sub) {
        return {
          error: 'Ce compte est déjà associé à un autre compte Google',
          code: 'GOOGLE_ACCOUNT_CONFLICT',
          status: 409,
        };
      }
      const data = {
        googleId: sub,
        avatarUrl: existing.avatarUrl || picture,
        isEmailVerified: true,
        verificationCode: null,
      };
      if (!existing.isEmailVerified) {
        data.password = null;
        data.resetPasswordCode = null;
        data.resetPasswordExpires = null;
      }
      try {
        if (existing.isEmailVerified) {
          user = await prisma.user.update({ where: { id: existing.id }, data });
        } else {
          // Whoever registered this unverified address may hold sessions: end them all.
          [, user] = await prisma.$transaction([
            prisma.refreshToken.deleteMany({ where: { userId: existing.id } }),
            prisma.user.update({ where: { id: existing.id }, data }),
          ]);
        }
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        return {
          error: 'Ce compte Google est déjà associé à un autre utilisateur',
          code: 'GOOGLE_ACCOUNT_IN_USE',
          status: 409,
        };
      }
    } else {
      try {
        user = await prisma.user.create({
          data: {
            email,
            name: (name || 'Utilisateur Google').slice(0, 100),
            avatarUrl: picture,
            googleId: sub,
            isEmailVerified: true,
          },
        });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        // Concurrent sign-up with the same Google account or email.
        user = await prisma.user.findUnique({ where: { googleId: sub } });
        if (!user) {
          return { error: 'Conflit lors de la création du compte', code: 'GOOGLE_ACCOUNT_CONFLICT', status: 409 };
        }
      }
    }
  }

  return issueSession(user);
}

/**
 * Links a verified Google identity to the authenticated user.
 * Refused when the user's own email is not verified (403 EMAIL_NOT_VERIFIED: an
 * unverified account is reclaimed through /auth/google instead) or when another
 * Google account is already linked (409 GOOGLE_ALREADY_LINKED, no unlinking).
 */
export async function linkGoogleAccount(userId, { sub }) {
  const current = await prisma.user.findUnique({ where: { id: userId } });
  if (!current) return { error: 'Utilisateur introuvable', status: 404 };
  if (current.googleId === sub) return { user: sanitizeUser(current) };
  if (current.googleId) {
    return {
      error: 'Un autre compte Google est déjà associé à votre compte',
      code: 'GOOGLE_ALREADY_LINKED',
      status: 409,
    };
  }
  if (!current.isEmailVerified) {
    return {
      error: 'Validez votre adresse email avant de lier un compte Google',
      code: 'EMAIL_NOT_VERIFIED',
      status: 403,
    };
  }

  const owner = await prisma.user.findUnique({ where: { googleId: sub } });
  if (owner && owner.id !== userId) {
    return {
      error: 'Ce compte Google est déjà associé à un autre utilisateur',
      code: 'GOOGLE_ACCOUNT_IN_USE',
      status: 409,
    };
  }

  try {
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { googleId: sub },
    });
    return { user: sanitizeUser(updated) };
  } catch (err) {
    if (isUniqueViolation(err)) {
      return {
        error: 'Ce compte Google est déjà associé à un autre utilisateur',
        code: 'GOOGLE_ACCOUNT_IN_USE',
        status: 409,
      };
    }
    if (err?.code === 'P2025') return { error: 'Utilisateur introuvable', status: 404 };
    throw err;
  }
}

/**
 * DEV ONLY (ALLOW_DEV_OAUTH=true and NODE_ENV !== 'production', checked by the
 * controller): simulated Google login from body-supplied data. Simulated ids are
 * namespaced (`dev:`) so they can never match a real Google account, and an email
 * that already belongs to an account is refused instead of merged.
 */
export async function devOAuthLogin({ providerId, email, name }) {
  const googleId = `dev:${providerId}`;
  let user = await prisma.user.findUnique({ where: { googleId } });
  if (user) return issueSession(user);

  const userEmail = (email || `dev_${providerId}@musicroom.local`).toLowerCase();
  const taken = await prisma.user.findUnique({ where: { email: userEmail } });
  if (taken) {
    return { error: 'Un compte existe déjà avec cette adresse email', code: 'EMAIL_IN_USE', status: 409 };
  }

  user = await prisma.user.create({
    data: {
      email: userEmail,
      name: (name || 'Dev Google User').slice(0, 100),
      googleId,
      isEmailVerified: true,
    },
  });
  return issueSession(user);
}

/** DEV ONLY: links a simulated Google id (namespaced `dev:`) to the authenticated user. */
export async function devLinkOAuth(userId, { providerId }) {
  return linkGoogleAccount(userId, { sub: `dev:${providerId}` });
}

export async function forgotPassword(email) {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  });

  if (!user) {
    // Avoid user enumeration
    return { success: true, message: 'Si le compte existe, un code de réinitialisation a été généré.' };
  }

  const resetCode = generateOneTimeCode();
  const expires = new Date(Date.now() + 3600 * 1000); // 1 hour

  await prisma.user.update({
    where: { id: user.id },
    data: {
      resetPasswordCode: resetCode,
      resetPasswordExpires: expires,
    },
  });

  // A new code gets a fresh attempt budget.
  await clearAttempts(attemptsKey('reset-password', user.id));

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

  if (!user || !user.resetPasswordCode) {
    return { error: 'Code de réinitialisation invalide', code: 'INVALID_CODE', status: 400 };
  }

  // Every attempt counts (also concurrent ones): past the cap the code is
  // invalidated and the user must request a new one (forgot-password).
  const key = attemptsKey('reset-password', user.id);
  const attempts = await incrementAttempts(key, CODE_ATTEMPTS_TTL_SECONDS);
  if (attempts > MAX_CODE_ATTEMPTS || (user.resetPasswordCode !== String(resetCode) && attempts >= MAX_CODE_ATTEMPTS)) {
    await prisma.user.update({
      where: { id: user.id },
      data: { resetPasswordCode: null, resetPasswordExpires: null },
    });
    await clearAttempts(key);
    return {
      error: 'Trop de tentatives : ce code est invalidé, demandez-en un nouveau',
      code: 'CODE_ATTEMPTS_EXCEEDED',
      status: 400,
    };
  }

  if (user.resetPasswordCode !== String(resetCode)) {
    return { error: 'Code de réinitialisation invalide', code: 'INVALID_CODE', status: 400 };
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
  await clearAttempts(key);

  return { success: true, message: 'Mot de passe mis à jour avec succès' };
}
