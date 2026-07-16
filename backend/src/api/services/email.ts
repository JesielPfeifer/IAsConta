import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY || "re_xxx");
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";
const FROM_NAME = process.env.RESEND_FROM_NAME || "Contas";

export async function sendWelcome(
  userEmail: string,
  userName: string
): Promise<void> {
  try {
    await resend.emails.send({
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to: userEmail,
      subject: "Bem-vindo ao Contas!",
      html: `<p>Olá ${userName},</p><p>Sua conta no <strong>Contas</strong> foi criada com sucesso.</p><p>Comece a registrar suas transações e organize suas finanças!</p>`,
    });
  } catch (err) {
    console.error("Erro ao enviar email de boas-vindas:", err);
  }
}

export async function sendPasswordReset(
  userEmail: string,
  token: string
): Promise<void> {
  try {
    await resend.emails.send({
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to: userEmail,
      subject: "Redefinição de senha - Contas",
      html: `<p>Você solicitou a redefinição de senha.</p><p>Use o token abaixo:</p><pre>${token}</pre><p>Se você não solicitou isso, ignore este email.</p>`,
    });
  } catch (err) {
    console.error("Erro ao enviar email de redefinição:", err);
  }
}

export async function sendPartnerInvite(
  userEmail: string,
  inviterName: string,
  token: string
): Promise<void> {
  try {
    await resend.emails.send({
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to: userEmail,
      subject: `${inviterName} te convidou para o Contas`,
      html: `<p>Olá,</p><p>${inviterName} te convidou para gerenciar as finanças do casal no <strong>Contas</strong>.</p><p>Use o token abaixo ao se cadastrar:</p><pre>${token}</pre>`,
    });
  } catch (err) {
    console.error("Erro ao enviar convite de parceiro:", err);
  }
}
