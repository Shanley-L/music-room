import nodemailer from 'nodemailer';

// Real SMTP (Gmail by default). With a Google account, enable 2-step verification and
// create an "App password" (https://myaccount.google.com/apppasswords): use it as SMTP_PASS.
const host = process.env.SMTP_HOST || 'smtp.gmail.com';
const port = parseInt(process.env.SMTP_PORT || '465', 10);
const user = process.env.SMTP_USER || null;
const pass = (process.env.SMTP_PASS || '').replace(/\s+/g, '') || null;
const from = process.env.SMTP_FROM || (user ? `"Music Room" <${user}>` : '"Music Room" <noreply@musicroom.local>');

let transporter = null;

function getTransporter() {
  if (!user || !pass) {
    throw new Error('SMTP non configuré : renseignez SMTP_USER et SMTP_PASS (mot de passe d’application Google)');
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465, // 465 = TLS direct, 587 = STARTTLS
      requireTLS: port !== 465,
      auth: { user, pass },
    });
  }
  return transporter;
}

export async function sendVerificationEmail(toEmail, code, userName) {
  try {
    const transport = getTransporter();
    const info = await transport.sendMail({
      from,
      to: toEmail,
      subject: 'Bienvenue sur Music Room — Validez votre adresse email',
      text: `Bonjour ${userName || ''},\n\nVotre code de validation pour finaliser votre inscription sur Music Room est : ${code}\n\nSi vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer cet email.\n\nL'équipe Music Room`,
      html: `
        <div style="font-family: Arial, sans-serif; background-color: #121212; color: #ffffff; padding: 24px; border-radius: 12px; max-width: 500px; margin: auto;">
          <h2 style="color: #1DB954; margin-top: 0;">Music Room</h2>
          <p>Bonjour <strong>${userName || ''}</strong>,</p>
          <p>Merci de vous être inscrit sur Music Room ! Pour activer votre compte, veuillez saisir le code de validation ci-dessous :</p>
          <div style="background-color: #1e1e1e; padding: 18px; border-radius: 8px; text-align: center; margin: 20px 0; border: 1px solid #333;">
            <span style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #1DB954;">${code}</span>
          </div>
          <p style="color: #888; font-size: 13px;">Ce code est requis pour valider votre compte. Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer ce message.</p>
        </div>
      `,
    });
    console.log(`[Email] Validation email sent to ${toEmail} (messageId: ${info.messageId})`);
    return { success: true };
  } catch (err) {
    console.error(`[Email Error] Failed to send email to ${toEmail}:`, err.message);
    return { success: false, error: err.message };
  }
}

export async function sendPasswordResetEmail(toEmail, code) {
  try {
    const transport = getTransporter();
    const info = await transport.sendMail({
      from,
      to: toEmail,
      subject: 'Music Room — Réinitialisation de votre mot de passe',
      text: `Bonjour,\n\nVous avez demandé la réinitialisation de votre mot de passe sur Music Room. Votre code de réinitialisation est : ${code}\n\nCe code est valable pendant 1 heure.\n\nL'équipe Music Room`,
      html: `
        <div style="font-family: Arial, sans-serif; background-color: #121212; color: #ffffff; padding: 24px; border-radius: 12px; max-width: 500px; margin: auto;">
          <h2 style="color: #1DB954; margin-top: 0;">Music Room</h2>
          <p>Vous avez demandé la réinitialisation de votre mot de passe.</p>
          <p>Voici votre code de sécurité :</p>
          <div style="background-color: #1e1e1e; padding: 18px; border-radius: 8px; text-align: center; margin: 20px 0; border: 1px solid #333;">
            <span style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #1DB954;">${code}</span>
          </div>
          <p style="color: #888; font-size: 13px;">Ce code expire dans 1 heure. Si vous n'avez pas demandé cette réinitialisation, veuillez ignorer cet email.</p>
        </div>
      `,
    });
    console.log(`[Email] Password reset email sent to ${toEmail} (messageId: ${info.messageId})`);
    return { success: true };
  } catch (err) {
    console.error(`[Email Error] Failed to send password reset email:`, err.message);
    return { success: false, error: err.message };
  }
}
